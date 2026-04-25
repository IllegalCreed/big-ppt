/**
 * Playwright 共享 helper：连 lumideck_test，提供 truncateAll() 和 baseURL。
 */
import 'dotenv/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../../agent/.env.test.local') })

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (pool) return pool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 未设置（请确保 packages/agent/.env.test.local 已生成）')
  pool = mysql.createPool(url)
  return pool
}

export async function truncateAllTables(): Promise<void> {
  const conn = await getPool().getConnection()
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS=0')
    await conn.query('TRUNCATE TABLE deck_chats')
    await conn.query('TRUNCATE TABLE deck_versions')
    await conn.query('TRUNCATE TABLE decks')
    await conn.query('TRUNCATE TABLE sessions')
    await conn.query('TRUNCATE TABLE users')
    await conn.query('SET FOREIGN_KEY_CHECKS=1')
  } finally {
    conn.release()
  }
  // DB session 已清空，同步重置 agent 进程内的内存锁状态，
  // 防止残留锁导致下一条测试 activate-deck 遇到 409 冲突。
  try {
    await fetch(`${AGENT_BASE}/api/_test/reset-lock`, { method: 'POST' })
  } catch {
    // agent 未启动时忽略（本地单元测试场景）
  }
}

export async function disposeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export const AGENT_BASE = `http://localhost:${process.env.AGENT_PORT ?? 4100}`

// ─── Phase 7D：deck / version / template 直读 helper ──────────────────

export type DeckRow = {
  id: number
  user_id: number
  title: string
  template_id: string
  current_version_id: number | null
  status: 'active' | 'archived' | 'deleted'
}

/** 直读 lumideck_test，断言 decks.template_id 等字段 */
export async function getDeckByIdSql(id: number): Promise<DeckRow | null> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT id, user_id, title, template_id, current_version_id, status FROM decks WHERE id = ? LIMIT 1',
    [id],
  )
  return (rows[0] as DeckRow) ?? null
}

/** 拿当前 deck 的当前 version content；deck.current_version_id NULL 时返 null */
export async function getCurrentVersionContent(deckId: number): Promise<string | null> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    `SELECT v.content
       FROM decks d
       JOIN deck_versions v ON v.id = d.current_version_id
      WHERE d.id = ?
      LIMIT 1`,
    [deckId],
  )
  return ((rows[0]?.content as string) ?? null) as string | null
}

/** 读模板 manifest 拿到 layouts 白名单（spec 里断言每页 layout 都属此白名单） */
export async function getTemplateLayoutNames(templateId: string): Promise<string[]> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const root = resolve(__dirname, '../../../slidev/templates', templateId, 'manifest.json')
  const raw = await fs.readFile(root, 'utf-8')
  const m = JSON.parse(raw) as { layouts: { name: string }[] }
  return m.layouts.map((l) => l.name)
  // path 本身没用上，只是确保 import 类型不会报错（rg ts-prune 时清理）
  void path
}

/** 提取 slides.md 全文里所有 frontmatter 的 layout 字段 */
export function extractLayouts(content: string): string[] {
  const out: string[] = []
  // 解析 frontmatter 块（--- ... ---）
  const blocks = content.split(/^---\s*$/m)
  // blocks[0] 是开头空内容，blocks[1] 是第一个 frontmatter，blocks[2] body，blocks[3] frontmatter, ...
  for (let i = 1; i < blocks.length; i += 2) {
    const fm = blocks[i] ?? ''
    const m = fm.match(/^layout:\s*([^\s#]+)/m)
    if (m) out.push(m[1]!)
  }
  return out
}
