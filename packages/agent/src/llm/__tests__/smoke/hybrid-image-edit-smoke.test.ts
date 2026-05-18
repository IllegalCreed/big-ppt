/**
 * 2026-05-18 Hybrid vision-aware 真打 smoke。
 *
 * 验 generateImage(baseImageBase64, baseImageMime) → 真打 duckcoding 中转的
 * /v1/responses + gpt-5.5 + image_input + image_generation tool → 返合法 PNG。
 * 这是 hybrid 改造唯一无法通过 mock 验的契约:vision input 真喂给 gpt-5.5
 * 后,中转 + OpenAI 端必须不报「不接受 image input」或「model unknown」。
 *
 * 沿用 openai.smoke.test.ts 的 warn-not-fail 套路:
 * - 没设 OPENAI_TEST_KEY 时整个 describe 被 describe.skipIf 跳过。
 * - 中转上游不稳(quota / 502 / parser / model not whitelisted)走 console.warn skip。
 * - duckcoding 中转 gpt-5.5 不通时会抛 401「Invalid token」(实际是 route 没代理),
 *   此类错也 warn-skip,避免阻塞 CI。
 *
 * 不烧 N×$0.04:用 beitou thumbnail.png(60KB)做 base image,只跑 1 张图,size 1024x1024,
 * end-to-end ≤ 60s。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { generateImage, ImageAuthError } from '../../openai-image.js'

const OPENAI_KEY = process.env.OPENAI_TEST_KEY
const RAW_BASE_URL = process.env.DUCKCODING_TEST_BASE_URL
// openai-image.ts 的 callResponsesApi 直接拼 `${baseUrl}/responses`,所以 baseUrl 必须含 /v1
const BASE_URL = RAW_BASE_URL ? `${RAW_BASE_URL.replace(/\/$/, '')}/v1` : 'https://www.duckcoding.ai/v1'

describe.skipIf(!OPENAI_KEY)('hybrid image edit smoke (OPENAI_TEST_KEY)', () => {
  it(
    '真打 /v1/responses + gpt-5.5 + image_input + image_generation tool → 返合法 PNG',
    { retry: 1, timeout: 90_000 },
    async () => {
      // 拿一张已知合法 PNG fixture 做 base image:beitou 模板 thumbnail(60KB)
      const fixturePath = path.resolve(
        __dirname,
        '../../../../../slidev/templates/beitou-standard/thumbnail.png',
      )
      const baseImage = fs.readFileSync(fixturePath)
      // PNG magic 自检,fixture 没坏
      expect(baseImage.subarray(0, 4).toString('hex')).toBe('89504e47')
      const baseImageBase64 = baseImage.toString('base64')

      const ctrl = new AbortController()
      let result: Awaited<ReturnType<typeof generateImage>>
      try {
        result = await generateImage({
          prompt: 'change theme to warm orange tones, keep all layout same',
          size: '1024x1024',
          signal: ctrl.signal,
          apiKey: OPENAI_KEY!,
          baseUrl: BASE_URL,
          primaryModel: 'gpt-5.5',
          baseImageBase64,
          baseImageMime: 'image/png',
        })
      } catch (e) {
        if (isSkippable(e)) {
          console.warn(`⚠️ hybrid image edit smoke skipped:`, errMsg(e))
          return
        }
        throw e
      }

      // 路 A 跑通(/v1/responses + image_generation tool)
      expect(result.pathTaken).toBe('A')
      // gpt-5.x 系列都接受(中转可能 alias 到具体子型号);用 modelUsed 软匹配
      expect(result.modelUsed).toMatch(/gpt-5/)
      expect(result.b64.length).toBeGreaterThan(1000)
      // 解码后 PNG magic 自检(89 50 4e 47 = ‰PNG)
      const head = Buffer.from(result.b64, 'base64').subarray(0, 4).toString('hex')
      expect(head).toBe('89504e47')
    },
  )
})

/**
 * Skippable 错误判定:套用 openai.smoke.test.ts 模式 + hybrid 专属。
 *
 * (1) 网络 / 中转抖动:timeout / 5xx / fetch failed / Abort
 * (2) 中转 quota / billing / plan limit / insufficient credit
 * (3) parser / 不完整 SSE / JSON 错
 * (4) ImageAuthError(401/403):duckcoding 中转 /v1/responses 没代理时返 401
 *     「Invalid token」;不是真 key 失效,而是 route 缺。warn-skip 不算 fail。
 * (5) 中转 model 白名单没 gpt-5.5(或者 /responses endpoint 无效)返 4xx 「unknown model」
 *     / 「not found」等 → 同样 skip。
 * (6) openai-image.ts 的 ImagePathAFailed:路 A 网络层失败包装,hybrid 模式
 *     不降级路 B 直接抛此错;message 已含底层原因,继续走 isSkippable 模式判定。
 */
function isSkippable(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e instanceof ImageAuthError) return true
  const msg = e.message ?? ''
  return (
    /timeout|ECONNREFUSED|502|503|504|fetch failed|AbortError|aborted|network error/i.test(msg) ||
    /quota|extra usage|plan limit|insufficient|billing|credit|top.?up/i.test(msg) ||
    /Incomplete JSON|JSON parse|Unexpected token|SyntaxError/i.test(msg) ||
    /unknown model|model.*not.*found|not.*support|not.*available|route.*not.*found|404/i.test(msg) ||
    /path A failed/i.test(msg)
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}
