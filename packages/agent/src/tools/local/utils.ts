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

/**
 * 包 slides-store 调用:把 NoActiveDeckError 转成 LLM 友好的 {success:false,error} JSON。
 * 其他错误向上抛。
 *
 * P0 security fix(2026-05-18):slides-store DB-based 后,无 ALS activeDeckId / userId
 * 时 throw NoActiveDeckError,工具不应 propagate 给 LLM 一个 stack trace。
 */
export async function withSlidesStoreGuard<T>(
  action: () => Promise<T>,
): Promise<T | { success: false; error: string }> {
  try {
    return await action()
  } catch (err) {
    const e = err as Error
    if (e.name === 'NoActiveDeckError') {
      return { success: false, error: e.message }
    }
    throw err
  }
}
