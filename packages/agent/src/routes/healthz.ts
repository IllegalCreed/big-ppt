/**
 * 部署期健康检查端点。
 *
 * 公开访问（authOptional），但**不暴露任何敏感信息**：
 *   - DB 连接探活（SELECT 1）
 *   - 进程 uptime（秒）
 *   - GIT_SHA env（部署时由 deploy.sh 注入；缺则 'unknown'）
 *
 * 不暴露：DB 连接串 / 内部目录路径 / 用户数 / session 数。
 *
 * 状态语义：
 *   - DB ok → 200 + status:'ok'
 *   - DB 不通 → 503 + status:'down'
 *
 * 部署脚本 healthcheck 步骤会 grep `"status":"ok"` 判断绿。
 */
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { getDb } from '../db/client.js'

type CheckResult = { ok: boolean; ms: number; error?: string }

async function checkDb(): Promise<CheckResult> {
  const start = Date.now()
  try {
    await getDb().execute(sql`SELECT 1`)
    return { ok: true, ms: Date.now() - start }
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: (e as Error).message }
  }
}

export const healthz = new Hono()

healthz.get('/', async (c) => {
  const db = await checkDb()
  const status: 'ok' | 'down' = db.ok ? 'ok' : 'down'
  const httpCode: 200 | 503 = db.ok ? 200 : 503

  return c.json(
    {
      status,
      service: 'big-ppt-agent',
      version: '0.1.0',
      gitSha: process.env.GIT_SHA ?? 'unknown',
      uptimeSec: Math.floor(process.uptime()),
      checks: { db },
    },
    httpCode,
  )
})
