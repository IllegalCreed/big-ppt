/**
 * Phase 9-D（A05 Misconfiguration）：Content-Security-Policy header。
 *
 * 策略：
 *   - 仅生产模式（NODE_ENV === 'production'）启用
 *   - 仅 Report-Only 模式（不强制），先观察 violation 再切 enforce
 *   - 不加 report-uri（没收集端）；浏览器 console 仍会报 violation 帮调试
 *
 * Phase 11+ 评估切到 enforce 模式（详 plan 18 设计抉择 #4）。
 */
import type { MiddlewareHandler } from 'hono'

const CSP_POLICY = [
  // default-src self + 允许 inline + eval（Vue runtime template compiler 必需）
  "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // 图片：data + blob 用于动态生成的缩略图 / chart
  "img-src 'self' data: blob:",
  // iframe：仅同源
  "frame-src 'self'",
  // worker：同源
  "worker-src 'self' blob:",
  // 字体：data + https（自托管 / Google Fonts 等留接口）
  "font-src 'self' data: https:",
  // 防 mixed content
  'block-all-mixed-content',
  // 防点击劫持：仅同源 iframe
  "frame-ancestors 'self'",
].join('; ')

export const cspReportOnly: MiddlewareHandler = async (c, next) => {
  await next()
  if (process.env.NODE_ENV === 'production') {
    c.header('Content-Security-Policy-Report-Only', CSP_POLICY)
  }
}
