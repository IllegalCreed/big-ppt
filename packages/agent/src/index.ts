// 环境变量加载策略：
//   - 正常走 pnpm dev/start 时，dotenv-cli 已经把 .env.{env}.local 注入到 process.env；
//     此时 DATABASE_URL 已存在，下面的守卫跳过，避免二次加载覆盖。
//   - 直接跑 `tsx src/index.ts`（非 pnpm 入口）时兜底读本地 .env.development.local / .env.local。
import { config as loadDotenv } from 'dotenv'
if (!process.env.DATABASE_URL) {
  loadDotenv({ path: ['.env.development.local', '.env.local'] })
}

import { serve } from '@hono/node-server'
import { app } from './app.js'
import { getPaths } from './workspace.js'
import { registerLocalTools } from './tools/local/index.js'
// Phase 9-F：MCP registry 改为 per-user lazy 化（不再启动期全局 init）。
import { verifyTemplatesOrThrow } from './templates/registry.js'
import { verifyImageStylesOrThrow } from './image-styles/registry.js'

const port = Number(process.env.AGENT_PORT ?? 4000)

// 启动时 eager 解析一次 paths，尽早暴露 "monorepo root 未找到" 类错误
try {
  getPaths()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

// 模板 manifest 自检：任一模板 manifest 非法或 starter.md 缺失即拒绝启动
try {
  verifyTemplatesOrThrow()
  verifyImageStylesOrThrow()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

// 注册本地工具到 agent tool-registry
registerLocalTools()

serve({ fetch: app.fetch, port }, () => {
  console.log(`[agent] listening on http://localhost:${port}`)
  // Phase 9-F：MCP registry per-user，每用户首次访问 /api/mcp/servers 或 /api/tools
  // 时通过 getRegistry(userId) 懒加载初始化；启动期不再批量 init 全部 user。
  console.log('[agent] MCP registry per-user lazy mode')
})
