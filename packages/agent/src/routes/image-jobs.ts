/**
 * Phase 11.5：image-gen job REST 路由。
 *
 * GET    /api/image-jobs/:id  → 返 { job } 含状态/进度/assetId(若已完成)
 * DELETE /api/image-jobs/:id  → 取消 job(不可逆,已 done/failed 是 noop)
 *
 * 沿用 switch-template-jobs 路由风格(见 packages/agent/src/routes/decks.ts:337-345)。
 */
import { Hono } from 'hono'
import { type AuthVars } from '../middleware/auth.js'
import { getImageJob, cancelImageJob } from '../image-gen-job.js'

export const imageJobsRoute = new Hono<{ Variables: AuthVars }>()

imageJobsRoute.get('/image-jobs/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const job = getImageJob(id)
  if (!job) return c.json({ error: 'job 不存在' }, 404)
  if (job.userId !== user.id) return c.json({ error: '无权访问该 job' }, 403)
  return c.json({ job })
})

imageJobsRoute.delete('/image-jobs/:id', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const id = c.req.param('id')
  const job = getImageJob(id)
  if (!job) return c.json({ error: 'job 不存在' }, 404)
  if (job.userId !== user.id) return c.json({ error: '无权访问该 job' }, 403)
  cancelImageJob(id, user.id)
  return c.json({ ok: true })
})
