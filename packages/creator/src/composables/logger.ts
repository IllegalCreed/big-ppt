// 会话日志模块：统一的 session 变量 + 事件上报 + 全局错误捕获
//
// 使用方式：
//   - sendMessage 开始时 `setCurrentSession(uuid)`，结束时 `setCurrentSession(null)`
//   - 任意位置调用 `logEvent({ kind, ... })`，自动带上当前 session
//   - 带上 `payload` 字段时，完整内容会被后端另存到 logs/payloads/<session>/
//   - main.ts 调用 `installErrorHandlers(app)` 把前端 runtime 错误也归档

import type { App } from 'vue'
import type { LogPayload } from '@big-ppt/shared'

let currentSession: string | null = null

export function setCurrentSession(session: string | null): void {
  currentSession = session
}

export function getCurrentSession(): string | null {
  return currentSession
}

export type { LogPayload }

/** fire-and-forget 上报，失败不阻塞主流程 */
export function logEvent(data: LogPayload): void {
  try {
    const body: LogPayload = {
      ...data,
      session: data.session ?? currentSession ?? 'no-session',
    }
    fetch('/api/log-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* ignore */
    })
  } catch {
    /* ignore */
  }
}

export function truncate(str: string | undefined, n = 200): string {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + `…(+${str.length - n})` : str
}

// --- 全局错误捕获 ---

/**
 * Vue errorHandler / warnHandler 的 instance 参数在 Vue 官方类型里是 `ComponentPublicInstance | null`，
 * 但我们只读 `$options.__name / $options.name` 两个字段，用 unknown + 安全解构即可，
 * 无需引入具体类型依赖。
 */
type VueInstanceLike = { $options?: { __name?: string; name?: string } } | null | undefined

function getComponentName(instance: VueInstanceLike): string {
  return instance?.$options?.__name ?? instance?.$options?.name ?? 'unknown'
}

export function installErrorHandlers(app: App): void {
  // Vue 组件渲染 / 生命周期错误
  app.config.errorHandler = (err: unknown, instance, info: string) => {
    const e = err as { message?: string; stack?: string } | null | undefined
    logEvent({
      kind: 'browser_error',
      source: 'vue',
      message: e?.message || String(err),
      stack: truncate(e?.stack, 2000),
      info,
      component: getComponentName(instance as VueInstanceLike),
    })
    // 仍然打印到 console，方便本地开发
    console.error('[Vue error]', err, info)
  }

  // Vue 警告（开发模式专用，生产会被 tree-shake 掉）
  app.config.warnHandler = (msg: string, instance, trace: string) => {
    logEvent({
      kind: 'browser_warn',
      source: 'vue',
      message: msg,
      trace: truncate(trace, 1500),
      component: getComponentName(instance as VueInstanceLike),
    })
    console.warn('[Vue warn]', msg, trace)
  }

  // 未捕获的 JS 错误
  window.addEventListener('error', (ev: ErrorEvent) => {
    // P3-4 ✅：白名单——只记 filename 在本应用 origin 下的错误。
    // 浏览器扩展（content_script.js / content_guard.js / content_main.js …）的 filename
    // 通常是 chrome-extension:// 或独立脚本路径，不是我们的应用代码，过滤掉避免噪音。
    const file = ev.filename || ''
    if (file && !file.startsWith(window.location.origin)) return

    logEvent({
      kind: 'browser_error',
      source: 'window',
      message: ev.message,
      stack: truncate(ev.error?.stack, 2000),
      filename: file,
      line: ev.lineno,
      col: ev.colno,
    })
  })

  // 未捕获的 Promise rejection
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason
    logEvent({
      kind: 'browser_error',
      source: 'promise',
      message: reason?.message || String(reason),
      stack: truncate(reason?.stack, 2000),
    })
  })
}
