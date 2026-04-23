/**
 * 全局 auth 状态：currentUser 在 main.ts 挂载前调用 fetchMe() 初始化一次，
 * 之后登录 / 登出 / 刷新 llm-settings 都调这里。
 */
import { ref, computed } from 'vue'
import { api, AuthRequiredError } from '../api/client'

export type CurrentUser = {
  id: number
  email: string
  hasLlmSettings: boolean
}

const currentUser = ref<CurrentUser | null>(null)
const loading = ref(false)

export function useAuth() {
  const isLoggedIn = computed(() => currentUser.value !== null)

  async function fetchMe(): Promise<CurrentUser | null> {
    loading.value = true
    try {
      const res = await api.get<{ user: CurrentUser }>('/api/auth/me')
      currentUser.value = res.user
      return res.user
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        currentUser.value = null
        return null
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  async function login(email: string, password: string): Promise<CurrentUser> {
    const res = await api.post<{ user: CurrentUser }>('/api/auth/login', { email, password })
    currentUser.value = res.user
    return res.user
  }

  async function register(email: string, password: string): Promise<CurrentUser> {
    const res = await api.post<{ user: CurrentUser }>('/api/auth/register', { email, password })
    currentUser.value = res.user
    return res.user
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/api/auth/logout')
    } finally {
      currentUser.value = null
    }
  }

  async function saveLlmSettings(settings: {
    provider: string
    apiKey: string
    baseUrl?: string
    model?: string
  }): Promise<void> {
    await api.put('/api/auth/llm-settings', settings)
    // 更新本地标志（真正的 apiKey 不会回传）
    if (currentUser.value) currentUser.value.hasLlmSettings = true
  }

  return {
    currentUser,
    isLoggedIn,
    loading,
    fetchMe,
    login,
    register,
    logout,
    saveLlmSettings,
  }
}
