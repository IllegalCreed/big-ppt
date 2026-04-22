import { AsyncLocalStorage } from 'node:async_hooks'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { HistoryPosition } from '@big-ppt/shared'
import { getPaths } from '../workspace.js'

/**
 * 线性版本栈模型：
 * - `files` 按时间序存快照文件名 [oldest, ..., newest]
 * - `currentIndex` 指向 "当前 slides.md 应该等于 files[currentIndex] 的内容"（0-based；-1 表空栈）
 * - 写操作：截断 redo 栈（currentIndex 之后的快照）→ append 新快照 → currentIndex 前进
 * - 轮次聚合：若当前 turnId 等于 pointer.lastTurnId，则覆盖 files[currentIndex] 的快照而不是 push
 * - 环形裁剪：files.length 超过 MAX 时 shift 最旧的，currentIndex 同步 -1
 *
 * 仅供 /undo /redo 斜杠指令用作工具级临时栈。Phase 5 deck_versions 表会取代它。
 */

interface Pointer {
  currentIndex: number
  files: string[]
  /** 最近一次 push 时的 turnId。同 turn 后续 appendHistory 会合并到 files[currentIndex] */
  lastTurnId: string | null
}

const turnContext = new AsyncLocalStorage<string>()

/** 在指定 turn 上下文里运行 fn；fn 内部调用的 appendHistory 会按 turn 聚合 */
export function runInTurn<T>(turnId: string, fn: () => T): T {
  return turnContext.run(turnId, fn)
}

function getCurrentTurnId(): string | null {
  return turnContext.getStore() ?? null
}

function getMaxHistory(): number {
  const n = Number(process.env.BIG_PPT_HISTORY_MAX)
  return Number.isFinite(n) && n >= 2 ? n : 20
}

function getSlidesHash(): string {
  const { slidesPath } = getPaths()
  return crypto.createHash('sha1').update(slidesPath).digest('hex').slice(0, 8)
}

function getHistoryRoot(): string {
  const { historyDir } = getPaths()
  return path.join(historyDir, getSlidesHash())
}

function getPointerPath(): string {
  return path.join(getHistoryRoot(), 'pointer.json')
}

function readPointer(): Pointer {
  const p = getPointerPath()
  if (!fs.existsSync(p)) return { currentIndex: -1, files: [], lastTurnId: null }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (
      parsed &&
      typeof parsed === 'object' &&
      'currentIndex' in parsed &&
      'files' in parsed &&
      typeof (parsed as Pointer).currentIndex === 'number' &&
      Array.isArray((parsed as Pointer).files)
    ) {
      const p = parsed as Partial<Pointer> & { currentIndex: number; files: string[] }
      return {
        currentIndex: p.currentIndex,
        files: p.files,
        lastTurnId: typeof p.lastTurnId === 'string' ? p.lastTurnId : null,
      }
    }
  } catch {
    /* fall through */
  }
  return { currentIndex: -1, files: [], lastTurnId: null }
}

function writePointer(ptr: Pointer): void {
  const p = getPointerPath()
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(ptr, null, 2), 'utf-8')
  } catch {
    // 写 pointer 失败不致命：下一次 appendHistory 会重建
  }
}

