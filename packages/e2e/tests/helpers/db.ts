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
