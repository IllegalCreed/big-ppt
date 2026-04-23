/**
 * MSW 2.x setup helper for composable / component 测试。
 *
 * 用法：
 *   import { useMsw, server, http, HttpResponse } from './_setup/msw'
 *   useMsw()   // 在 describe 外顶部调一次
 *   // 每个 it 里可 server.use(http.get('/api/foo', () => ...)) 覆盖 handler
 */
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const server = setupServer()

export function useMsw(): void {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())
}

export { http, HttpResponse }
