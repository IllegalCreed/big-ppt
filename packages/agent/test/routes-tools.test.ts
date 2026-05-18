import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { tools as toolsRoute } from '../src/routes/tools.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { __resetRegistry, register } from '../src/tools/registry.js'
import { registerLocalTools } from '../src/tools/local/index.js'
import { __resetPathsForTesting } from '../src/workspace.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import {
  __resetImageJobsForTesting,
  getImageJob,
  type ImageJob,
} from '../src/image-gen-job.js'
import { __setGenerateImageForTesting } from '../src/tools/local/generate-slide-image.js'
import type { ImageGenInput, ImageGenOutput } from '../src/llm/openai-image.js'
import { setImageLlmSettings } from '../src/db/image-llm-settings.js'
import { createAsset, listAssetIdsByDeck, getAsset } from '../src/db/deck-assets.js'
import { getDb, decks, deckVersions } from '../src/db/index.js'

useTestDb()

function buildApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', toolsRoute)
  return app
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-routes-'))
  const slidevDir = path.join(tmpRoot, 'packages/slidev')
  fs.mkdirSync(path.join(slidevDir, 'templates/beitou-standard'), { recursive: true })
  fs.writeFileSync(path.join(slidevDir, 'slides.md'), '# t\n')
  process.env.BIG_PPT_SLIDES_PATH = path.join(slidevDir, 'slides.md')
  process.env.BIG_PPT_HISTORY_DIR = path.join(tmpRoot, 'slides-history')
  __resetPathsForTesting()
  __resetRegistry()
})

afterEach(() => {
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_HISTORY_DIR
  __resetPathsForTesting()
  __resetRegistry()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('GET /api/tools', () => {
  it('未登录 → 401（Phase 9-B 防工具枚举）', async () => {
    const res = await buildApp().request('/api/tools')
    expect(res.status).toBe(401)
  })

  it('登录后空 registry 返回空数组', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/tools', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, tools: [] })
  })

  it('登录后注册本地工具后返回 12 项（含四件套 + switch_template + generate_slide_image + Phase 13 list_uploaded_files / read_uploaded_file）', async () => {
    registerLocalTools()
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/tools', { headers: { Cookie: cookie } })
    const json = await res.json()
    expect(json.tools).toHaveLength(12)
    expect(json.tools.map((t: any) => t.function.name).sort()).toEqual([
      'create_slide',
      'delete_slide',
      'edit_slides',
      'generate_slide_image',
      'list_uploaded_files',
      'read_slides',
      'read_template',
      'read_uploaded_file',
      'reorder_slides',
      'switch_template',
      'update_slide',
      'write_slides',
    ])
  })
})

describe('POST /api/call-tool', () => {
  it('未登录 → 401（Phase 9-B 防未授权工具调用）', async () => {
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'read_slides', args: {} }),
    })
    expect(res.status).toBe(401)
  })

  it('登录后未知工具返回 404', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'nope', args: {} }),
    })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('登录后缺 name 返回 400', async () => {
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ args: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('登录后调用本地 read_slides 返回 result 字符串 (走 ALS deckId)', async () => {
    // P0 fix(2026-05-18):read_slides 从 DB 读 currentVersion.content,需 X-Deck-Id header
    registerLocalTools()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'D', '# t\n')
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Deck-Id': String(deck.id) },
      body: JSON.stringify({ name: 'read_slides', args: {} }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, result: '# t\n' })
  })

  it('登录后工具 exec 抛错时返回 success=false', async () => {
    register({
      name: 'boom',
      description: '',
      parameters: { type: 'object', properties: {} },
      exec: async () => {
        throw new Error('oops')
      },
    })
    const { cookie } = await createLoggedInUser()
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'boom', args: {} }),
    })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('oops')
  })

  /**
   * 路由层 IDOR(P0 漏洞修复回归保护,Phase 15.x):
   * 用户 B 携自身 cookie + 伪造的 `X-Deck-Id=<userA-deck>` 调 write_slides。
   *
   * Middleware (request-context) 会把 header 里 deckId 注入 ALS,但 slides-store
   * `getCurrentDeckContent` 用 `(decks.id=X AND decks.userId=B)` 复合 where 查不到 →
   * 抛 NoActiveDeckError → tools/local/utils.ts 的 `withSlidesStoreGuard` catch 后
   * 返 `{success:false, error: NoActiveDeckError.message}`。
   *
   * HTTP 层语义:
   * - 状态码 200(call-tool 自身没失败,工具内部错误用 inner success 表达)
   * - body.success = true(工具被调度成功)
   * - body.result = "JSON string,parse 后 inner.success === false"
   *
   * 防回归:未来若误把 slides-store 的 ALS guard 拆掉/弱化(只查 deckId 不查 userId),
   * write_slides 会落盘到 A 的 deck → 本 case 即刻红。
   */
  it('IDOR:用户 B 携 X-Deck-Id=deckA 调 write_slides → tool 内 inner.success=false,A 的 deck 内容零副作用', async () => {
    registerLocalTools()
    // user A 持有 deckA,starter 内容
    const { user: userA } = await createLoggedInUser('idor-route-a@a.com')
    const A_STARTER =
      '---\nlayout: cover\nmainTitle: 请填写标题\nsubtitle: 请填写副标题\ndate: YYYY/MM/DD\n---\n'
    const { deck: deckA } = await createDeckDirect(userA.id, 'A-deck', A_STARTER)
    // user B
    const { cookie: cookieB } = await createLoggedInUser('idor-route-b@a.com')

    const hackPayload = '---\nlayout: cover\nmainTitle: HACKED-BY-B\n---\n'
    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
        'X-Deck-Id': String(deckA.id),
      },
      body: JSON.stringify({ name: 'write_slides', args: { content: hackPayload } }),
    })
    // call-tool 本身 200(工具调度成功),inner.success=false 表达 IDOR 被守住
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(typeof body.result).toBe('string')
    const inner = JSON.parse(body.result as string)
    expect(inner.success).toBe(false)
    expect(typeof inner.error).toBe('string')
    expect(inner.error.length).toBeGreaterThan(0)

    // 副作用 0:deckA.currentVersion.content 没被改成 HACKED
    const db = getDb()
    const [d] = await db.select().from(decks).where(eq(decks.id, deckA.id)).limit(1)
    expect(d).toBeTruthy()
    const [v] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, d!.currentVersionId!))
      .limit(1)
    expect(v!.content).toBe(A_STARTER)
    expect(v!.content).not.toContain('HACKED-BY-B')
  })
})

