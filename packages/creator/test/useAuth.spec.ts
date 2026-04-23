import { beforeEach, describe, expect, it } from 'vitest'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import { useAuth } from '../src/composables/useAuth'

useMsw()

beforeEach(async () => {
  // useAuth 内部 currentUser 是 module-level ref；logout 在 finally 里清状态，
  // 即便 API 失败也能 reset，保证 test 间隔离。
  server.use(http.post('/api/auth/logout', () => HttpResponse.json({ ok: true })))
  await useAuth().logout()
})

describe('composables/useAuth', () => {
  it('login 成功写入 currentUser 且 isLoggedIn 变 true', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ user: { id: 1, email: 'a@a.com', hasLlmSettings: false } }),
      ),
    )
    const { login, currentUser, isLoggedIn } = useAuth()
    const user = await login('a@a.com', 'pw123456')
    expect(user.email).toBe('a@a.com')
    expect(currentUser.value).toMatchObject({ id: 1, email: 'a@a.com' })
    expect(isLoggedIn.value).toBe(true)
  })

  it('login 失败（401）抛 error，currentUser 保持 null', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: '邮箱或密码错误' }, { status: 401 }),
      ),
    )
    const { login, currentUser } = useAuth()
    await expect(login('x@a.com', 'bad')).rejects.toThrow()
    expect(currentUser.value).toBeNull()
  })

  it('fetchMe 返回 401 时把 currentUser 设为 null（不抛）', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    )
    const { fetchMe, currentUser } = useAuth()
    const result = await fetchMe()
    expect(result).toBeNull()
    expect(currentUser.value).toBeNull()
  })

  it('logout 清 currentUser（无论 API 成功失败）', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ user: { id: 7, email: 'out@a.com', hasLlmSettings: true } }),
      ),
      http.post('/api/auth/logout', () => HttpResponse.json({ error: 'oops' }, { status: 500 })),
    )
    const { login, logout, currentUser } = useAuth()
    await login('out@a.com', 'pw')
    expect(currentUser.value).not.toBeNull()
    // logout 实现用 try/finally 清 currentUser，但 try 块抛错时 logout 自身会 rethrow
    await logout().catch(() => {})
    expect(currentUser.value).toBeNull()
  })
})
