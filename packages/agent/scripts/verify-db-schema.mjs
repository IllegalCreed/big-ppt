/**
 * 校验目标 DB 实际结构是否覆盖 drizzle schema(代码期望)— 部署 reload 前置门。
 *
 * 背景(2026-07-14 Phase 17 部署事故):drizzle-kit push 在非 TTY 下遇交互确认
 * (如给有数据的表加唯一索引)会崩溃但 exit 0,deploy 脚本照常 pm2 reload →
 * 生产出现「新代码 + 旧 schema」裂窗,drizzle select 显式列新列名直接
 * ER_BAD_FIELD_ERROR。本脚本以 dist/db/schema.js 为 source of truth,
 * 对比 information_schema 的表/列/索引名,任何缺失都非零退出,让部署在
 * reload 之前停下(旧进程保持运行)。
 *
 * 只做「代码需要的,DB 是否都有」的单向检查:DB 多出的列/表(历史遗留)不报错。
 * 类型/默认值不在此校验范围(drizzle push 漏 DEFAULT 的坑见 CLAUDE.md,
 * 需要时单独人工 SHOW COLUMNS)。
 *
 * 注意:读的是 **dist** 编译产物,不是 src —— 部署流程 build_agent() 先跑 tsc,
 * 保证 dist 新鲜;本地单独跑之前先 `pnpm -F @big-ppt/agent build`。
 *
 * 用法:pnpm -F @big-ppt/agent db:verify[:test|:prod]
 */
import mysql from 'mysql2/promise'
import { getTableConfig } from 'drizzle-orm/mysql-core'
import * as schema from '../dist/db/schema.js'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('[verify-db-schema] DATABASE_URL 未设置(dotenv -e 对应 env 文件)')
  process.exit(2)
}

const conn = await mysql.createConnection(url)
const problems = []
let checkedTables = 0

try {
  for (const exported of Object.values(schema)) {
    let cfg
    try {
      cfg = getTableConfig(exported)
    } catch {
      continue // 非 mysqlTable 的导出(enum / helper)跳过
    }
    checkedTables += 1
    const tableName = cfg.name

    const [tbl] = await conn.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [tableName],
    )
    if (tbl.length === 0) {
      problems.push(`缺表: ${tableName}`)
      continue
    }

    const [colRows] = await conn.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [tableName],
    )
    const dbCols = new Set(colRows.map((r) => r.COLUMN_NAME))
    for (const col of Object.values(cfg.columns)) {
      if (!dbCols.has(col.name)) problems.push(`缺列: ${tableName}.${col.name}`)
    }

    const [idxRows] = await conn.query(
      'SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [tableName],
    )
    const dbIdx = new Set(idxRows.map((r) => r.INDEX_NAME))
    for (const idx of cfg.indexes) {
      // drizzle-orm 0.45 mysql-core: IndexBuilder 实例把名字埋在 config.name
      const idxName = idx?.config?.name ?? idx?.name
      if (typeof idxName === 'string' && idxName && !dbIdx.has(idxName)) {
        problems.push(`缺索引: ${tableName}.${idxName}`)
      }
    }
  }
} finally {
  await conn.end()
}

if (checkedTables === 0) {
  console.error('[verify-db-schema] ✗ 没有从 dist/db/schema.js 解析出任何表 — dist 是否过期?')
  process.exit(2)
}

if (problems.length > 0) {
  console.error(`[verify-db-schema] ✗ DB schema 落后于代码,共 ${problems.length} 项:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`[verify-db-schema] ✓ ${checkedTables} 张表的列/索引均已就位,schema 与代码一致`)
