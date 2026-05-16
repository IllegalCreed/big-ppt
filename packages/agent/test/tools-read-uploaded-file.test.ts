/**
 * Phase 13 Task D：read_uploaded_file 工具集成测。
 *
 * 关键覆盖:
 * - 未登录 → 失败
 * - text mode + extractStatus 5 态: done / pending / failed / 错 mime
 * - image mode + 错 mime / 主 LLM 非 multi-modal / 主 LLM 是 multi-modal happy
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting, encryptApiKey } from '../src/crypto/apikey.js'
import { readUploadedFileTool } from '../src/tools/local/read-uploaded-file.js'
import { runInRequest } from '../src/context.js'
import { getDb, userAssets, users } from '../src/db/index.js'
import { putAssetBytes } from '../src/uploads/storage.js'

useTestDb()

const runTool = readUploadedFileTool.exec.bind(readUploadedFileTool)
const FIXED_KEY = Buffer.alloc(32, 0x4f)

let tmpRoot: string
let prevAssetsDir: string | undefined

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterAll(() => {
  __setMasterKeyGetterForTesting(null)
})

beforeEach(async () => {
  prevAssetsDir = process.env.LUMIDECK_ASSETS_DIR
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumideck-read-asset-'))
  process.env.LUMIDECK_ASSETS_DIR = tmpRoot
})

afterEach(async () => {
  if (prevAssetsDir === undefined) delete process.env.LUMIDECK_ASSETS_DIR
  else process.env.LUMIDECK_ASSETS_DIR = prevAssetsDir
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

async function insertAsset(
  userId: number,
  opts: {
    mime?: string
    extractedText?: string | null
    extractStatus?: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
    extractErrorMsg?: string | null
  },
): Promise<string> {
  const id = randomUUID()
  await getDb().insert(userAssets).values({
    id,
    userId,
    filename: 'f.bin',
    mime: opts.mime ?? 'application/pdf',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    storagePath: `${userId}/${id}`,
    extractedText: opts.extractedText ?? null,
    extractStatus: opts.extractStatus ?? 'done',
    extractErrorMsg: opts.extractErrorMsg ?? null,
  })
  return id
}

async function setUserLlmSettings(
  userId: number,
  shape: { activeProvider: string; providers: Record<string, { apiKey: string; model?: string }> },
): Promise<void> {
  const blob = encryptApiKey(JSON.stringify(shape))
  await getDb().update(users).set({ llmSettings: blob }).where(eq(users.id, userId))
}

describe('read_uploaded_file 工具', () => {
  it('未登录 → 失败', async () => {
    const result = await runTool({ id: 'whatever' })
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/未登录/)
  })

  it('invalid args (缺 id) → 失败', async () => {
    const { user } = await createLoggedInUser('bad@a.com')
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({}),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/invalid args/)
  })

  it('asset 不存在 → 失败', async () => {
    const { user } = await createLoggedInUser('nf@a.com')
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id: randomUUID() }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/not found/)
  })

  it('text mode + extractStatus=done → 返 extractedText', async () => {
    const { user } = await createLoggedInUser('t-done@a.com')
    const id = await insertAsset(user.id, {
      mime: 'application/pdf',
      extractedText: 'hello extracted text',
      extractStatus: 'done',
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'text' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(json.content).toBe('hello extracted text')
  })

  it('text mode + extractStatus=pending → 失败 + 提示稍后再试', async () => {
    const { user } = await createLoggedInUser('t-pending@a.com')
    const id = await insertAsset(user.id, {
      mime: 'application/pdf',
      extractStatus: 'pending',
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'text' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/正在处理/)
  })

  it('text mode + extractStatus=failed → 失败 + 错误消息含 extractErrorMsg', async () => {
    const { user } = await createLoggedInUser('t-failed@a.com')
    const id = await insertAsset(user.id, {
      mime: 'application/pdf',
      extractStatus: 'failed',
      extractErrorMsg: 'parser timeout',
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'text' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/parser timeout/)
  })

  it('text mode + image mime → 失败 + 引导用 mode=image', async () => {
    const { user } = await createLoggedInUser('t-img@a.com')
    const id = await insertAsset(user.id, {
      mime: 'image/png',
      extractStatus: 'skipped',
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'text' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/mode=image/)
  })

  it('image mode + 非 image mime → 失败 + 引导用 mode=text', async () => {
    const { user } = await createLoggedInUser('i-nonimg@a.com')
    const id = await insertAsset(user.id, {
      mime: 'application/pdf',
      extractStatus: 'done',
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'image' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/mode=text/)
  })

  it('image mode + 主 LLM 不是 multi-modal → 失败 + 不支持图片', async () => {
    const { user } = await createLoggedInUser('i-nomm@a.com')
    // 配 zhipu/glm-5.1(纯文本,不支持图片)
    await setUserLlmSettings(user.id, {
      activeProvider: 'zhipu',
      providers: { zhipu: { apiKey: 'sk-test', model: 'glm-5.1' } },
    })
    const id = await insertAsset(user.id, {
      mime: 'image/png',
      extractStatus: 'skipped',
    })
    // 写图字节免读字节时炸,虽然这条路径走不到读字节
    await putAssetBytes(user.id, id, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'image' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/不支持图片/)
    expect(json.error).toMatch(/zhipu\/glm-5\.1/)
  })

  it('image mode + 主 LLM 是 multi-modal → 成功 + base64', async () => {
    const { user } = await createLoggedInUser('i-mm@a.com')
    await setUserLlmSettings(user.id, {
      activeProvider: 'anthropic',
      providers: { anthropic: { apiKey: 'sk-test', model: 'claude-opus-4-7' } },
    })
    const id = await insertAsset(user.id, {
      mime: 'image/png',
      extractStatus: 'skipped',
    })
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await putAssetBytes(user.id, id, pngBytes)

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'image' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(json.image).toBeDefined()
    expect(json.image.mediaType).toBe('image/png')
    expect(json.image.dataBase64).toBe(pngBytes.toString('base64'))
  })

  it('image mode + 主 LLM 未配 → 失败 + 提示切换', async () => {
    const { user } = await createLoggedInUser('i-noconfig@a.com')
    const id = await insertAsset(user.id, {
      mime: 'image/png',
      extractStatus: 'skipped',
    })
    await putAssetBytes(user.id, id, Buffer.from([0x89]))

    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'image' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/不支持图片/)
  })

  it('text mode 是默认 mode (省略 mode 参数)', async () => {
    const { user } = await createLoggedInUser('default-mode@a.com')
    const id = await insertAsset(user.id, {
      mime: 'text/markdown',
      extractedText: 'default mode text',
      extractStatus: 'done',
    })
    const result = await runInRequest(
      { userId: user.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(true)
    expect(json.content).toBe('default mode text')
  })

  it('跨用户:user B 不能读 user A 的 asset', async () => {
    const { user: a } = await createLoggedInUser('cross-a@a.com')
    const { user: b } = await createLoggedInUser('cross-b@a.com')
    const id = await insertAsset(a.id, {
      mime: 'application/pdf',
      extractedText: 'secret',
      extractStatus: 'done',
    })
    const result = await runInRequest(
      { userId: b.id, sessionId: null, activeDeckId: null, turnId: null },
      () => runTool({ id, mode: 'text' }),
    )
    const json = JSON.parse(result)
    expect(json.success).toBe(false)
    expect(json.error).toMatch(/not found/)
  })
})
