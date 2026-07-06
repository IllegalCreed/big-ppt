/**
 * Phase 15.x P0 security hotfix(2026-05-18):slides-store 不再读写共享 `packages/slidev/slides.md`。
 *
 * 历史漏洞:所有 7 个工具(read_slides / write_slides / create_slide / update_slide /
 * delete_slide / reorder_slides / edit_slides)都走全局 `slides.md`,导致用户 A 写完后
 * 用户 B 在另一个 deck 调 read_slides 读到 A 的内容,LLM 把 A 的内容当 "current deck"
 * 在 B 的回复里 echo,造成跨用户跨 deck 数据泄漏。
 *
 * 修复:所有读写都从 ALS `RequestContext` 拿 (userId, activeDeckId),走
 * `deck_versions.content` + `decks.currentVersionId`。`slides.md` 只在 `POST /api/present/:id`
 * 抢锁时由 `mirror.ts` 单文件 mirror(给 Slidev SPA 放映 tab 用),slides-store 本身完全脱钩。
 *
 * 没有 ALS activeDeckId / userId → throw `NoActiveDeckError`,工具层 catch 后友好返错给 LLM,
 * 不再静默 fallback 读全局 slides.md。
 */
import { and, eq } from 'drizzle-orm'
import { getDb, decks, deckVersions } from '../db/index.js'
import { getRequestContext } from '../context.js'
import { similarity } from '../utils/similarity.js'
import { fixOrphanedFrontmatter } from './fixer.js'
import { parseSlides, serializeSlides, type SlidePage } from './pages.js'
import { appendHistoryDb, redoDb, undoDb, type HistoryActionResult } from './history.js'
import { NoActiveDeckError } from './errors.js'

export { NoActiveDeckError } from './errors.js'

/**
 * per-deck 写串行化(2026-07 生产 dogfood)。
 *
 * 所有 mutation 都是「读整份内容 → 改 → 写回」,读写之间原本无锁。image-gen worker 是
 * fire-and-forget + 并发限流 3,多个 worker 几乎同时收工调 updateSlide,各基于同一旧快照
 * 写回 → 后写覆盖先写(lost update)。生产 deck#30 实测:10 个 job 全 done,但第 11 页
 * 生成的 asset 未被最终内容引用——被别的 slide 的 job 覆盖丢了。
 *
 * agent 是单实例(与 slidev-lock 同前提),用进程内 promise 链把同一 deck 的 mutation 串起来:
 * 每个 op 等前一个 op 完全落库后才开始「读→改→写」,读到的必是最新内容,杜绝覆盖。
 * 不同 deck 用各自独立的链,互不阻塞。链尾自清理防 map 无限增长。
 *
 * ALS 语义:withActiveDeckLock 在 mutation 的 ALS 上下文内被调用,`fn` 通过 `.then` 注册,
 * 其 async 上下文在注册点捕获 = 当前 deck 的上下文;prev(前一个 op)来自别的上下文但只用于
 * 排队,不污染 fn 的上下文。故 fn 内 getCurrentDeckContent() 读到的仍是本 op 的 deck。
 */
const deckWriteChains = new Map<number, Promise<unknown>>()

function withActiveDeckLock<T>(fn: () => Promise<T>): Promise<T> {
  const deckId = getRequestContext().activeDeckId
  if (deckId == null) return fn() // 无 active deck → 交给下游正常抛 NoActiveDeckError
  const prev = deckWriteChains.get(deckId) ?? Promise.resolve()
  // 无论前一个 op 成败都接着跑(一个失败不该卡死整条链)
  const result = prev.then(fn, fn)
  // 存一个不抛错的尾供下一个 op 挂接
  const tail = result.then(
    () => {},
    () => {},
  )
  deckWriteChains.set(deckId, tail)
  // 链尾自清理:tail 结算后若无后续 op 挂上来(仍是最新尾)则删 entry,防长跑进程 map 泄漏
  void tail.then(() => {
    if (deckWriteChains.get(deckId) === tail) deckWriteChains.delete(deckId)
  })
  return result
}

