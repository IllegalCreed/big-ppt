#!/usr/bin/env node
/**
 * Phase 12 Task F:一次性 migrate users.llm_settings 从 Phase 5 老 shape
 * `{provider, apiKey, baseUrl?, model?, apiType?}` 转成 Phase 12 新 shape
 * `{activeProvider, providers: { [id]: {...} }, advanced?}`。
 *
 * 用法:
 *   pnpm -F @big-ppt/agent migrate:llm-settings       # 开发库 lumideck_dev
 *   pnpm -F @big-ppt/agent migrate:llm-settings:test  # 测试库 lumideck_test
 *   pnpm -F @big-ppt/agent migrate:llm-settings:prod  # 生产 RDS(部署前手动跑一次)
 *
 * 依赖:本脚本是 thin wrapper,核心 logic 在 src/llm/migrations.ts。
 * 跑之前必须先 `pnpm -F @big-ppt/agent build` 让 dist/ 有编译产物。
 * (这跟 deploy/scripts/start-agent.sh 一致 —— 生产场景 .mjs 调 dist/ 是惯例)
 *
 * 行为:
 * - 遍历 llm_settings 非空的 user;已是新 shape(含 activeProvider 字段)→ skip
 * - 老 shape → migrateLegacySettings → parseLlmSettings 验证 → 加密回写
 * - 任何 step 失败记 failed 数组;最后打印统计 + failed 详情
 * - 退出码:全 success 返 0;有 failed 返 1(CI 可识别)
 */

import mysql from 'mysql2/promise'
import { encryptApiKey, decryptApiKey } from '../dist/crypto/apikey.js'
import { migrateLlmSettings } from '../dist/llm/migrations.js'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('[migrate-llm-settings] DATABASE_URL 未设置;请先用 dotenv-cli wrap 跑本脚本')
  process.exit(2)
}

const conn = await mysql.createConnection(dbUrl)
let stats
try {
  stats = await migrateLlmSettings(conn, {
    encrypt: encryptApiKey,
    decrypt: decryptApiKey,
  })
} finally {
  await conn.end()
}

console.log(
  `[migrate-llm-settings] migrated=${stats.migrated} skipped=${stats.skipped} failed=${stats.failed.length}`,
)
if (stats.failed.length > 0) {
  console.log('[migrate-llm-settings] failed users:')
  console.log(JSON.stringify(stats.failed, null, 2))
  process.exit(1)
}
process.exit(0)
