import { Hono, type Context } from 'hono'
import { redoSlides, restoreSlides, NoActiveDeckError } from '../slides-store/index.js'
import { getRequestContext } from '../context.js'
import { type AuthVars } from '../middleware/auth.js'

export const slides = new Hono<{ Variables: AuthVars }>()

async function handleHistoryAction(
  c: Context<{ Variables: AuthVars }>,
  action: () => Promise<{ success: boolean; error?: string; message?: string }>,
) {
  if (!c.get('user')) return c.json({ success: false, error: 'unauthorized' }, 401)
  if (!getRequestContext().activeDeckId) {
    return c.json({ success: false, error: '缺少 X-Deck-Id' }, 400)
  }
  try {
    const result = await action()
    return c.json(result, result.success ? 200 : 404)
  } catch (err) {
    if (err instanceof NoActiveDeckError) {
      return c.json({ success: false, error: err.message }, 404)
    }
    return c.json({ success: false, error: (err as Error).message }, 500)
  }
}

// /undo 斜杠指令：回到上一个历史版本
slides.post('/restore-slides', (c) => handleHistoryAction(c, () => restoreSlides()))

// /redo 斜杠指令：前进到下一个历史版本
slides.post('/redo-slides', (c) => handleHistoryAction(c, () => redoSlides()))
