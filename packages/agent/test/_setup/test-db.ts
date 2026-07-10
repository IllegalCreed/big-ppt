/**
 * Integration test 的 DB 生命周期 helper。
 *
 * - `resetDb()`：清空业务表 + 清 MCP registry / rate-limit 内存状态
 * - `useTestDb()`：在 describe 块外调用，挂 beforeEach(resetDb) + afterAll(closeDb)
 *
 * 依赖：
 *   - DATABASE_URL 通过 dotenv-cli 从 .env.test.local 注入
 *   - test DB schema 已 push（`pnpm -F @big-ppt/agent db:push:test`）
 *   - vitest fileParallelism=false 保证文件间不抢 DB 连接
 *
 * 当前使用 TRUNCATE：Aliyun RDS 升到 MySQL 8.0.36 后，旧 prepared-statement stale
 * plan 问题已用 100 次 stress 验证消失。所有测试只依赖动态 id，不依赖具体自增值。
 */
import { afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../../src/db/index.js'
import { __resetRegistryForTesting as resetMcpRegistries } from '../../src/mcp-registry/index.js'
import { __resetRateLimitForTesting } from '../../src/middleware/rate-limit.js'

export async function resetDb(): Promise<void> {
  const db = getDb()
  await db.execute(sql`SET FOREIGN_KEY_CHECKS=0`)
  await db.execute(sql`TRUNCATE TABLE share_links`)
  await db.execute(sql`TRUNCATE TABLE user_assets`)
  await db.execute(sql`TRUNCATE TABLE user_mcp_servers`)
  await db.execute(sql`TRUNCATE TABLE deck_assets`)
  await db.execute(sql`TRUNCATE TABLE deck_chats`)
  await db.execute(sql`TRUNCATE TABLE deck_versions`)
  await db.execute(sql`TRUNCATE TABLE decks`)
  await db.execute(sql`TRUNCATE TABLE sessions`)
  await db.execute(sql`TRUNCATE TABLE users`)
  await db.execute(sql`SET FOREIGN_KEY_CHECKS=1`)
  resetMcpRegistries()
  __resetRateLimitForTesting()
}

/** 在 integration test 文件顶部调用一次 */
export function useTestDb(): void {
  beforeEach(async () => {
    await resetDb()
  })
  afterAll(async () => {
    await closeDb()
  })
}
