/**
 * Phase 11.5 Task D：OpenAI 出图 client 单测。
 *
 * 关键覆盖:
 * - 路 A 成功
 * - 路 A 缺 image_generation_call → fallback 到路 B
 * - 路 A 5xx → fallback 到路 B
 * - 401 → ImageAuthError(无 fallback)
 * - 路 A + B 都失败 → 抛 last error
 * - signal aborted → ImageCancelled
 * - 用户 settings.model='gpt-image-2' → 直走路 B(无 fallback)
 *
 * Vitest 4 起 vi.mock 对 dynamic import 不稳,用 vi.spyOn(globalThis,'fetch')(plan 17 踩坑 2)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateImage,
  ImageAuthError,
  ImageCancelled,
} from '../src/llm/openai-image.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const TEST_BASE = 'https://test.openai/v1'
const FAKE_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII='

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((u, init) => impl(u as string, init as RequestInit)) as typeof fetch)
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('llm/openai-image generateImage', () => {
  it('路 A 成功:gpt-5.5 + image_generation_call.result → b64 / pathA', async () => {
    mockFetch(async (url) => {
      expect(url).toBe(`${TEST_BASE}/responses`)
      return jsonResponse({
        output: [{ type: 'image_generation_call', result: FAKE_B64 }],
      })
    })
    const out = await generateImage({
      prompt: 'a city',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk-x',
      baseUrl: TEST_BASE,
    })
    expect(out.b64).toBe(FAKE_B64)
    expect(out.pathTaken).toBe('A')
    expect(out.modelUsed).toBe('gpt-5.5')
  })

  it('路 A 容错:item.type 以 image_generation_call 结尾(防字段微调)', async () => {
    mockFetch(async () =>
      jsonResponse({
        output: [
          { type: 'reasoning', text: '...' },
          { type: 'tool.image_generation_call', result: FAKE_B64 },
        ],
      }),
    )
    const out = await generateImage({
      prompt: 'a',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
    })
    expect(out.pathTaken).toBe('A')
    expect(out.b64).toBe(FAKE_B64)
  })

  it('路 A 缺 image_generation_call → fallback 路 B 成功', async () => {
    let callCount = 0
    mockFetch(async (url) => {
      callCount++
      if (url.endsWith('/responses')) {
        return jsonResponse({ output: [{ type: 'reasoning', text: 'forgot tool' }] })
      }
      expect(url).toBe(`${TEST_BASE}/images/generations`)
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'a',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
    })
    expect(callCount).toBe(2)
    expect(out.pathTaken).toBe('B')
    expect(out.modelUsed).toBe('gpt-image-2')
    expect(out.b64).toBe(FAKE_B64)
  })

  it('路 A 5xx → fallback 路 B', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/responses')) {
        return new Response('upstream error', { status: 503 })
      }
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'a',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
    })
    expect(out.pathTaken).toBe('B')
  })

  it('路 A 401 → fallback 到路 B(中转 endpoint 不支持时常返含糊 401)', async () => {
    let callCount = 0
    mockFetch(async (url) => {
      callCount++
      if (url.endsWith('/responses')) {
        return jsonResponse({ error: { message: 'Invalid API key' } }, { status: 401 })
      }
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'a',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
    })
    expect(callCount).toBe(2) // 路 A 401 → 路 B 成功
    expect(out.pathTaken).toBe('B')
  })

  it('路 A 401 + 路 B 401 → 双路都失败,最终抛 ImageAuthError(真 key 失效)', async () => {
    mockFetch(async () =>
      jsonResponse({ error: { message: 'Invalid API key' } }, { status: 401 }),
    )
    await expect(
      generateImage({
        prompt: 'a',
        size: '1280x720',
        signal: new AbortController().signal,
        apiKey: 'sk-bad',
        baseUrl: TEST_BASE,
      }),
    ).rejects.toBeInstanceOf(ImageAuthError)
  })

  it('路 A + B 都失败 → 抛错', async () => {
    mockFetch(async (url) => {
      if (url.endsWith('/responses')) return new Response('boom', { status: 503 })
      return new Response('also boom', { status: 502 })
    })
    await expect(
      generateImage({
        prompt: 'a',
        size: '1280x720',
        signal: new AbortController().signal,
        apiKey: 'sk',
        baseUrl: TEST_BASE,
      }),
    ).rejects.toThrow()
  })

  it('signal aborted before call → ImageCancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFetch(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    await expect(
      generateImage({
        prompt: 'a',
        size: '1280x720',
        signal: controller.signal,
        apiKey: 'sk',
        baseUrl: TEST_BASE,
      }),
    ).rejects.toBeInstanceOf(ImageCancelled)
  })

  it('用户 settings.model=gpt-image-2 → 直走路 B,不试路 A', async () => {
    let callCount = 0
    let lastUrl = ''
    mockFetch(async (url) => {
      callCount++
      lastUrl = url
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'a',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
      primaryModel: 'gpt-image-2',
    })
    expect(callCount).toBe(1)
    expect(lastUrl).toBe(`${TEST_BASE}/images/generations`)
    expect(out.pathTaken).toBe('B')
    expect(out.modelUsed).toBe('gpt-image-2')
  })

  it('hybrid vision-aware:有 baseImageBase64 → 路 A payload input 是 content array 含 input_image', async () => {
    let capturedBody: { input?: Array<Record<string, unknown>> } | null = null
    mockFetch(async (url, init) => {
      expect(url).toBe(`${TEST_BASE}/responses`)
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return jsonResponse({
        output: [{ type: 'image_generation_call', result: FAKE_B64 }],
      })
    })
    const out = await generateImage({
      prompt: 'add a cat on the rooftop',
      size: '1536x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
      baseImageBase64: 'AAAA',
      baseImageMime: 'image/png',
    })
    expect(out.pathTaken).toBe('A')

    // Type-narrowing: vitest mocked closure 已经赋值,直接 non-null assert
    const body = capturedBody as { input: Array<{ role: string; content: unknown }> } | null
    expect(body).not.toBeNull()
    expect(body!.input).toHaveLength(1)
    const msg = body!.input[0]!
    expect(msg.role).toBe('user')
    expect(Array.isArray(msg.content)).toBe(true)
    const blocks = msg.content as Array<Record<string, unknown>>
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'input_text', text: 'add a cat on the rooftop' })
    expect(blocks[1]).toEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,AAAA',
    })
  })

  it('hybrid vision-aware:无 baseImage → 路 A payload input.content 仍是 string(向后兼容)', async () => {
    let capturedBody: { input?: Array<Record<string, unknown>> } | null = null
    mockFetch(async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return jsonResponse({
        output: [{ type: 'image_generation_call', result: FAKE_B64 }],
      })
    })
    await generateImage({
      prompt: 'a city',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
    })
    const body = capturedBody as { input: Array<{ role: string; content: unknown }> } | null
    expect(body).not.toBeNull()
    expect(body!.input[0]!.content).toBe('a city')
  })

  // Phase 11.8 (2026-05-19):hybrid 失败三级降级 — 路 A 失败时降级路 B + palette,
  // 路 B 失败才抛错走 fallback-rewrote。锚图模式落地后任一 vision 抖动也要保住
  // image 模式(palette 维度仍对齐),不能直接换组件版。
  it('hybrid 三级降级:有 baseImage + 路 A 5xx → 降级路 B 成功 → pathTaken=B', async () => {
    let callCount = 0
    mockFetch(async (url) => {
      callCount++
      if (url.endsWith('/responses')) return new Response('boom', { status: 503 })
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'add a cat',
      size: '1536x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
      baseImageBase64: 'AAAA',
      baseImageMime: 'image/png',
    })
    expect(out.pathTaken).toBe('B')
    expect(out.b64).toBe(FAKE_B64)
    expect(callCount).toBe(2) // 路 A + 路 B
  })

  it('hybrid 三级降级:有 baseImage + 路 A 401 + 路 B 成功 → pathTaken=B', async () => {
    let callCount = 0
    mockFetch(async (url) => {
      callCount++
      if (url.endsWith('/responses')) {
        return jsonResponse({ error: { message: 'Invalid API key' } }, { status: 401 })
      }
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'add a cat',
      size: '1536x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
      baseImageBase64: 'AAAA',
      baseImageMime: 'image/png',
    })
    expect(out.pathTaken).toBe('B')
    expect(callCount).toBe(2)
  })

  it('hybrid 三级降级:有 baseImage + 路 A 失败 + 路 B 也失败 → 抛错(走 fallback-rewrote)', async () => {
    let callCount = 0
    mockFetch(async (url) => {
      callCount++
      if (url.endsWith('/responses')) return new Response('boom', { status: 503 })
      return new Response('also boom', { status: 500 })
    })
    await expect(
      generateImage({
        prompt: 'add a cat',
        size: '1536x720',
        signal: new AbortController().signal,
        apiKey: 'sk',
        baseUrl: TEST_BASE,
        baseImageBase64: 'AAAA',
        baseImageMime: 'image/png',
      }),
    ).rejects.toThrow()
    expect(callCount).toBe(2) // 路 A + 路 B 都试过
  })

  it('hybrid vision-aware:有 baseImage + primaryModel=gpt-image-2 → 走路 B(纯 text-to-image,忽略 baseImage)', async () => {
    // gpt-image-* 强制走路 B,路 B 不支持 image input;此时降级为 text-only
    let callCount = 0
    let lastUrl = ''
    mockFetch(async (url) => {
      callCount++
      lastUrl = url
      return jsonResponse({ data: [{ b64_json: FAKE_B64 }] })
    })
    const out = await generateImage({
      prompt: 'a city',
      size: '1536x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: TEST_BASE,
      primaryModel: 'gpt-image-2',
      baseImageBase64: 'AAAA',
      baseImageMime: 'image/png',
    })
    expect(callCount).toBe(1)
    expect(lastUrl).toBe(`${TEST_BASE}/images/generations`)
    expect(out.pathTaken).toBe('B')
  })

  it('baseUrl 末尾斜杠 trim:不重复 //', async () => {
    let captured = ''
    mockFetch(async (url) => {
      captured = url
      return jsonResponse({ output: [{ type: 'image_generation_call', result: FAKE_B64 }] })
    })
    await generateImage({
      prompt: 'a',
      size: '1280x720',
      signal: new AbortController().signal,
      apiKey: 'sk',
      baseUrl: `${TEST_BASE}/`,
    })
    expect(captured).toBe(`${TEST_BASE}/responses`)
  })
})
