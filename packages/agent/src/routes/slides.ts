import { Hono } from 'hono'
import { editSlides, readSlides, restoreSlides, writeSlides } from '../slides-store/index.js'

export const slides = new Hono()

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

slides.post('/write-slides', async (c) => {
  try {
    const { content } = await c.req.json<{ content?: string }>()
    if (!content) return c.json({ success: false, error: 'content 不能为空' }, 400)
    writeSlides(content)
    return c.json({ success: true })
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

slides.post('/edit-slides', async (c) => {
  try {
    const { old_string, new_string } = await c.req.json<{
      old_string?: string
      new_string?: string
    }>()
    if (!old_string) return c.json({ success: false, error: 'old_string 不能为空' }, 400)
    const result = editSlides(old_string, new_string ?? '')
    return c.json(result, result.success ? 200 : 200)
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
})

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
