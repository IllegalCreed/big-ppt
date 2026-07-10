/**
 * Playwright 共享 helper：连 lumideck_test，提供 truncateAll() 和 baseURL。
 */
import 'dotenv/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import mysql from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
const quotaEnvBeforeDotenv = {
  LUMIDECK_QUOTA_PER_FILE_BYTES: process.env.LUMIDECK_QUOTA_PER_FILE_BYTES,
  LUMIDECK_QUOTA_PER_USER_BYTES: process.env.LUMIDECK_QUOTA_PER_USER_BYTES,
}
loadEnv({ path: resolve(__dirname, '../../../agent/.env.test.local') })
for (const [key, value] of Object.entries(quotaEnvBeforeDotenv)) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

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
    // Phase 13:加 user_assets 清理(quota / list/delete spec 依赖空表)。
    // 注:e2e helper 仍用 TRUNCATE 是因为 Playwright runtime 不走 drizzle prepared
    // statement(纯 mysql2 query),不触发 Aliyun RDS stale-plan bug;agent
    // 集成测才必须用 DELETE FROM(见 test-db.ts 注释)。
    await conn.query('TRUNCATE TABLE user_assets')
    await conn.query('TRUNCATE TABLE user_mcp_servers')
    await conn.query('TRUNCATE TABLE deck_assets')
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
  // 防止残留锁导致下一条 present 抢锁遇到 409 冲突（Phase 10.5 起锁仅在 present 路径取）。
  // Phase 9-D：state-changing POST 受 originCheck 守卫，必须带 Origin（dev 兜底允许 localhost）
  try {
    await fetch(`${AGENT_BASE}/api/_test/reset-lock`, {
      method: 'POST',
      headers: { Origin: AGENT_BASE },
    })
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

// ─── Phase 11.5：deck_assets 直读 helper ──────────────────────────────

export type DeckAssetRow = {
  id: string
  deck_id: number
  user_id: number
  mime_type: string
  bytes_size: number
}

/** 数指定 deck 的 asset 行数 */
export async function countAssetsByDeck(deckId: number): Promise<number> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM deck_assets WHERE deck_id = ?',
    [deckId],
  )
  return Number((rows[0] as { n: number }).n)
}

/** 列指定 deck 的全部 asset 元数据(不带字节) */
export async function listAssetsByDeckSql(deckId: number): Promise<DeckAssetRow[]> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT id, deck_id, user_id, mime_type, bytes_size FROM deck_assets WHERE deck_id = ?',
    [deckId],
  )
  return rows as DeckAssetRow[]
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

// ─── deck_versions / deck_chats 直读 helper (lifecycle 测专用) ───────────

/** 数指定 deck 的 deck_versions 行数（含初始 + tool call 写入快照） */
export async function countVersionsByDeck(deckId: number): Promise<number> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM deck_versions WHERE deck_id = ?',
    [deckId],
  )
  return Number((rows[0] as { n: number }).n)
}

/** 数指定 deck 的 deck_chats 行数 */
export async function countChatsByDeck(deckId: number): Promise<number> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM deck_chats WHERE deck_id = ?',
    [deckId],
  )
  return Number((rows[0] as { n: number }).n)
}

/** 列指定 deck 的所有 deck_versions（最新优先,带 content） */
export async function listVersionsByDeckSql(deckId: number): Promise<
  Array<{ id: number; deck_id: number; content: string; message: string | null; turn_id: string | null; created_at: Date }>
> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT id, deck_id, content, message, turn_id, created_at FROM deck_versions WHERE deck_id = ? ORDER BY id DESC',
    [deckId],
  )
  return rows as Array<{
    id: number
    deck_id: number
    content: string
    message: string | null
    turn_id: string | null
    created_at: Date
  }>
}

/** 直读 deck 行(无 ownership 检查),lifecycle 验删完后行不存在(soft delete 时返 status='deleted') */
export async function getDeckRawSql(id: number): Promise<DeckRow | null> {
  const [rows] = await getPool().query<mysql.RowDataPacket[]>(
    'SELECT id, user_id, title, template_id, current_version_id, status FROM decks WHERE id = ? LIMIT 1',
    [id],
  )
  return (rows[0] as DeckRow) ?? null
}