function writeSnapshot(op: string, content: string): string {
  const root = getHistoryRoot()
  fs.mkdirSync(root, { recursive: true })
  const filename = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${op}.md`
  fs.writeFileSync(path.join(root, filename), content, 'utf-8')
  return filename
}

function overwriteSnapshot(filename: string, content: string): void {
  const root = getHistoryRoot()
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, filename), content, 'utf-8')
}

function readSnapshot(filename: string): string {
  return fs.readFileSync(path.join(getHistoryRoot(), filename), 'utf-8')
}

function removeSnapshot(filename: string): void {
  try {
    fs.unlinkSync(path.join(getHistoryRoot(), filename))
  } catch {
    /* ignore */
  }
}

function toPosition(ptr: Pointer): HistoryPosition | undefined {
  if (ptr.currentIndex < 0 || ptr.files.length === 0) return undefined
  return { index: ptr.currentIndex + 1, total: ptr.files.length }
}

/**
 * 记录一次即将发生的写操作的快照。
 *
 * 调用时机：**先调本函数，再写 slides.md**。
 *
 * 行为：
 * 1. 首次调用且 slides.md 已有内容：先把 pre-write 内容作为 list[0]（op=`init`）。
 * 2. 轮次聚合：若 `getCurrentTurnId() === pointer.lastTurnId`（同一个用户轮次内的第 N 次写），
 *    **覆盖** files[currentIndex] 的 snapshot 文件，保持 history 条数不变。
 * 3. 跨轮次 / 无 turn 上下文：截断 redo 栈 → append 新快照 → currentIndex 前进；
 *    超过 MAX 时 shift 最旧的。
 */
export function appendHistory(op: string, newContent: string): void {
  const { slidesPath } = getPaths()
  const ptr = readPointer()
  const currentTurnId = getCurrentTurnId()

  // 首次：snapshot pre-write
  if (ptr.files.length === 0 && fs.existsSync(slidesPath)) {
    try {
      const preContent = fs.readFileSync(slidesPath, 'utf-8')
      const preFile = writeSnapshot('init', preContent)
      ptr.files.push(preFile)
      ptr.currentIndex = 0
    } catch {
      /* 读不了 pre-write 内容跳过，不致命 */
    }
  }

  // 轮次合并：同一 turn 的后续写，覆盖末端快照，不 push
  if (
    currentTurnId &&
    ptr.lastTurnId === currentTurnId &&
    ptr.currentIndex === ptr.files.length - 1 &&
    ptr.currentIndex >= 0
  ) {
    const last = ptr.files[ptr.currentIndex]!
    overwriteSnapshot(last, newContent)
    writePointer(ptr)
    return
  }

  // 截断 redo 栈
  if (ptr.currentIndex >= 0 && ptr.currentIndex < ptr.files.length - 1) {
    const discarded = ptr.files.splice(ptr.currentIndex + 1)
    for (const f of discarded) removeSnapshot(f)
  }

  // push 新快照
  const newFile = writeSnapshot(op, newContent)
  ptr.files.push(newFile)
  ptr.currentIndex = ptr.files.length - 1
  ptr.lastTurnId = currentTurnId

  // 环形裁剪（保留 MAX 个）
  const max = getMaxHistory()
  while (ptr.files.length > max) {
    const oldest = ptr.files.shift()
    if (oldest) removeSnapshot(oldest)
    ptr.currentIndex--
  }

  writePointer(ptr)
}

export interface HistoryActionResult {
  success: boolean
  message?: string
  position?: HistoryPosition
  error?: string
}

export function undo(): HistoryActionResult {
  const ptr = readPointer()
  if (ptr.currentIndex <= 0) {
    return { success: false, error: '已到最早的历史，无法继续撤销' }
  }
  ptr.currentIndex--
  const content = readSnapshot(ptr.files[ptr.currentIndex]!)
  const { slidesPath } = getPaths()
  fs.writeFileSync(slidesPath, content, 'utf-8')
  // undo 动作本身不属于任何 turn —— 下次 appendHistory 会以新 turn push 新条目（或截断）
  ptr.lastTurnId = null
  writePointer(ptr)
  const pos = toPosition(ptr)
  return {
    success: true,
    message: pos ? `已撤销到第 ${pos.index} / ${pos.total} 版` : '已撤销到上一个版本',
    position: pos,
  }
}

export function redo(): HistoryActionResult {
  const ptr = readPointer()
  if (ptr.currentIndex < 0 || ptr.currentIndex >= ptr.files.length - 1) {
    return { success: false, error: '已到最新版本，无可重做' }
  }
  ptr.currentIndex++
  const content = readSnapshot(ptr.files[ptr.currentIndex]!)
  const { slidesPath } = getPaths()
  fs.writeFileSync(slidesPath, content, 'utf-8')
  ptr.lastTurnId = null
  writePointer(ptr)
  const pos = toPosition(ptr)
  return {
    success: true,
    message: pos ? `已重做到第 ${pos.index} / ${pos.total} 版` : '已重做到下一个版本',
    position: pos,
  }
}

export function listHistory(): {
  files: string[]
  currentIndex: number
  lastTurnId: string | null
} {
  const ptr = readPointer()
  return { files: [...ptr.files], currentIndex: ptr.currentIndex, lastTurnId: ptr.lastTurnId }
}
