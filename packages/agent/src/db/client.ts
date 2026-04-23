/**
 * MySQL 连接池 + Drizzle 客户端。
 *
 * 连接串从 process.env.DATABASE_URL 读取，示例：
 *   mysql://USER:PASSWORD@HOST:PORT/lumideck
 *
 * 敏感信息严禁进仓（详见 packages/agent/.env.example）。
 */
import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from './schema.js'

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      '[agent/db] DATABASE_URL 未设置。请在 packages/agent/.env.local 中填入连接串（参考 .env.example）。',
    )
  }
  return url
}

let _pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      uri: getDatabaseUrl(),
      connectionLimit: 10,
      waitForConnections: true,
      namedPlaceholders: true,
      // 客户端统一用 UTC 序列化 JS Date；避免与服务端会话时区不一致
      // 造成 DATETIME 比较错位（实测：锁的 heartbeat 会被误判为永远过期）
      timezone: 'Z',
    })

    // 每条新连接创建时把会话时区改为 UTC，保证 NOW() / 存储 / 比较都在同一基准。
    // mysql2/promise Pool 的 'connection' 事件依然派发 callback-based Connection，
    // 所以用 callback 形式的 query。
    type RawConn = { query: (sql: string, cb: (err: Error | null) => void) => void }
    _pool.on('connection', (rawConn) => {
      const conn = rawConn as unknown as RawConn
      conn.query("SET time_zone = '+00:00'", (err) => {
        if (err) console.error('[db] failed to set session time_zone:', err.message)
      })
    })
  }
  return _pool
}

function createDb() {
  return drizzle(getPool(), { schema, mode: 'default' })
}

type Db = ReturnType<typeof createDb>
let _db: Db | null = null

export function getDb(): Db {
  if (!_db) _db = createDb()
  return _db
}

/** 测试/热重启用，主动关闭连接池 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = null
    _db = null
  }
}
