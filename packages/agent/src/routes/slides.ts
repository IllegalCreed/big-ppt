import { Hono } from 'hono'
import { readSlides, redoSlides, restoreSlides } from '../slides-store/index.js'
import { type AuthVars } from '../middleware/auth.js'
import { isHeldBy } from '../slidev-lock.js'

export const slides = new Hono<{ Variables: AuthVars }>()

/**
 * Phase 9-B（A01）：slides.md 是 server-wide mirror（lock holder 持有），
 * 仅 lock holder 可读 / undo / redo —— 否则 B 用户读到 A 的 deck 内容。
 *
 * 守卫策略：
 *   - 未登录 → 401
 *   - 登录但未持锁 → 403（前端会显示 OccupiedWaitingPage）
 *
 * 不抽 middleware：仅 6 个端点（3 个 endpoint × GET+POST），inline 比 helper 文件少一层抽象。
 */
slides.use('*', async (c, next) => {
  const session = c.get('session')
  if (!session) return c.json({ success: false, error: 'unauthorized' }, 401)
  if (!isHeldBy(session.id)) {
    return c.json({ success: false, error: '需要先 activate-deck 占用 Slidev 实例' }, 403)
  }
  await next()
})

// 返回 slides.md 原文（text/plain，保留与老 middleware 行为一致）
slides.post('/read-slides', (c) => {
  try {
    const content = readSlides()
    return c.text(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
// GET 兼容（老 middleware 同时支持无方法区分的访问）
slides.get('/read-slides', (c) => {
  try {
    const content = readSlides()
    return c.text(content, 200, { 'Content-Type': 'text/plain; charset=utf-8' })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

// /undo 斜杠指令：回到上一个历史版本
slides.post('/restore-slides', (c) => {
  try {
    const result = restoreSlides()
    return c.json(result, result.success ? 200 : 404)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
// GET 兼容
slides.get('/restore-slides', (c) => {
  try {
    const result = restoreSlides()
    return c.json(result, result.success ? 200 : 404)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

// /redo 斜杠指令：前进到下一个历史版本
slides.post('/redo-slides', (c) => {
  try {
    const result = redoSlides()
    return c.json(result, result.success ? 200 : 404)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
slides.get('/redo-slides', (c) => {
  try {
    const result = redoSlides()
    return c.json(result, result.success ? 200 : 404)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})
