import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// 同 src/index.ts 的策略：pnpm db:push / db:push:test 已经用 dotenv-cli 注入；
// 直接 `pnpm exec drizzle-kit push` 时兜底读 .env.development.local / .env.local
if (!process.env.DATABASE_URL) {
  config({ path: ['.env.development.local', '.env.local'] })
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    '[drizzle.config] DATABASE_URL 未设置。请在 packages/agent/.env.local 中填入后再运行 drizzle-kit。',
  )
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
