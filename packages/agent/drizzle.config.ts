import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// 优先 .env.local（本地覆盖），再 .env（可选默认）
config({ path: ['.env.local', '.env'] })

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
