#!/usr/bin/env node
/**
 * Lumideck 数据库初始化（一次性）：
 *
 *   1. 读 quiz-monorepo 那份 .env.create-db.local 拿 root 账号
 *   2. 随机生成 lumideck_user 密码
 *   3. CREATE DATABASE lumideck + CREATE USER lumideck_user + GRANT
 *   4. 用 lumideck_user 的连接串覆盖 packages/agent/.env.local 里的 DATABASE_URL
 *      （保留 SESSION_SECRET 和 APIKEY_MASTER_KEY 不动）
 *
 * 密码从不回显到 stdout 或 command line。
 *
 * 用法：node packages/agent/scripts/init-db.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import mysql from 'mysql2/promise'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = resolve(__dirname, '..')
const QUIZ_CREATE_DB_LOCAL = '/Users/zhangxu/illegal/quiz-monorepo/apps/quiz-backend/.env.create-db.local'
const AGENT_ENV_LOCAL = resolve(AGENT_DIR, '.env.local')

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

async function main() {
  if (!existsSync(QUIZ_CREATE_DB_LOCAL)) {
    console.error(`✗ 找不到 ${QUIZ_CREATE_DB_LOCAL}`)
    process.exit(1)
  }
  const rootEnv = parseEnv(QUIZ_CREATE_DB_LOCAL)
  const { DATABASE_HOST, DATABASE_PORT, DB_ROOT_USERNAME, DB_ROOT_PASSWORD } = rootEnv
  if (!DATABASE_HOST || !DB_ROOT_USERNAME || !DB_ROOT_PASSWORD) {
    console.error('✗ quiz create-db.local 缺必要字段（DATABASE_HOST / DB_ROOT_USERNAME / DB_ROOT_PASSWORD）')
    process.exit(1)
  }

  const lumideckPw = randomBytes(24).toString('base64url') // ~32 字符，URL-safe
  const lumideckUser = 'lumideck_user'
  const lumideckDb = 'lumideck'

  console.log(`→ 连接 ${DATABASE_HOST}:${DATABASE_PORT || 3306} 作为 ${DB_ROOT_USERNAME}`)
  const conn = await mysql.createConnection({
    host: DATABASE_HOST,
    port: Number(DATABASE_PORT ?? 3306),
    user: DB_ROOT_USERNAME,
    password: DB_ROOT_PASSWORD,
    multipleStatements: false,
  })

  try {
    console.log(`→ CREATE DATABASE IF NOT EXISTS ${lumideckDb}`)
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${lumideckDb}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )

    console.log(`→ CREATE USER IF NOT EXISTS '${lumideckUser}'@'%'`)
    // mysql2 escape 不能用于 CREATE USER 的密码字段（阿里云 RDS 不允许 PREPARE），手动转义单引号
    const safePw = lumideckPw.replace(/'/g, "''")
    await conn.query(`CREATE USER IF NOT EXISTS '${lumideckUser}'@'%' IDENTIFIED BY '${safePw}'`)
    // 已存在时重置密码，保证 .env.local 写出来的一定能用（幂等）
    await conn.query(`ALTER USER '${lumideckUser}'@'%' IDENTIFIED BY '${safePw}'`)

    console.log(`→ GRANT ALL ON ${lumideckDb}.* TO ${lumideckUser}`)
    await conn.query(`GRANT ALL PRIVILEGES ON \`${lumideckDb}\`.* TO '${lumideckUser}'@'%'`)
    await conn.query('FLUSH PRIVILEGES')
  } finally {
    await conn.end()
  }

  // 覆写 .env.local 的 DATABASE_URL 行（保留其他字段）
  const databaseUrl = `mysql://${encodeURIComponent(lumideckUser)}:${encodeURIComponent(lumideckPw)}@${DATABASE_HOST}:${DATABASE_PORT || 3306}/${lumideckDb}`
  let envText = existsSync(AGENT_ENV_LOCAL) ? readFileSync(AGENT_ENV_LOCAL, 'utf8') : ''
  if (envText.match(/^DATABASE_URL=.*$/m)) {
    envText = envText.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`)
  } else {
    envText = `DATABASE_URL=${databaseUrl}\n` + envText
  }
  writeFileSync(AGENT_ENV_LOCAL, envText, { mode: 0o600 })

  console.log(`✓ 数据库 + 用户创建完成`)
  console.log(`✓ 已写入 ${AGENT_ENV_LOCAL} 的 DATABASE_URL（密码 ${lumideckPw.length} 字符）`)
  console.log(`  Host: ${DATABASE_HOST}:${DATABASE_PORT || 3306}`)
  console.log(`  DB:   ${lumideckDb}`)
  console.log(`  User: ${lumideckUser}`)
  console.log(`  Pass: ${'•'.repeat(Math.min(lumideckPw.length, 10))}... (仅存 .env.local)`)
}

main().catch((err) => {
  console.error('✗ 初始化失败：', err.message)
  process.exit(1)
})