/**
 * Hybrid vision-aware 端到端集成测(2026-05-18)。
 *
 * 走 app.fetch + 真 DB + 真 ALS + 真 worker job map + 真 deck_assets BLOB IO。
 * 只 mock `generateImage`(用 `__setGenerateImageForTesting` 注入)既能捕获工具真实
 * 透传给 OpenAI 的 args(尤其 baseImageBase64),又能返合法 fake PNG 让 worker
 * 一路跑完 createAsset / updateSlide / 状态机。
 *
 * 关键覆盖(对应 hybrid 改造 4 条契约):
 * - A. happy path:slide 已有 imageSrc 指向自家 asset → generateImage 收 baseImageBase64
 *      字节等于原 asset.data + slide imageSrc 更新为新 asset id
 * - B. 无图首次生成:无 imageSrc → generateImage 收 args.baseImageBase64 = undefined
 * - C. IDOR guard:asset 属另一 user → 静默走 text-only,不漏字节给生图模型
 * - D. 野 url graceful:imageSrc = https://...(非 /api/assets/<uuid>)→ 静默走 text-only
 */
describe('POST /api/call-tool — generate_slide_image hybrid vision-aware (端到端)', () => {
  // 1x1 px PNG, 67 字节(magic + IHDR + IDAT + IEND),给 fake generateImage 返足够大的 b64
  const FAKE_PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk header
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, // IDAT chunk header
    0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05,
    0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
    0xae, 0x42, 0x60, 0x82,
  ])
  const FAKE_PNG_B64 = FAKE_PNG_BYTES.toString('base64')

  // 原 asset BLOB 字节(故意区别于 FAKE_PNG_BYTES,跨字节级断言比对)
  const ORIGINAL_ASSET_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56,
  ])

  type SeamCall = ImageGenInput
  let seamCalls: SeamCall[]
  let fakeGenerate: (input: ImageGenInput) => Promise<ImageGenOutput>

  beforeEach(() => {
    // 注册工具(每个 case 跑前 __resetRegistry 会清空)
    registerLocalTools()
    __resetImageJobsForTesting()
    seamCalls = []
    fakeGenerate = async (input: ImageGenInput): Promise<ImageGenOutput> => {
      seamCalls.push(input)
      return { b64: FAKE_PNG_B64, modelUsed: 'fake-test', pathTaken: 'A' }
    }
    __setGenerateImageForTesting(fakeGenerate)
  })

  afterEach(() => {
    __setGenerateImageForTesting(null)
    __resetImageJobsForTesting()
  })

  async function pollJobUntilTerminal(
    jobId: string,
    timeoutMs = 10_000,
  ): Promise<ImageJob | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const j = getImageJob(jobId)
      if (
        j &&
        (j.state === 'done' ||
          j.state === 'failed' ||
          j.state === 'cancelled' ||
          j.state === 'fallback-rewrote' ||
          j.state === 'fallback-failed')
      ) {
        return j
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    return getImageJob(jobId)
  }

  async function setDeckContent(deckId: number, content: string): Promise<void> {
    const db = getDb()
    const [d] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1)
    if (!d || !d.currentVersionId) throw new Error('deck 无 currentVersion')
    await db
      .update(deckVersions)
      .set({ content })
      .where(eq(deckVersions.id, d.currentVersionId))
    // 同时写 fs slides.md,让工具的 readSlides 通过(它走 ALS deckId → DB,但
    // worker 在 fire-and-forget 异步路径也会调 slides-store 写;为 belt-and-suspenders 双写)
    if (process.env.BIG_PPT_SLIDES_PATH) {
      fs.writeFileSync(process.env.BIG_PPT_SLIDES_PATH, content, 'utf-8')
    }
  }

  const FIXTURE_3_PAGES_NO_IMAGE = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-content
