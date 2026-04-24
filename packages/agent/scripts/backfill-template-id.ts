/**
 * Phase 6B 一次性回填脚本：把 `decks.template_id` 为 NULL / 空字符串的老记录
 * 回填为 `company-standard`。
 *
 * 幂等：多次运行结果一致（第二次应影响 0 行）。
 * 用法：
 *   # 预览要改的行数
 *   pnpm -F @big-ppt/agent exec tsx scripts/backfill-template-id.ts --dry-run
 *   # 实际写入
 *   pnpm -F @big-ppt/agent exec tsx scripts/backfill-template-id.ts
 *
 * 由于 schema 上 `template_id` 字段有 DEFAULT 'company-standard' NOT NULL，
 * 加字段时 MySQL 会自动把所有已存在的 row 回填为默认值。这个脚本主要用于
 * 双重保险（例如历史上手动 INSERT 时绕过默认值的场景）以及 dry-run 审计。
 */
import { config as loadDotenv } from 'dotenv'
if (!process.env.DATABASE_URL) {
  loadDotenv({ path: ['.env.development.local', '.env.local'] })
}

import mysql from 'mysql2/promise'

const DRY_RUN = process.argv.includes('--dry-run')
const DEFAULT_TEMPLATE_ID = 'company-standard'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL 未设置；确认 .env.development.local 或通过 dotenv-cli 注入')
  }

  const conn = await mysql.createConnection(url)
  try {
    const [toFix] = (await conn.query(
      `SELECT id, user_id, title, template_id
         FROM decks
        WHERE template_id IS NULL OR template_id = ''`,
    )) as [Array<{ id: number; user_id: number; title: string; template_id: string | null }>, unknown]

    console.log(`[backfill] 检测到 ${toFix.length} 条 deck 需要回填 template_id=${DEFAULT_TEMPLATE_ID}`)
    if (toFix.length > 0) {
      for (const row of toFix.slice(0, 10)) {
        console.log(`  · id=${row.id} user_id=${row.user_id} title=${row.title} current=${row.template_id ?? 'NULL'}`)
      }
      if (toFix.length > 10) console.log(`  · ...（剩余 ${toFix.length - 10} 条未展示）`)
    }

    if (DRY_RUN) {
      console.log('[backfill] --dry-run 模式，未实际写入')
      return
    }

    if (toFix.length === 0) {
      console.log('[backfill] 无需要更新的记录，幂等退出')
      return
    }

    const [result] = (await conn.execute(
      `UPDATE decks
          SET template_id = ?
        WHERE template_id IS NULL OR template_id = ''`,
      [DEFAULT_TEMPLATE_ID],
    )) as [{ affectedRows: number; changedRows: number }, unknown]

    console.log(`[backfill] 更新完成：affectedRows=${result.affectedRows} changedRows=${result.changedRows}`)
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('[backfill] 失败:', err)
  process.exit(1)
})
