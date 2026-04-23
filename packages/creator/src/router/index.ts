import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

/**
 * Phase 5A 路由：
 * - /login, /register 不需要登录
 * - / 是现在的单页编辑器（5C 会拆成 /decks 和 /decks/:id）
 * - 未登录访问 / 时跳 /login
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'editor',
      component: () => import('../pages/EditorPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../pages/LoginPage.vue'),
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../pages/RegisterPage.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

let bootstrapped = false

router.beforeEach(async (to) => {
  const { isLoggedIn, fetchMe } = useAuth()

  // 首次进入：拉一次 /me，后续再用内存状态
  if (!bootstrapped) {
    bootstrapped = true
    await fetchMe().catch(() => {
      // 拉取失败（网络/服务未起）不拦截，页面自己降级
    })
  }

  if (to.meta.requiresAuth && !isLoggedIn.value) {
    return { name: 'login', query: { next: to.fullPath } }
  }

  if ((to.name === 'login' || to.name === 'register') && isLoggedIn.value) {
    return { name: 'editor' }
  }
})

export default router