heading: 第二页标题
---

正文 A

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`

  function fixture3PagesWithImageOnPage2(assetId: string): string {
    return `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-image-content
heading: 第二页标题
imageSrc: /api/assets/${assetId}
---

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`
  }

  it('A. happy hybrid:slide 有 imageSrc 指向自家 asset → generateImage 收 baseImage 字节等于 asset.data;新 asset 入库;slide imageSrc 更新', async () => {
    const { user, cookie } = await createLoggedInUser('hybrid-int-a@a.com')
    const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_3_PAGES_NO_IMAGE)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    // 建一行 deck_assets(归属 user + deck),再把 deck content 切到 page 2 含 imageSrc
    const originalAsset = await createAsset({
      deckId: deck.id,
      userId: user.id,
      mimeType: 'image/png',
      data: ORIGINAL_ASSET_BYTES,
      prompt: 'seed',
      model: 'test',
    })
    await setDeckContent(deck.id, fixture3PagesWithImageOnPage2(originalAsset.id))

    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Deck-Id': String(deck.id),
      },
      body: JSON.stringify({
        name: 'generate_slide_image',
        args: {
          slideIndex: 2,
          prompt: 'change colors warm',
          fallbackSummary: '改色',
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const inner = JSON.parse(body.result as string)
    expect(inner.success).toBe(true)
    expect(inner.jobId).toMatch(/^[0-9a-f-]{36}$/)
    expect(inner.status).toBe('queued')

    const job = await pollJobUntilTerminal(inner.jobId)
    expect(job).not.toBeNull()
    expect(job!.state).toBe('done')

    // generateImage 真被调一次,且 args 携带原 asset 字节
    expect(seamCalls).toHaveLength(1)
    const seam = seamCalls[0]!
    expect(typeof seam.baseImageBase64).toBe('string')
    expect(seam.baseImageBase64!.length).toBeGreaterThan(0)
    expect(seam.baseImageMime).toBe('image/png')
    const receivedBytes = Buffer.from(seam.baseImageBase64!, 'base64')
    expect(receivedBytes.equals(ORIGINAL_ASSET_BYTES)).toBe(true)

    // deck_assets 多了一行新 asset(归属同 deck + 同 user)
    const ids = await listAssetIdsByDeck(deck.id)
    expect(ids).toContain(originalAsset.id) // 原 asset 仍在(deck_versions restore 用)
    expect(ids.length).toBeGreaterThanOrEqual(2)
    const newAssetId = ids.find((id) => id !== originalAsset.id)!
    expect(newAssetId).toBeTruthy()
    const newAsset = await getAsset(newAssetId)
    expect(newAsset).not.toBeNull()
    expect(newAsset!.userId).toBe(user.id)
    expect(newAsset!.deckId).toBe(deck.id)
    expect(newAsset!.bytesSize).toBe(FAKE_PNG_BYTES.length)

    // slide frontmatter.imageSrc 从原 uuid 变成新 asset id
    const db = getDb()
    const [d2] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    const [v2] = await db
      .select({ content: deckVersions.content })
      .from(deckVersions)
      .where(eq(deckVersions.id, d2!.currentVersionId!))
      .limit(1)
    expect(v2!.content).toContain(`/api/assets/${newAssetId}`)
    expect(v2!.content).not.toContain(`/api/assets/${originalAsset.id}`)
  })

  it('B. 无图首次生成:slide 无 imageSrc → generateImage 收 args.baseImageBase64 = undefined(degrade text-only);流程仍正常完成', async () => {
    const { user, cookie } = await createLoggedInUser('hybrid-int-b@a.com')
    const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_3_PAGES_NO_IMAGE)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
    await setDeckContent(deck.id, FIXTURE_3_PAGES_NO_IMAGE)

    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Deck-Id': String(deck.id),
      },
      body: JSON.stringify({
        name: 'generate_slide_image',
        args: {
          slideIndex: 2,
          prompt: 'a futuristic city',
          fallbackSummary: '某段中文兜底摘要',
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const inner = JSON.parse(body.result as string)
    expect(inner.success).toBe(true)

    const job = await pollJobUntilTerminal(inner.jobId)
    expect(job!.state).toBe('done')

    // 关键:无 imageSrc 时 generateImage 收到的 baseImageBase64 必须 undefined(IDOR-safe 默认)
    expect(seamCalls).toHaveLength(1)
    expect(seamCalls[0]!.baseImageBase64).toBeUndefined()
    expect(seamCalls[0]!.baseImageMime).toBeUndefined()

    // deck_assets 多一行新 asset
    const ids = await listAssetIdsByDeck(deck.id)
    expect(ids).toHaveLength(1)
  })

  it('C. IDOR guard:imageSrc 指向另一 user 的 asset → generateImage 收到 baseImageBase64 = undefined(不漏字节);工具仍成功', async () => {
    // user A 拥有 asset
    const { user: userA } = await createLoggedInUser('hybrid-int-c-a@a.com')
    const { deck: deckA } = await createDeckDirect(userA.id, 'A', FIXTURE_3_PAGES_NO_IMAGE)
    const assetA = await createAsset({
      deckId: deckA.id,
      userId: userA.id,
      mimeType: 'image/png',
      data: Buffer.from('SECRET_BYTES_OF_USER_A_DO_NOT_LEAK'),
      prompt: 'secret',
      model: 'test',
    })

    // user B 在自家 deck 把 imageSrc 拼成 A 的 asset uuid(横向越权尝试)
    const { user: userB, cookie: cookieB } = await createLoggedInUser('hybrid-int-c-b@a.com')
    const { deck: deckB } = await createDeckDirect(userB.id, 'B', FIXTURE_3_PAGES_NO_IMAGE)
    await setImageLlmSettings(userB.id, { provider: 'openai', apiKey: 'sk-x' })
    await setDeckContent(deckB.id, fixture3PagesWithImageOnPage2(assetA.id))

    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
        'X-Deck-Id': String(deckB.id),
      },
      body: JSON.stringify({
        name: 'generate_slide_image',
        args: {
          slideIndex: 2,
          prompt: 'p',
          fallbackSummary: 's',
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const inner = JSON.parse(body.result as string)
    expect(inner.success).toBe(true)

    const job = await pollJobUntilTerminal(inner.jobId)
    expect(job!.state).toBe('done')

    // 核心安全断言:B 拿不到 A 的字节,generateImage 收 undefined → 上游不会看到 A 的图
    expect(seamCalls).toHaveLength(1)
    expect(seamCalls[0]!.baseImageBase64).toBeUndefined()
    expect(seamCalls[0]!.baseImageMime).toBeUndefined()
  })

  it('D. 野 imageSrc URL graceful:imageSrc = https://example.com/... → 静默走 text-only,工具仍成功', async () => {
    const { user, cookie } = await createLoggedInUser('hybrid-int-d@a.com')
    const { deck } = await createDeckDirect(user.id, 'D', FIXTURE_3_PAGES_NO_IMAGE)
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })

    const slidesBadUrl = `---
layout: beitou-cover
mainTitle: T
---

---
layout: beitou-image-content
heading: 第二页标题
imageSrc: https://example.com/random.jpg
---

---
layout: beitou-content
heading: 第三页标题
---

正文 B
`
    await setDeckContent(deck.id, slidesBadUrl)

    const res = await buildApp().request('/api/call-tool', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Deck-Id': String(deck.id),
      },
      body: JSON.stringify({
        name: 'generate_slide_image',
        args: {
          slideIndex: 2,
          prompt: 'p',
          fallbackSummary: 's',
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    const inner = JSON.parse(body.result as string)
    expect(inner.success).toBe(true)

    const job = await pollJobUntilTerminal(inner.jobId)
    expect(job!.state).toBe('done')

    expect(seamCalls).toHaveLength(1)
    expect(seamCalls[0]!.baseImageBase64).toBeUndefined()
    expect(seamCalls[0]!.baseImageMime).toBeUndefined()
  })
})
