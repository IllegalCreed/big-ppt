/**
 * Phase 10：部署期健康检查端点。
 *
 * 公开访问（authOptional），但**不暴露任何敏感信息**：
 *   - DB 连接探活（SELECT 1）
 *   - Slidev origin reachability（HEAD /，4xx 也视作 reachable，因为 Slidev 默认 root 可能 404）
 *   - 进程 uptime（秒）
 *   - GIT_SHA env（部署时由 deploy.sh 注入；缺则 'unknown'）
 *
 * 不暴露：DB 连接串 / 内部目录路径 / 用户数 / session 数。
 *
 * 状态语义：
 *   - DB ok 且 Slidev ok → 200 + status:'ok'
 *   - DB ok 但 Slidev 不通 → 200 + status:'degraded'（agent 仍可服务非 slidev 路径）
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

async function checkSlidev(origin: string): Promise<CheckResult> {
  const start = Date.now()
  try {
    const r = await fetch(origin, { signal: AbortSignal.timeout(2000) })
    // 任何 < 500 都视作 reachable（404 也算，Slidev root 在生产可能是 404）
    return { ok: r.status < 500, ms: Date.now() - start }
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: (e as Error).message }
  }
}

export const healthz = new Hono()

healthz.get('/', async (c) => {
  const slidevOrigin = process.env.SLIDEV_ORIGIN ?? 'http://127.0.0.1:3031'
  const [db, slidev] = await Promise.all([checkDb(), checkSlidev(slidevOrigin)])

  let status: 'ok' | 'degraded' | 'down'
  let httpCode: 200 | 503
  if (!db.ok) {
    status = 'down'
    httpCode = 503
  } else if (!slidev.ok) {
    status = 'degraded'
    httpCode = 200
  } else {
    status = 'ok'
    httpCode = 200
  }

  return c.json(
    {
      status,
      service: 'big-ppt-agent',
      version: '0.1.0',
      gitSha: process.env.GIT_SHA ?? 'unknown',
      uptimeSec: Math.floor(process.uptime()),
      checks: { db, slidev },
    },
    httpCode,
  )
})