/** 仅测试用:清空 per-deck 写链(跨用例隔离) */
export function __resetDeckWriteChainsForTesting(): void {
  deckWriteChains.clear()
}

/**
 * 从 ALS 拿 (userId, activeDeckId),verify 归属,返回当前 version content。
 *
 * - 缺 userId / activeDeckId → throw NoActiveDeckError(不静默拿"全局"内容)
 * - deck 存在但不属于当前 user → throw(403 等价的 IDOR 保护;persist 层也有同样 guard)
 * - 没有 currentVersionId(新建 deck 还没写过)→ 返空串 ''
 */
async function getCurrentDeckContent(): Promise<string> {
  const rc = getRequestContext()
  if (!rc.userId || !rc.activeDeckId) {
    throw new NoActiveDeckError()
  }
  const db = getDb()
  const [deck] = await db
    .select({
      id: decks.id,
      userId: decks.userId,
      currentVersionId: decks.currentVersionId,
    })
    .from(decks)
    .where(and(eq(decks.id, rc.activeDeckId), eq(decks.userId, rc.userId)))
    .limit(1)
  if (!deck) {
    throw new NoActiveDeckError('当前 deck 不存在或无权访问')
  }
  if (!deck.currentVersionId) return ''
  const [version] = await db
    .select({ content: deckVersions.content })
    .from(deckVersions)
    .where(eq(deckVersions.id, deck.currentVersionId))
    .limit(1)
  return version?.content ?? ''
}

/** 异步版本，给 tool callback 用。 */
export async function readSlides(): Promise<string> {
  return getCurrentDeckContent()
}

export interface MutationResult {
  success: boolean
  error?: string
}

export interface CreateSlideResult extends MutationResult {
  /** 新页在 slides.md 中的 1-based 位置 */
  index?: number
}

/** 读取当前 deck content,若解析失败返空 pages */
async function readParsed(): Promise<SlidePage[]> {
  try {
    const content = await getCurrentDeckContent()
    if (!content) return []
    return parseSlides(content).pages
  } catch (err) {
    if (err instanceof NoActiveDeckError) throw err
    return []
  }
}

async function writeParsed(pages: SlidePage[], op: string): Promise<void> {
  const out = serializeSlides({ pages })
  await persistAndRecord(out, op)
}

/**
 * 写一份新内容到 DB(deck_versions append + decks.currentVersionId 前移),
 * 同时维护轮次合并 / undo 重做栈截断 / ring buffer 裁剪。
 *
 * 没 ALS activeDeckId / userId → throw NoActiveDeckError(由 appendHistoryDb 内部抛)。
 */
async function persistAndRecord(content: string, op: string): Promise<void> {
  await appendHistoryDb(content, op)
}

/**
 * 整文件覆写。**仅**用于首次生成 / 模板重置场景。
 *
 * 护栏：如果当前 deck 已含真实用户内容(≥1 页且非默认 starter 占位骨架),拒绝执行并引导
 * 使用四件套。首次生成场景:
 *   1. deck 内容空(无分页)→ 允许 write_slides
 *   2. deck 含模板默认 starter 占位骨架(mainTitle: "请填写标题" + date: "YYYY/MM/DD" 等)
 *      → **也允许** write_slides 整体覆盖。每个新建 deck 默认填了 starter,LLM 看到 starter
 *      非空就走逐页 update_slide 路径而不是 write_slides 整体生成,严重退化首次生成体验。
 *      检测启发式:'YYYY/MM/DD' 占位串只会出现在 starter 里,真用户填了具体日期就替换掉。
 */
const STARTER_PLACEHOLDER_MARKERS = ['YYYY/MM/DD', '请填写标题', '请填写副标题']

function isDefaultStarterContent(content: string): boolean {
  // 至少 2 个占位 marker 同时存在视为 starter(防误判 — 用户偶然写"请填写标题"作正文不会同时含 YYYY/MM/DD)
  let hits = 0
  for (const m of STARTER_PLACEHOLDER_MARKERS) {
    if (content.includes(m)) hits++
  }
  return hits >= 2
}

