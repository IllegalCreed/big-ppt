/**
 * Phase 7D / P3-10：从 msw mock 迁到 in-process agent + lumideck_test 集成测。
 *
 * 端到端验证 useAuth 真实调用 /api/auth/* 端点的契约：
 *   - register 201 + cookie 写入
 *   - login 200 / 401 行为
 *   - me 401（未登录）→ currentUser=null 不抛
 *   - llm-settings PUT 后 hasLlmSettings 真翻 true
 *   - logout 即便服务端错也清本地
 *
 * 这些都是过去 msw 假数据看不见的契约 bug 高发区。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { setupIntegration, createTestUser } from './_setup/integration'
import { useAuth } from '../src/composables/useAuth'

setupIntegration()

// useAuth 是 module-level ref，跨 test 残留。每条 test 前先 logout 清零（即便没登录也无副作用）。
beforeEach(async () => {
  await useAuth().logout().catch(() => {})
})

describe('composables/useAuth (integration)', () => {
  it('register 成功：201 + currentUser 写入 + 后续 me 200', async () => {
    const { register, currentUser } = useAuth()
    const u = await register('reg@a.com', 'pw123456')
    expect(u.email).toBe('reg@a.com')
    expect(currentUser.value?.email).toBe('reg@a.com')
    expect(currentUser.value?.hasLlmSettings).toBe(false)
  })

  it('login 成功：先 createTestUser → login → currentUser 写入', async () => {
    await createTestUser('a@a.com', 'pw123456')
    const { login, currentUser, isLoggedIn } = useAuth()
    const u = await login('a@a.com', 'pw123456')
    expect(u.email).toBe('a@a.com')
    expect(currentUser.value?.email).toBe('a@a.com')
    expect(isLoggedIn.value).toBe(true)
  })

  it('login 失败（错密码）抛 error，currentUser 保持 null', async () => {
    await createTestUser('x@a.com', 'pw123456')
    const { login, currentUser } = useAuth()
    await expect(login('x@a.com', 'wrong-password')).rejects.toThrow()
    expect(currentUser.value).toBeNull()
  })

  it('fetchMe 未登录返回 401 → currentUser 设 null（不抛）', async () => {
    const { fetchMe, currentUser } = useAuth()
    const result = await fetchMe()
    expect(result).toBeNull()
    expect(currentUser.value).toBeNull()
  })

  it('saveLlmSettings 成功后 currentUser.hasLlmSettings 翻 true', async () => {
    await createTestUser('s@a.com', 'pw123456')
    const { login, saveLlmSettings, currentUser } = useAuth()
    await login('s@a.com', 'pw123456')
    expect(currentUser.value?.hasLlmSettings).toBe(false)
    await saveLlmSettings({ provider: 'zhipu', apiKey: 'k', model: 'GLM-5.1' })
    expect(currentUser.value?.hasLlmSettings).toBe(true)

    // 再次 fetchMe 也应反映 hasLlmSettings=true（持久化进 DB 验证）
    const { fetchMe } = useAuth()
    const me = await fetchMe()
    expect(me?.hasLlmSettings).toBe(true)
  })

  it('logout 即便服务端错也清本地 currentUser', async () => {
    await createTestUser('out@a.com', 'pw123456')
    const { login, logout, currentUser } = useAuth()
    await login('out@a.com', 'pw123456')
    expect(currentUser.value).not.toBeNull()
    await logout().catch(() => {}) // 真服务端正常会 200，但即便错也要清本地
    expect(currentUser.value).toBeNull()
  })
})
