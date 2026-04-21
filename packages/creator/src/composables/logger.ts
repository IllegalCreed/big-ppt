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

export function installErrorHandlers(app: App): void {
  // Vue 组件渲染 / 生命周期错误
  app.config.errorHandler = (err: any, instance: any, info: string) => {
    logEvent({
      kind: 'browser_error',
      source: 'vue',
      message: err?.message || String(err),
      stack: truncate(err?.stack, 2000),
      info,
      component: instance?.$options?.__name || instance?.$options?.name || 'unknown',
    })
    // 仍然打印到 console，方便本地开发
    console.error('[Vue error]', err, info)
  }

  // Vue 警告（开发模式专用，生产会被 tree-shake 掉）
  app.config.warnHandler = (msg: string, instance: any, trace: string) => {
    logEvent({
      kind: 'browser_warn',
      source: 'vue',
      message: msg,
      trace: truncate(trace, 1500),
      component: instance?.$options?.__name || instance?.$options?.name || 'unknown',
    })
    console.warn('[Vue warn]', msg, trace)
  }

  // 未捕获的 JS 错误
  window.addEventListener('error', (ev: ErrorEvent) => {
    // 过滤扩展注入脚本（content_script.js、content_guard.js 等），非应用问题
    const file = ev.filename || ''
    if (/content_(script|guard)\.js/.test(file)) return

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
