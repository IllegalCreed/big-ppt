/**
 * Phase 7A 一次性数据迁移：把 decks.template_id 由 'company-standard' 改为 'beitou-standard'。
 *
 * 配套 schema.ts 的 DEFAULT 重命名（drizzle-kit push 已落地新 DEFAULT 但不会改老 row）。
 *
 * 幂等：第二次运行 affectedRows = 0。
 * 用法：
 *   # 预览要改的行数
 *   pnpm -F @big-ppt/agent exec dotenv -e .env.development.local -- tsx scripts/rename-template-id.ts --dry-run
 *   # 实际写入
 *   pnpm -F @big-ppt/agent exec dotenv -e .env.development.local -- tsx scripts/rename-template-id.ts
 */
import { config as loadDotenv } from 'dotenv'
if (!process.env.DATABASE_URL) {
  loadDotenv({ path: ['.env.development.local', '.env.local'] })
}

import mysql from 'mysql2/promise'

const DRY_RUN = process.argv.includes('--dry-run')
const FROM_ID = 'company-standard'
const TO_ID = 'beitou-standard'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL 未设置；通过 dotenv-cli 注入 .env.development.local 等')
  }

  const conn = await mysql.createConnection(url)
  try {
    const [toFix] = (await conn.query(
      `SELECT id, user_id, title, template_id
         FROM decks
        WHERE template_id = ?`,
      [FROM_ID],
    )) as [
      Array<{ id: number; user_id: number; title: string; template_id: string }>,
      unknown,
    ]

    console.log(`[rename] 检测到 ${toFix.length} 条 deck 需要从 ${FROM_ID} 改为 ${TO_ID}`)
    if (toFix.length > 0) {
      for (const row of toFix.slice(0, 10)) {
        console.log(
          `  · id=${row.id} user_id=${row.user_id} title=${row.title}`,
        )
      }
      if (toFix.length > 10) console.log(`  · ...（剩余 ${toFix.length - 10} 条未展示）`)
    }

    if (DRY_RUN) {
      console.log('[rename] --dry-run 模式，未实际写入')
      return
    }

    if (toFix.length === 0) {
      console.log('[rename] 无需要更新的记录，幂等退出')
      return
    }

    const [result] = (await conn.execute(
      `UPDATE decks SET template_id = ? WHERE template_id = ?`,
      [TO_ID, FROM_ID],
    )) as [{ affectedRows: number; changedRows: number }, unknown]

    console.log(
      `[rename] 更新完成：affectedRows=${result.affectedRows} changedRows=${result.changedRows}`,
    )
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('[rename] 失败:', err)
  process.exit(1)
})
