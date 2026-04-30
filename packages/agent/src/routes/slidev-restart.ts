/**
 * POST /api/slidev-restart — 用户主动触发 Slidev dev 进程重启,清 vite HMR 累积 cache。
 *
 * 设计动机:Slidev / Vite 在 long session(几十次 frontmatter HMR patch)后 layout component
 * 缓存错位,导致页面渲染跟 slides.md 对不上(beitou layout 渲染成 jingyeda 等)。
 * iframe full reload 只清浏览器缓存,**不能清 Slidev dev server 进程内的 vite module cache**。
 * 唯一根治:重启 slidev 进程。
 *
 * 模式区分:
 *   - production: execFile('pm2', ['restart', 'lumideck-slidev']),pm2 ecosystem 已注册该进程
 *   - development: 返 503 + 提示「请手动重启 pnpm dev」(dev 跑 turbo,agent 没法跨进程 supervise)
 *
 * 调用副作用(全局):
 *   - 重启窗口约 1-2s,期间 SlidePreview iframe 拿到 502/connect-refused
 *   - 影响所有同时在用 SlidePreview 的用户(单实例 Slidev 全局共享)
 * 前端按钮触发后应当显示 loading + 等 ready 再 iframe reload
 */
import { Hono } from 'hono'
import { execFile } from 'node:child_process'
import { authOptional, requireAuth, type AuthVars } from '../middleware/auth.js'
import { logServerEvent } from '../logger/server-log.js'

export const slidevRestartRoute = new Hono<{ Variables: AuthVars }>()

slidevRestartRoute.use('/slidev-restart', authOptional, requireAuth)
slidevRestartRoute.post('/slidev-restart', async (c) => {
  const user = c.get('user')!

  if (process.env.NODE_ENV !== 'production') {
    logServerEvent({
      category: 'slidev-process',
      event: 'restart-rejected-dev-mode',
      userId: user.id,
    })
    return c.json(
      {
        success: false,
        error:
          'dev 模式不支持自动重启 Slidev(进程由 turbo 起,agent 无 supervise 权限)。请在终端 cmd+C 终止 pnpm dev 再重新启动。',
      },
      503,
    )
  }

  return await new Promise<Response>((resolve) => {
    execFile('pm2', ['restart', 'lumideck-slidev'], (err) => {
      if (err) {
        const e = err as Error
        logServerEvent({
          category: 'slidev-process',
          event: 'restart-failed',
          userId: user.id,
          errorMsg: e.message,
        })
        resolve(c.json({ success: false, error: `pm2 restart 失败: ${e.message}` }, 500))
        return
      }
      logServerEvent({
        category: 'slidev-process',
        event: 'restarted-by-user',
        userId: user.id,
      })
      resolve(c.json({ success: true, message: 'Slidev 进程正在重启,1-2s 后 iframe 会自动 reload' }))
    })
  })
})
