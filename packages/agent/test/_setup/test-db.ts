/**
 * Integration test 的 DB 生命周期 helper。
 *
 * - `resetDb()`：DELETE FROM 8 张表（关闭 FK 检查）+ 清 slidev-lock 内存 + 清 mcp registry 内存 + 清 rate-limit 计数
 * - `useTestDb()`：在 describe 块外调用，挂 beforeEach(resetDb) + afterAll(closeDb)
 *
 * 依赖：
 *   - DATABASE_URL 通过 dotenv-cli 从 .env.test.local 注入
 *   - test DB schema 已 push（`pnpm -F @big-ppt/agent db:push:test`）
 *   - vitest fileParallelism=false 保证文件间不抢 DB 连接
 *
 * **为什么用 DELETE 不用 TRUNCATE**：lumideck_test 跑在 Aliyun RDS，drizzle 走
 * mysql2 prepared statement(`pool.execute`)。TRUNCATE 在 InnoDB 下相当于
 * drop+recreate 表，服务端把之前 prepared 的 statement plan 标记失效；标准 mysql
 * 会让客户端拿到 re-prepare 错误并自动重试，**但 Aliyun RDS 代理层不会抛该错，
 * 而是静默返回 0 行**。表现为 INSERT 成功后 immediate SELECT 偶发返回 empty
 * (200 跑 1~4 次)；进而连锁触发 createTestUser → createSessionFor FK 违反、
 * 后续 API 调用 cookie 拿不到 session → 401。改用 `DELETE FROM` 不动表结构，
 * prepared statement plan 保留有效，问题消失(reproducer 600 跑 0 失败)。
 *
 * 副作用：DELETE 不 reset AUTO_INCREMENT —— tests 全部用动态 user.id，不依赖
 * id===1。批量行时 DELETE 比 TRUNCATE 慢，但测试表都 < 100 行可忽略。
 */
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../../src/db/index.js'
import { __resetForTesting as resetSlidevLock } from '../../src/slidev-lock.js'
import { __resetRegistryForTesting as resetMcpRegistries } from '../../src/mcp-registry/index.js'
import { __resetRateLimitForTesting } from '../../src/middleware/rate-limit.js'

export async function resetDb(): Promise<void> {
  const db = getDb()
  await db.execute(sql`SET FOREIGN_KEY_CHECKS=0`)
  await db.execute(sql`DELETE FROM user_assets`)
  await db.execute(sql`DELETE FROM user_mcp_servers`)
  await db.execute(sql`DELETE FROM deck_assets`)
  await db.execute(sql`DELETE FROM deck_chats`)
  await db.execute(sql`DELETE FROM deck_versions`)
  await db.execute(sql`DELETE FROM decks`)
  await db.execute(sql`DELETE FROM sessions`)
  await db.execute(sql`DELETE FROM users`)
  await db.execute(sql`SET FOREIGN_KEY_CHECKS=1`)
  resetSlidevLock()
  resetMcpRegistries()
  __resetRateLimitForTesting()
}

/** 在 integration test 文件顶部调用一次 */
export function useTestDb(): void {
  // Phase 11.8: 跨 file 累积 prepared statement plan 在 Aliyun RDS 上会撞 stale 问题
  // (schema 加列后尤甚)。每个 file 开始时 force close 重开 pool + warmup query
  // 强制新 connection 拿 fresh prepared cache。
  beforeAll(async () => {
    await closeDb()
    // Warmup:跑几条 dummy SELECT/INSERT 让 mysql2 prepared cache 在新 connection 上
    // 建立 fresh plan,绕过 Aliyun 代理层 silently 复用 stale plan 的 bug。
    // 这些 dummy 操作不依赖测试 fixtures,只验 schema 完整性。
    const db = getDb()
    await db.execute(sql`SELECT 1`)
    await db.execute(sql`SELECT id FROM users LIMIT 1`)
    await db.execute(sql`SELECT id FROM sessions LIMIT 1`)
    await db.execute(sql`SELECT id FROM decks LIMIT 1`)
    await db.execute(sql`SELECT id FROM deck_versions LIMIT 1`)
    await db.execute(sql`SELECT id FROM deck_assets LIMIT 1`)
  })
  beforeEach(async () => {
    await resetDb()
  })
  afterAll(async () => {
    await closeDb()
  })
}
