import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

/**
 * Phase 5C 路由：
 * - /login, /register 不需要登录
 * - /decks 是登录后的首页（deck 列表）
 * - /decks/:id 进入编辑页，内部会走 activate-deck 抢锁流程
 * - 未登录访问需要登录的页时跳 /login?next=...
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/decks',
    },
    {
      path: '/decks',
      name: 'decks',
      component: () => import('../pages/DeckListPage.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/decks/:id(\\d+)',
      name: 'deck-editor',
      component: () => import('../pages/DeckEditorPage.vue'),
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

  // 首次进入：拉一次 /me，后续用内存状态
  if (!bootstrapped) {
    bootstrapped = true
    await fetchMe().catch(() => {
      /* 拉取失败（网络/服务未起）不拦截，页面自己降级 */
    })
  }

  if (to.meta.requiresAuth && !isLoggedIn.value) {
    return { name: 'login', query: { next: to.fullPath } }
  }

  if ((to.name === 'login' || to.name === 'register') && isLoggedIn.value) {
    return { name: 'decks' }
  }
})

export default router
