/** Phase 13 Task C: DOCX 文本抽取(mammoth extractRawText)。 */
import mammoth from 'mammoth'

const MAX_CHARS = 50_000

export async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  let text = (result.value ?? '').trim()
  if (text.length > MAX_CHARS) {
    const originalLen = text.length
    text = text.slice(0, MAX_CHARS) + `\n\n... (truncated, 原 ${originalLen} 字)`
  }
  return text
}
