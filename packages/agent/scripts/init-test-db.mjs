#!/usr/bin/env node
/**
 * `init-db.mjs --env=test` 的友好 wrapper。
 *
 * 用法：pnpm -F @big-ppt/agent init-test-db
 *       pnpm -F @big-ppt/agent init-test-db -- --rotate    # 强制 rotate 密码
 *
 * 完全等价于：node scripts/init-db.mjs --env=test [--rotate]
 */
if (!process.argv.includes('--env=test') && !process.argv.includes('--env')) {
  process.argv.push('--env=test')
}
await import('./init-db.mjs')
