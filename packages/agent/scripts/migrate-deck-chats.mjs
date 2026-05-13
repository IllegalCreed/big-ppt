#!/usr/bin/env node
/**
 * Phase 12 Task F:一次性回填 deck_chats.canonical_content 列。
 *
 * 老 row(canonical_content IS NULL)的 content + tool_call_id 通过
 * legacyRowToCanonical() 重组成 Block[] → JSON.stringify → 写入 canonical_content。
 * 不动老字段 content / tool_call_id(保留供历史 reader / backup)。
 *
 * 用法:
 *   pnpm -F @big-ppt/agent migrate:deck-chats        # 开发库
 *   pnpm -F @big-ppt/agent migrate:deck-chats:test   # 测试库
 *   pnpm -F @big-ppt/agent migrate:deck-chats:prod   # 生产
 *
 * 依赖:本脚本是 thin wrapper,核心 logic 在 src/llm/migrations.ts。
 * 跑之前必须先 `pnpm -F @big-ppt/agent build`。
 *
 * 行为:
 * - 批 100 row 一组 SELECT canonical_content IS NULL → 重组 → UPDATE
 * - 失败一条不停整批,记 failed;退出码:全 success 返 0,有 failed 返 1
 */

import mysql from 'mysql2/promise'
import { migrateDeckChats } from '../dist/llm/migrations.js'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('[migrate-deck-chats] DATABASE_URL 未设置;请先用 dotenv-cli wrap 跑本脚本')
  process.exit(2)
}

const conn = await mysql.createConnection(dbUrl)
let stats
try {
  stats = await migrateDeckChats(conn, { batchSize: 100 })
} finally {
  await conn.end()
}

console.log(
  `[migrate-deck-chats] migrated=${stats.migrated} skipped=${stats.skipped} failed=${stats.failed.length}`,
)
if (stats.failed.length > 0) {
  console.log('[migrate-deck-chats] failed rows:')
  console.log(JSON.stringify(stats.failed, null, 2))
  process.exit(1)
}
process.exit(0)
