#!/usr/bin/env node
/**
 * Phase 12.7 Task E:一次性 migrate users.llm_settings 把
 * `advanced.<scope>.thinkingEnabled`(boolean)→ `thinkingLevel`(enum 6 档)。
 *
 * 用法:
 *   pnpm -F @big-ppt/agent migrate:thinking-level       # 开发库 lumideck_dev
 *   pnpm -F @big-ppt/agent migrate:thinking-level:test  # 测试库 lumideck_test
 *   pnpm -F @big-ppt/agent migrate:thinking-level:prod  # 生产 RDS(部署前手动跑一次)
 *
 * 跑之前必须先 `pnpm -F @big-ppt/agent build` 让 dist/ 有编译产物。
 *
 * 行为(详见 src/llm/migrations.ts migrateThinkingLevel):
 * - 老 row(含 thinkingEnabled 字段)→ 转 thinkingLevel:false='off' / true='medium'
 * - 已迁移 / 没 thinkingEnabled 字段 → skip
 * - decrypt / parse / zod 校验失败 → 记 failed 列表,继续下一条
 * - 退出码:全 success 返 0;有 failed 返 1
 */

import mysql from 'mysql2/promise'
import { encryptApiKey, decryptApiKey } from '../dist/crypto/apikey.js'
import { migrateThinkingLevel } from '../dist/llm/migrations.js'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('[migrate-thinking-level] DATABASE_URL 未设置;请先用 dotenv-cli wrap 跑本脚本')
  process.exit(2)
}

const conn = await mysql.createConnection(dbUrl)
let stats
try {
  stats = await migrateThinkingLevel(conn, {
    encrypt: encryptApiKey,
    decrypt: decryptApiKey,
  })
} finally {
  await conn.end()
}

console.log(
  `[migrate-thinking-level] migrated=${stats.migrated} skipped=${stats.skipped} failed=${stats.failed.length}`,
)
if (stats.failed.length > 0) {
  console.log('[migrate-thinking-level] failed users:')
  console.log(JSON.stringify(stats.failed, null, 2))
  process.exit(1)
}
process.exit(0)