export async function writeSlides(content: string): Promise<MutationResult> {
  return withActiveDeckLock(async () => {
    const currentContent = await getCurrentDeckContent()
    if (currentContent) {
      // parseSlides 在非合法 frontmatter 文本上会 throw(如初始测试 fixture "v1" / "# hello\n");
      // 此处 try/catch 沿用历史 readParsed 的语义:解析失败视作 0 页,允许首次生成路径覆盖。
      let pages: SlidePage[] = []
      try {
        pages = parseSlides(currentContent).pages
      } catch {
        /* 当作 0 页 */
      }
      if (pages.length > 0 && !isDefaultStarterContent(currentContent)) {
        return {
          success: false,
          error: `已有 ${pages.length} 页幻灯片。write_slides 仅用于首次生成；修改请用 create_slide / update_slide / delete_slide / reorder_slides 四件套工具。`,
        }
      }
    }
    // LLM 偶尔写漏 slide 间空 body 分隔符,导致后续 frontmatter 被吞、用 default 主题。
    // 落盘 + 持久化 DB 之前规范化。
    const { fixed: sanitized } = fixOrphanedFrontmatter(content)
    await persistAndRecord(sanitized, 'write')
    return { success: true }
  })
}

export interface EditResult {
  success: boolean
  error?: string
}

/** 精确替换：old_string 在文件中必须唯一匹配。建议用于"页内改一个词 / 数字"场景。 */
export async function editSlides(oldString: string, newString: string): Promise<EditResult> {
  return withActiveDeckLock(async () => {
    if (!oldString) return { success: false, error: 'old_string 不能为空' }
    const content = await getCurrentDeckContent()
    const count = content.split(oldString).length - 1

    if (count === 0) {
      const lines = content.split('\n')
      const suggestions = lines
        .filter((l) => similarity(l.trim(), oldString.trim()) > 0.3)
        .slice(0, 3)
        .map((l) => l.trim())
      return {
        success: false,
        error: `未找到指定内容。相似内容：\n${suggestions.join('\n')}`,
      }
    }

    if (count > 1) {
      const positions: number[] = []
      const lines = content.split('\n')
      const firstLine = oldString.split('\n')[0] ?? ''
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(firstLine)) positions.push(i + 1)
      }
      return {
        success: false,
        error: `找到 ${count} 处匹配，请提供更长的上下文以唯一定位。匹配位置：第 ${positions.join(', ')} 行附近`,
      }
    }

    const newContent = content.replace(oldString, newString)
    await persistAndRecord(newContent, 'edit')
    return { success: true }
  })
}

/**
 * 在指定位置插入新页。
 * @param opts.index      1-based 位置；'end' 表追加；默认 'end'
 * @param opts.layout     layout 名（必填，AI 从 layouts 清单里选）
 * @param opts.frontmatter 额外 frontmatter 键值对（layout 会被自动合入）
 * @param opts.body       markdown 正文
 */
export async function createSlide(opts: {
  index?: number | 'end'
  layout: string
  frontmatter?: Record<string, unknown>
  body?: string
}): Promise<CreateSlideResult> {
  return withActiveDeckLock(async () => {
    if (!opts.layout || typeof opts.layout !== 'string') {
      return { success: false, error: 'layout 不能为空' }
    }
    const pages = await readParsed()
    const frontmatter = { layout: opts.layout, ...(opts.frontmatter ?? {}) }
    const body = opts.body ?? ''

    let insertAt: number
    if (opts.index === 'end' || opts.index === undefined) {
      insertAt = pages.length
    } else if (typeof opts.index === 'number' && Number.isInteger(opts.index)) {
      if (opts.index < 1 || opts.index > pages.length + 1) {
        return {
          success: false,
          error: `index 超出范围：应为 1..${pages.length + 1} 或 "end"，收到 ${opts.index}`,
        }
      }
      insertAt = opts.index - 1
    } else {
      return { success: false, error: 'index 必须是整数或 "end"' }
    }

    const newPage: SlidePage = { index: insertAt, frontmatter, body }
    pages.splice(insertAt, 0, newPage)
    // 重新编号 index 字段
    pages.forEach((p, i) => (p.index = i))
    await writeParsed(pages, 'create')
    return { success: true, index: insertAt + 1 }
  })
}

