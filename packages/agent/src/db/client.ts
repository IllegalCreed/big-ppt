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
