/**
 * Phase 9-E（A05 Misconfiguration）：统一 error 响应 helper。
 *
 * 生产模式：仅返 generic message + errorId（nanoid 16 chars），具体 stack 写到 logger.error；
 *           前端可凭 errorId 让用户报告问题（运维能 grep 日志关联）。
 * 非生产：完整 message + stack，方便调试。
 *
 * 业务路由的 catch 分支应统一调 `errorResponse(c, err)`，不再把 `(err as Error).message`
 * 直接吐到 client。
 */
import type { Context } from 'hono'
import crypto from 'node:crypto'

/** 返 16 字节 hex errorId（不依赖 nanoid，避免新增 deps） */
function generateErrorId(): string {
  return crypto.randomBytes(8).toString('hex')
}

interface ErrorResponseOptions {
  /** 默认 500；可覆盖（如 400 / 422 等业务错误） */
  status?: number
  /** 生产模式回给 client 的 generic message，覆盖默认"内部错误" */
  publicMessage?: string
  /** 是否吞 stack 不写 logger（极个别敏感路径用，默认 false） */
  silent?: boolean
}

/**
 * 统一 error response 写法。
 *
 * @example
 * try {
 *   await someBusinessLogic()
 * } catch (err) {
 *   return errorResponse(c, err)
 * }
 */
export function errorResponse(c: Context, err: unknown, opts: ErrorResponseOptions = {}) {
  const status = opts.status ?? 500
  const isProd = process.env.NODE_ENV === 'production'
  const errorId = generateErrorId()
  const e = err as { message?: string; stack?: string } | null | undefined
  const fullMessage = e?.message ?? String(err)

  if (!opts.silent) {
    // 直接 console.error；logger 模块自身的 redact 留给 logger 包装层
    console.error(`[error ${errorId}] ${fullMessage}`, e?.stack ?? '')
  }

  if (isProd) {
    return c.json(
      {
        error: opts.publicMessage ?? '内部错误，请稍后重试',
        errorId,
      },
      status as never,
    )
  }
  return c.json(
    {
      error: fullMessage,
      errorId,
      stack: e?.stack,
    },
    status as never,
  )
}
