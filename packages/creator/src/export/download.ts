/**
 * Phase 14 Task B：在浏览器端触发文件下载。
 *
 * 标准 Blob → Object URL → 不可见 <a download> 触发 click → 即时 revoke。
 *
 * 注意：
 * - `a.download` 设 filename 让浏览器另存为指定文件名（同源场景；跨源 URL 会
 *   被忽略，但 Object URL 始终同源 OK）
 * - 必须 `document.body.appendChild(a)` 再 click —— Firefox 早版本要求 anchor
 *   在 DOM tree 里才尊重 download 属性（现代 Chrome/Safari 不强求但向下兼容）
 * - `URL.revokeObjectURL` 在 click 后用 setTimeout(0) 延迟到下一 tick：浏览器
 *   下载链路异步，立即 revoke 可能让大文件下载中断（Safari 历史 bug）
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 下一 tick 释放，让浏览器先把 click 排进下载队列
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
