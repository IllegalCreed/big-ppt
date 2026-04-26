#!/usr/bin/env tsx
/**
 * Phase 7.5D-4：一次性迁移 CLI。把 deck_versions.content 中引用已删除的旧 layout
 * （beitou-data / beitou-two-col / beitou-image-content / jingyeda-同名）
 * 重写为 layer-1 `<prefix>-content` + 移除老 layout 特有 frontmatter 字段。
 *
 * **MVP 策略（数据保全优先）**：
 *   - frontmatter `layout:` 字段降级到 content
 *   - 移除老 layout 特有字段（metrics / leftTitle / rightTitle / image / textTitle）
 *   - **body 文字保留不动**——`::left::` `::right::` Slidev slot 语法在新 content
 *     layout 下不渲染（默认 slot 内全是文字），用户可在 dev 模式下让 AI 重写为公共组件
 *   - 每条改写落**新 version**（不覆盖老 version），message 描述迁移；保留 /undo 路径
 *
 * 用法：
 *   pnpm -F @big-ppt/agent tsx scripts/migrate-deprecated-layouts.ts            # dry-run
 *   pnpm -F @big-ppt/agent tsx scripts/migrate-deprecated-layouts.ts --apply    # 实跑
 *   pnpm -F @big-ppt/agent tsx scripts/migrate-deprecated-layouts.ts --verbose  # 双份对比 log
 *
 * 幂等：第二次跑遇全是新 layout 的 deck → 0 affected。
 */
import { eq, sql } from 'drizzle-orm'
import { getDb, decks, deckVersions } from '../src/db/index.js'
import {
  migrateContent,
  OLD_LAYOUT_PATTERN,
  REMOVE_FIELDS,
  type PageRewriteSummary,
} from '../src/templates/migrate-deprecated-layouts.js'

const APPLY = process.argv.includes('--apply')
const VERBOSE = process.argv.includes('--verbose')

interface DeckMigrationResult {
  deckId: number
  versionId: number
  pageRewrites: PageRewriteSummary[]
  oldContent: string
  newContent: string
}

async function main() {
  console.log('\n=== Phase 7.5D-4 一次性迁移：deprecated layouts → content ===\n')
  console.log(`模式：${APPLY ? '\x1b[31mAPPLY（实跑）\x1b[0m' : '\x1b[33mDRY-RUN\x1b[0m'}`)
  console.log(`匹配模式：${OLD_LAYOUT_PATTERN}`)
  console.log(`移除老 frontmatter 字段：${REMOVE_FIELDS.join(', ')}`)
  console.log()

  const db = getDb()
  const rows = await db
    .select({
      deckId: decks.id,
      versionId: decks.currentVersionId,
      title: decks.title,
    })
    .from(decks)

  const candidates: DeckMigrationResult[] = []
  let scanned = 0
  let skipped = 0

  for (const row of rows) {
    if (!row.versionId) continue
    scanned++
    const [v] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, row.versionId))
      .limit(1)
    if (!v) continue
    const oldContent = v.content
    const { newContent, pageRewrites } = migrateContent(oldContent)
    if (pageRewrites.length === 0) {
      skipped++
      continue
    }
    candidates.push({
      deckId: row.deckId,
      versionId: row.versionId,
      pageRewrites,
      oldContent,
      newContent,
    })
  }

  console.log(`扫描 ${scanned} 个 deck（current_version_id 非空）：`)
  console.log(`  - ${candidates.length} 个 deck 含旧 layout，待迁移`)
  console.log(`  - ${skipped} 个 deck 已是新架构（skip）\n`)

  for (const c of candidates) {
    console.log(`📦 deck #${c.deckId}（version #${c.versionId}）`)
    for (const r of c.pageRewrites) {
      console.log(
        `   page ${r.pageIndex}: ${r.oldLayout} → ${r.newLayout}` +
          (r.removedFields.length > 0 ? `（删除字段：${r.removedFields.join(', ')}）` : ''),
      )
    }
    if (VERBOSE) {
      console.log('  --- OLD CONTENT ---')
      console.log(c.oldContent)
      console.log('  --- NEW CONTENT ---')
      console.log(c.newContent)
      console.log()
    }
  }

  if (!APPLY) {
    console.log(
      '\n\x1b[33m[DRY-RUN]\x1b[0m 加 --apply 实跑（每条 deck 落新 version，老 version 保留可 /undo）。',
    )
    console.log('\x1b[33m[DRY-RUN]\x1b[0m 加 --verbose 看每条 deck 改写前后对比。\n')
    return
  }

  console.log('\n开始实施：\n')
  let migrated = 0
  for (const c of candidates) {
    const [deckRow] = await db.select().from(decks).where(eq(decks.id, c.deckId)).limit(1)
    if (!deckRow) continue
    const message = `Phase 7.5 layout 收敛迁移：${c.pageRewrites.length} 页旧 layout → content`
    await db.insert(deckVersions).values({
      deckId: c.deckId,
      content: c.newContent,
      message,
      authorId: deckRow.userId,
      templateId: deckRow.templateId,
    })
    const [newest] = await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(eq(deckVersions.deckId, c.deckId))
      .orderBy(sql`${deckVersions.id} desc`)
      .limit(1)
    if (newest) {
      await db.update(decks).set({ currentVersionId: newest.id }).where(eq(decks.id, c.deckId))
    }
    console.log(`  ✓ deck #${c.deckId} 落 version #${newest?.id}`)
    migrated++
  }
  console.log(`\n✅ 完成：${migrated} 个 deck 已迁移。\n`)
}

main().catch((err) => {
  console.error('迁移脚本失败：', err)
  process.exit(1)
})
