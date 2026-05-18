import type { ToolDef } from '../registry.js'
import { readSlides, NoActiveDeckError } from '../../slides-store/index.js'

export const readSlidesTool: ToolDef = {
  name: 'read_slides',
  description: '读取当前 slides.md 的完整内容。在修改幻灯片之前，应先调用此工具了解当前内容。',
  parameters: { type: 'object', properties: {} },
  // 返回 raw markdown(不是 JSON 信封):LLM 的 tool-result content 需要 slides.md 原文,
  // 与 POST /api/read-slides 的 text/plain 响应行为保持一致。
  // P0 security fix(2026-05-18):readSlides 从 DB 读当前 deck content,缺 ALS deckId 时抛
  // NoActiveDeckError;catch 后返 LLM 友好提示,不再 fallback 读全局 slides.md。
  exec: async () => {
    try {
      return await readSlides()
    } catch (err) {
      if (err instanceof NoActiveDeckError) {
        return JSON.stringify({ success: false, error: err.message })
      }
      throw err
    }
  },
}
