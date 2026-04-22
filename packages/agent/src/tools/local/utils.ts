/**
 * LLM 传 tool args 时偶尔把 integer 包成字符串（尤其 GLM 家族）：
 * schema 声明 `type: "integer"` 仍可能拿到 `"4"`。工具层在调用 slides-store 前
 * 做宽容 coerce，避免因为类型代理问题让 AI 反复重试。
 */

export function coerceIndex(raw: unknown): number | 'end' | null {
  if (raw === undefined || raw === 'end') return 'end'
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === 'end' || trimmed === '"end"') return 'end'
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  }
  return null
}

export function coerceInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number(raw.trim())
  return null
}

export function coerceIntArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  const out: number[] = []
  for (const v of raw) {
    const n = coerceInt(v)
    if (n === null) return null
    out.push(n)
  }
  return out
}
