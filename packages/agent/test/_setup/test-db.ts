/**
 * Integration test 的 DB 生命周期 helper。
 *
 * - `resetDb()`：TRUNCATE 5 张表（关闭 FK 检查）+ 清 slidev-lock 内存
 * - `useTestDb()`：在 describe 块外调用，挂 beforeEach(resetDb) + afterAll(closeDb)
 *
 * 依赖：
 *   - DATABASE_URL 通过 dotenv-cli 从 .env.test.local 注入
 *   - test DB schema 已 push（`pnpm -F @big-ppt/agent db:push:test`）
 *   - vitest fileParallelism=false 保证文件间不抢 DB 连接
 */
import { afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../../src/db/index.js'
import { __resetForTesting as resetSlidevLock } from '../../src/slidev-lock.js'

export async function resetDb(): Promise<void> {
  const db = getDb()
  await db.execute(sql`SET FOREIGN_KEY_CHECKS=0`)
  await db.execute(sql`TRUNCATE TABLE deck_chats`)
  await db.execute(sql`TRUNCATE TABLE deck_versions`)
  await db.execute(sql`TRUNCATE TABLE decks`)
  await db.execute(sql`TRUNCATE TABLE sessions`)
  await db.execute(sql`TRUNCATE TABLE users`)
  await db.execute(sql`SET FOREIGN_KEY_CHECKS=1`)
  resetSlidevLock()
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
