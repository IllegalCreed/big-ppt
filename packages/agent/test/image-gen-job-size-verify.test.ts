/**
 * image-gen worker 落库前的返回尺寸校验(2026-07 dogfood)。
 *
 * 背景:生产出图中转不认 size 参数——请求 1280x624(2.051:1)却按 16:9 返 1672x941(1.777:1),
 * 塞进 *-image-content layout 的 body 区(object-fit:cover)上下各裁 ~6.7%,用户报「图被截取」。
 * worker 拿到字节后解析真实分辨率,与请求 size 的宽高比不符即 logServerEvent 落 size-mismatch,
 * 事后 grep 定位是哪家 provider / baseUrl 忽略了尺寸。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/logger/server-log.js', () => ({ logServerEvent: vi.fn() }))

import { logServerEvent } from '../src/logger/server-log.js'
import {
  createImageJob,
  runImageJob,
  __resetImageJobsForTesting,
  type RunImageJobDeps,
} from '../src/image-gen-job.js'

/** 造真实 PNG 头 → base64(worker 内 Buffer.from(b64,'base64') 后读 IHDR) */
function pngB64(w: number, h: number): string {
  const b = Buffer.alloc(33)
  b.writeUInt32BE(0x89504e47, 0)
  b.writeUInt32BE(0x0d0a1a0a, 4)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b.toString('base64')
}

function makeDeps(b64: string): RunImageJobDeps {
  return {
    generateImage: vi.fn(async () => ({ b64, modelUsed: 'gpt-5.5', pathTaken: 'A' as const })),
    createAsset: vi.fn(async () => ({ id: 'asset-uuid-001' })),
    updateSlide: vi.fn(async () => undefined),
    targetLayout: 'beitou-image-content',
  }
}

function loggedEvents(): Array<Record<string, unknown>> {
  return vi.mocked(logServerEvent).mock.calls.map((c) => c[0] as Record<string, unknown>)
}

beforeEach(() => {
  __resetImageJobsForTesting()
  vi.mocked(logServerEvent).mockClear()
})
afterEach(() => __resetImageJobsForTesting())

describe('image-gen worker 返回尺寸校验', () => {
  it('中转按 16:9 返图(1672x941)≠ 请求 1280x624 → 落 size-mismatch 事件', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x624',
    })
    await runImageJob(job.id, makeDeps(pngB64(1672, 941)))

    const mismatch = loggedEvents().find((e) => e.event === 'size-mismatch')
    expect(mismatch).toBeTruthy()
    expect(mismatch).toMatchObject({
      category: 'image-gen',
      event: 'size-mismatch',
      requestedSize: '1280x624',
      actualWidth: 1672,
      actualHeight: 941,
    })
  })

  it('返回图精确匹配请求尺寸(1280x624)→ 不落 size-mismatch', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x624',
    })
    await runImageJob(job.id, makeDeps(pngB64(1280, 624)))

    expect(loggedEvents().find((e) => e.event === 'size-mismatch')).toBeFalsy()
  })

  it('返回图同比高分辨率(2560x1248,AR 一致)→ 不落 size-mismatch', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x624',
    })
    await runImageJob(job.id, makeDeps(pngB64(2560, 1248)))

    expect(loggedEvents().find((e) => e.event === 'size-mismatch')).toBeFalsy()
  })

  it('请求 size 串非法时静默跳过校验(不抛错、不落 size-mismatch)', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: 'not-a-size',
    })
    await runImageJob(job.id, makeDeps(pngB64(1672, 941)))

    expect(loggedEvents().find((e) => e.event === 'size-mismatch')).toBeFalsy()
    expect(loggedEvents().find((e) => e.event === 'done')).toBeTruthy()
  })

  it('字节解析不出尺寸时不抛错、不落 size-mismatch(优雅跳过)', async () => {
    const job = createImageJob({
      deckId: 1,
      userId: 1,
      slideIndex: 1,
      prompt: 'x',
      size: '1280x624',
    })
    // 合法 base64 但不是图片头
    const garbage = Buffer.from('totally not an image').toString('base64')
    await runImageJob(job.id, makeDeps(garbage))

    expect(loggedEvents().find((e) => e.event === 'size-mismatch')).toBeFalsy()
    // 仍走到 done(校验失败不阻断落库)
    expect(loggedEvents().find((e) => e.event === 'done')).toBeTruthy()
  })
})
