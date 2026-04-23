/**
 * 统一的 API 客户端：
 * - 总是带 `credentials: 'include'`（浏览器自动带 session cookie）
 * - 401 响应统一抛 `AuthRequiredError`，由路由 guard / 错误拦截跳转到 /login
 * - JSON body 自动序列化 / 反序列化
 */

export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`)
    this.status = status
    this.body = body
  }
}

export class AuthRequiredError extends ApiError {
  constructor(body: unknown) {
    super(401, body, 'unauthorized')
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) }
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }

  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
    body,
    signal: opts.signal,
  })

  const contentType = res.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const payload: unknown = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => '')

  if (!res.ok) {
    if (res.status === 401) throw new AuthRequiredError(payload)
    const msg =
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${res.status}`
    throw new ApiError(res.status, payload, msg)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
}