/**
 * 更新指定页的 frontmatter 和/或 body。
 * @param opts.index            1-based 位置
 * @param opts.frontmatter      新 frontmatter（与现有合并，除非 replace=true）
 * @param opts.body             新 body（若传则整段替换当前 body）
 * @param opts.replaceFrontmatter true = 完全替换 frontmatter；false/缺省 = 合并（undefined 字段保留，新字段覆盖同名）
 */
export async function updateSlide(opts: {
  index: number
  frontmatter?: Record<string, unknown>
  body?: string
  replaceFrontmatter?: boolean
}): Promise<MutationResult> {
  return withActiveDeckLock(async () => {
    const pages = await readParsed()
    if (!Number.isInteger(opts.index) || opts.index < 1 || opts.index > pages.length) {
      return {
        success: false,
        error: `index 超出范围：应为 1..${pages.length}，收到 ${opts.index}`,
      }
    }
    if (opts.frontmatter === undefined && opts.body === undefined) {
      return { success: false, error: '至少提供 frontmatter 或 body 之一' }
    }
    const target = pages[opts.index - 1]!
    if (opts.frontmatter !== undefined) {
      target.frontmatter = opts.replaceFrontmatter
        ? { ...opts.frontmatter }
        : { ...target.frontmatter, ...opts.frontmatter }
    }
    if (opts.body !== undefined) {
      target.body = opts.body
    }
    await writeParsed(pages, 'update')
    return { success: true }
  })
}

export async function deleteSlide(index: number): Promise<MutationResult> {
  return withActiveDeckLock(async () => {
    const pages = await readParsed()
    if (!Number.isInteger(index) || index < 1 || index > pages.length) {
      return { success: false, error: `index 超出范围：应为 1..${pages.length}，收到 ${index}` }
    }
    if (pages.length === 1) {
      return {
        success: false,
        error: '无法删除最后一页。请先 create_slide 再 delete，或直接用 /undo 回退。',
      }
    }
    pages.splice(index - 1, 1)
    pages.forEach((p, i) => (p.index = i))
    await writeParsed(pages, 'delete')
    return { success: true }
  })
}

/**
 * 按给定顺序重排页面。
 * @param order 长度等于当前页数的数组，每个元素是 1..N 的排列（无重复、无缺失）
 */
export async function reorderSlides(order: number[]): Promise<MutationResult> {
  return withActiveDeckLock(async () => {
    const pages = await readParsed()
    if (!Array.isArray(order)) {
      return { success: false, error: 'order 必须是数组' }
    }
    if (order.length !== pages.length) {
      return {
        success: false,
        error: `order 长度错误：应为 ${pages.length}，收到 ${order.length}`,
      }
    }
    const seen = new Set<number>()
    for (const v of order) {
      if (!Number.isInteger(v) || v < 1 || v > pages.length) {
        return { success: false, error: `order 含非法元素：${v}（应为 1..${pages.length}）` }
      }
      if (seen.has(v)) {
        return { success: false, error: `order 含重复元素：${v}` }
      }
      seen.add(v)
    }
    const reordered = order.map((v) => pages[v - 1]!)
    reordered.forEach((p, i) => (p.index = i))
    await writeParsed(reordered, 'reorder')
    return { success: true }
  })
}

/** /undo 斜杠指令：回到上一个历史版本 */
export async function restoreSlides(): Promise<HistoryActionResult> {
  return undoDb()
}

/** /redo 斜杠指令：前进到下一个历史版本 */
export async function redoSlides(): Promise<HistoryActionResult> {
  return redoDb()
}

export type { HistoryActionResult } from './history.js'
