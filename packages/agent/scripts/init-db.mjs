#!/usr/bin/env node
/**
 * Lumideck 数据库初始化（幂等）。
 *
 * 用法：
 *   node scripts/init-db.mjs                          # 默认 --env=development
 *   node scripts/init-db.mjs --env=test               # 建 lumideck_test + lumideck_test_user
 *   node scripts/init-db.mjs --env=test --rotate      # 强制重新随机密码（老连接失效）
 *   node scripts/init-db.mjs --env=production \
 *     --database-url=mysql://prod_user:pw@host:3306/lumideck
 *                                                      # 部署期：直接注入 URL，跳过 root 连接
 *
 * 行为：
 *   1. 若 --database-url 指定：仅把 URL 写进对应 .env.{env}.local（不连 DB）
 *   2. 否则读取 root 凭据文件（默认 packages/agent/.env.create-db.local，
 *      可用 --root-env-file=<path> 或环境变量 LUMIDECK_DB_ROOT_ENV 覆盖），
 *      连接 MySQL 执行 CREATE DATABASE + CREATE USER + GRANT，
 *      再把连接串写进 .env.{env}.local
 *   3. 若目标文件已有 `DATABASE_URL=mysql://...` 且未指定 --rotate，则跳过 DB 改动
 *      避免悄悄 rotate 密码击落现有连接
 *   4. SESSION_SECRET / APIKEY_MASTER_KEY 若为 CHANGE_ME_* 或缺失，自动随机生成一份
 *
 * root 凭据文件需要的字段（参考 .env.create-db.example）：
 *   DATABASE_HOST=...
 *   DATABASE_PORT=3306
 *   DB_ROOT_USERNAME=...
 *   DB_ROOT_PASSWORD=...
 *
 * 密码从不回显到 stdout 或 command line。
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import mysql from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = resolve(__dirname, '..')
const DEFAULT_ROOT_ENV_FILE = resolve(AGENT_DIR, '.env.create-db.local')

// ─── CLI 参数 ───────────────────────────────────────────────────
const argv = process.argv.slice(2)
function arg(name, fallback = undefined) {
  const prefix = `--${name}=`
  const hit = argv.find((a) => a.startsWith(prefix))
  if (hit) return hit.slice(prefix.length)
  if (argv.includes(`--${name}`)) return true
  return fallback
}
const env = arg('env', 'development')
const databaseUrlOverride = arg('database-url')
const rotate = !!arg('rotate', false)
const rootEnvFile = resolve(
  process.cwd(),
  arg('root-env-file') || process.env.LUMIDECK_DB_ROOT_ENV || DEFAULT_ROOT_ENV_FILE,
)

if (!['development', 'test', 'production'].includes(env)) {
  console.error(`✗ --env 只能是 development / test / production，实际：${env}`)
  process.exit(1)
}

const TARGET = {
  development: { db: 'lumideck_dev', user: 'lumideck_dev_user', envFile: '.env.development.local', exampleFile: '.env.development.example' },
  test: { db: 'lumideck_test', user: 'lumideck_test_user', envFile: '.env.test.local', exampleFile: '.env.test.example' },
  production: { db: 'lumideck', user: 'lumideck_prod_user', envFile: '.env.production.local', exampleFile: '.env.production.example' },
}[env]
const envFilePath = resolve(AGENT_DIR, TARGET.envFile)
const examplePath = resolve(AGENT_DIR, TARGET.exampleFile)

// ─── util ───────────────────────────────────────────────────────
function parseEnv(path) {
  const text = readFileSync(path, 'utf8')
  const out = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function ensureEnvFile() {
  if (existsSync(envFilePath)) return
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envFilePath)
    console.log(`→ 初始化 ${TARGET.envFile}（从 ${TARGET.exampleFile} 复制）`)
  } else {
    writeFileSync(envFilePath, '', { mode: 0o600 })
  }
}

function upsertKey(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(text)) return text.replace(re, `${key}=${value}`)
  return (text.endsWith('\n') || text === '' ? text : text + '\n') + `${key}=${value}\n`
}

function isStillPlaceholder(val) {
  return !val || val.startsWith('CHANGE_ME') || val.startsWith('REPLACE_ME')
}

function writeEnvFile(databaseUrl) {
  ensureEnvFile()
  let text = readFileSync(envFilePath, 'utf8')
  text = upsertKey(text, 'DATABASE_URL', databaseUrl)

  // 如果 SESSION_SECRET / APIKEY_MASTER_KEY 仍是占位符，就随机生成一份
  const parsed = parseEnv(envFilePath)
  if (isStillPlaceholder(parsed.SESSION_SECRET)) {
    text = upsertKey(text, 'SESSION_SECRET', randomBytes(32).toString('hex'))
  }
  if (isStillPlaceholder(parsed.APIKEY_MASTER_KEY)) {
    text = upsertKey(text, 'APIKEY_MASTER_KEY', randomBytes(32).toString('hex'))
  }

  writeFileSync(envFilePath, text, { mode: 0o600 })
}

// ─── 分支 1：直接给 URL，不连 root DB ───────────────────────────
if (databaseUrlOverride) {
  if (!databaseUrlOverride.startsWith('mysql://')) {
    console.error('✗ --database-url 必须以 mysql:// 开头')
    process.exit(1)
  }
  writeEnvFile(databaseUrlOverride)
  console.log(`✓ 已写入 ${envFilePath}（使用 --database-url，未连接 root DB）`)
  process.exit(0)
}

// ─── 分支 2：连 root 创建 DB + USER ─────────────────────────────
async function main() {
  // 幂等守卫：若目标 .env.{env}.local 已有有效 DATABASE_URL 且未 --rotate，跳过
  if (existsSync(envFilePath) && !rotate) {
    const existing = parseEnv(envFilePath)
    if (existing.DATABASE_URL?.startsWith('mysql://')) {
      console.log(`◉ ${TARGET.envFile} 已包含 DATABASE_URL，跳过初始化`)
      console.log(`  如需 rotate 密码，再次运行：node scripts/init-db.mjs --env=${env} --rotate`)
      return
    }
  }

  if (env === 'production') {
    console.error(`✗ production 环境不支持自动建库。请用 --database-url=mysql://prod_user:...@host/db 直接注入`)
    process.exit(1)
  }

  if (!existsSync(rootEnvFile)) {
    console.error(`✗ 找不到 root 凭据文件：${rootEnvFile}`)
    console.error('  解决方案二选一：')
    console.error('    1) 在该路径创建 .env.create-db.local（参考 .env.create-db.example）')
    console.error('    2) 用 --root-env-file=<path> 或 LUMIDECK_DB_ROOT_ENV=<path> 指向已有文件')
    console.error('    3) 直接 --database-url=mysql://... 跳过 root 建库流程')
    process.exit(1)
  }
  const rootEnv = parseEnv(rootEnvFile)
  const { DATABASE_HOST, DATABASE_PORT, DB_ROOT_USERNAME, DB_ROOT_PASSWORD } = rootEnv
  if (!DATABASE_HOST || !DB_ROOT_USERNAME || !DB_ROOT_PASSWORD) {
    console.error(`✗ ${rootEnvFile} 缺必要字段（DATABASE_HOST / DB_ROOT_USERNAME / DB_ROOT_PASSWORD）`)
    process.exit(1)
  }

  const pw = randomBytes(24).toString('base64url') // ~32 字符 URL-safe

  console.log(`→ 连接 ${DATABASE_HOST}:${DATABASE_PORT || 3306} 作为 ${DB_ROOT_USERNAME}`)
  const conn = await mysql.createConnection({
    host: DATABASE_HOST,
    port: Number(DATABASE_PORT ?? 3306),
    user: DB_ROOT_USERNAME,
    password: DB_ROOT_PASSWORD,
    multipleStatements: false,
  })

  try {
    console.log(`→ CREATE DATABASE IF NOT EXISTS ${TARGET.db}`)
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${TARGET.db}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )

    const safePw = pw.replace(/'/g, "''")
    console.log(`→ CREATE USER IF NOT EXISTS '${TARGET.user}'@'%'`)
    await conn.query(`CREATE USER IF NOT EXISTS '${TARGET.user}'@'%' IDENTIFIED BY '${safePw}'`)
    await conn.query(`ALTER USER '${TARGET.user}'@'%' IDENTIFIED BY '${safePw}'`)

    console.log(`→ GRANT ALL ON ${TARGET.db}.* TO ${TARGET.user}`)
    await conn.query(`GRANT ALL PRIVILEGES ON \`${TARGET.db}\`.* TO '${TARGET.user}'@'%'`)
    await conn.query('FLUSH PRIVILEGES')
  } finally {
    await conn.end()
  }

  const databaseUrl = `mysql://${encodeURIComponent(TARGET.user)}:${encodeURIComponent(pw)}@${DATABASE_HOST}:${DATABASE_PORT || 3306}/${TARGET.db}`
  writeEnvFile(databaseUrl)

  console.log(`✓ 数据库 + 用户创建完成（env=${env}）`)
  console.log(`  Host: ${DATABASE_HOST}:${DATABASE_PORT || 3306}`)
  console.log(`  DB:   ${TARGET.db}`)
  console.log(`  User: ${TARGET.user}`)
  console.log(`  Pass: ${'•'.repeat(Math.min(pw.length, 10))}... (仅存 ${TARGET.envFile})`)
}

main().catch((err) => {
  console.error('✗ 初始化失败：', err.message)
  process.exit(1)
})
