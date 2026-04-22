import { Hono } from 'hono'
import { readSlides, redoSlides, restoreSlides } from '../slides-store/index.js'

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
