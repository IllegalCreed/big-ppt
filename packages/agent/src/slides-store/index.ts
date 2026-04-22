import fs from 'node:fs'
import { getPaths } from '../workspace.js'
import { similarity } from '../utils/similarity.js'
import { appendHistory, redo, undo, type HistoryActionResult } from './history.js'
import { parseSlides, serializeSlides, type SlidePage } from './pages.js'

export function readSlides(): string {
  const { slidesPath } = getPaths()
  return fs.readFileSync(slidesPath, 'utf-8')
}

export interface MutationResult {
  success: boolean
  error?: string
}

export interface CreateSlideResult extends MutationResult {
  /** 新页在 slides.md 中的 1-based 位置 */
  index?: number
}

/** 读取当前 slides.md，若不存在或解析失败返回空 pages */
function readParsed(): SlidePage[] {
  const { slidesPath } = getPaths()
  if (!fs.existsSync(slidesPath)) return []
  try {
    return parseSlides(fs.readFileSync(slidesPath, 'utf-8')).pages
  } catch {
    return []
  }
}

function writeParsed(pages: SlidePage[], op: string): void {
  const { slidesPath } = getPaths()
  const out = serializeSlides({ pages })
  appendHistory(op, out)
  fs.writeFileSync(slidesPath, out, 'utf-8')
}

/**
 * 整文件覆写。**仅**用于首次生成 / 模板重置场景。
 *
 * 护栏：如果 slides.md 已含 ≥1 页，拒绝执行并引导使用四件套。首次生成场景下
 * slides.md 要么不存在要么是空壳（无分页），writeSlides 才允许通过。
 */
export function writeSlides(content: string): MutationResult {
  const pages = readParsed()
  if (pages.length > 0) {
    return {
      success: false,
      error: `已有 ${pages.length} 页幻灯片。write_slides 仅用于首次生成；修改请用 create_slide / update_slide / delete_slide / reorder_slides 四件套工具。`,
    }
  }
  const { slidesPath } = getPaths()
  appendHistory('write', content)
  fs.writeFileSync(slidesPath, content, 'utf-8')
  return { success: true }
}

export interface EditResult {
  success: boolean
  error?: string
}

/** 精确替换：old_string 在文件中必须唯一匹配。建议用于"页内改一个词 / 数字"场景。 */
export function editSlides(oldString: string, newString: string): EditResult {
  if (!oldString) return { success: false, error: 'old_string 不能为空' }
  const { slidesPath } = getPaths()
  const content = fs.readFileSync(slidesPath, 'utf-8')
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
  appendHistory('edit', newContent)
  fs.writeFileSync(slidesPath, newContent, 'utf-8')
  return { success: true }
}

/**
 * 在指定位置插入新页。
 * @param opts.index      1-based 位置；'end' 表追加；默认 'end'
 * @param opts.layout     layout 名（必填，AI 从 layouts 清单里选）
 * @param opts.frontmatter 额外 frontmatter 键值对（layout 会被自动合入）
 * @param opts.body       markdown 正文
 */
export function createSlide(opts: {
  index?: number | 'end'
  layout: string
  frontmatter?: Record<string, unknown>
  body?: string
}): CreateSlideResult {
  if (!opts.layout || typeof opts.layout !== 'string') {
    return { success: false, error: 'layout 不能为空' }
  }
  const pages = readParsed()
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
  writeParsed(pages, 'create')
  return { success: true, index: insertAt + 1 }
}

/**
 * 更新指定页的 frontmatter 和/或 body。
 * @param opts.index            1-based 位置
 * @param opts.frontmatter      新 frontmatter（与现有合并，除非 replace=true）
 * @param opts.body             新 body（若传则整段替换当前 body）
 * @param opts.replaceFrontmatter true = 完全替换 frontmatter；false/缺省 = 合并（undefined 字段保留，新字段覆盖同名）
 */
export function updateSlide(opts: {
  index: number
  frontmatter?: Record<string, unknown>
  body?: string
  replaceFrontmatter?: boolean
}): MutationResult {
  const pages = readParsed()
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
  writeParsed(pages, 'update')
  return { success: true }
}

export function deleteSlide(index: number): MutationResult {
  const pages = readParsed()
  if (!Number.isInteger(index) || index < 1 || index > pages.length) {
    return { success: false, error: `index 超出范围：应为 1..${pages.length}，收到 ${index}` }
  }
  if (pages.length === 1) {
    return { success: false, error: '无法删除最后一页。请先 create_slide 再 delete，或直接用 /undo 回退。' }
  }
  pages.splice(index - 1, 1)
  pages.forEach((p, i) => (p.index = i))
  writeParsed(pages, 'delete')
  return { success: true }
}

/**
 * 按给定顺序重排页面。
 * @param order 长度等于当前页数的数组，每个元素是 1..N 的排列（无重复、无缺失）
 */
export function reorderSlides(order: number[]): MutationResult {
  const pages = readParsed()
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
  writeParsed(reordered, 'reorder')
  return { success: true }
}

/** /undo 斜杠指令：回到上一个历史版本 */
export function restoreSlides(): HistoryActionResult {
  return undo()
}

/** /redo 斜杠指令：前进到下一个历史版本 */
export function redoSlides(): HistoryActionResult {
  return redo()
}
