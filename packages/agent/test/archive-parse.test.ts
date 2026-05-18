/**
 * Phase 15 Task 31-C:parseArchive 单测。
 *
 * 用真 jszip(不 mock library)+ 真 buildArchive 出 baseline 包,然后局部破坏验各 case。
 *
 * 覆盖:
 * - happy:buildArchive 出包 → parseArchive 还原 manifest / content / assets byte-equal
 * - schemaVersion = 99 → 'schema-unsupported'
 * - manifest 缺 deck.title → 'manifest-invalid'
 * - manifest assets 字段非数组 → 'manifest-invalid'
 * - asset 文件被删 → 'asset-missing'
 * - asset bytesSize 改大 → 'asset-corrupt'
 * - 非 zip Buffer(全 0xFF)→ 'not-a-zip'
 * - 损坏 zip(PK 头但内容截断) → 'not-a-zip'
 * - manifest.json 缺失 → 'manifest-missing'
 * - manifest.json 非合法 JSON → 'manifest-invalid'
 * - content.md 缺失 → 'content-missing'
 * - asset id 不是 uuid 形状 → 'manifest-invalid'
 */
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { CURRENT_SCHEMA_VERSION, type ArchiveManifest } from '@big-ppt/shared'
import { parseArchive } from '../src/archive/parse-archive.js'
import { ArchiveError } from '../src/archive/errors.js'
import { buildArchive } from '../src/archive/build-archive.js'
import { createAsset } from '../src/db/deck-assets.js'
import { useTestDb } from './_setup/test-db.js'
import { createTestUser, createDeckDirect } from './_setup/factories.js'

useTestDb()

function fakePng(seed: number): Buffer {
  const buf = Buffer.alloc(512)
  for (let i = 0; i < buf.length; i++) buf[i] = (i + seed) & 0xff
  return buf
}

/**
 * 用 buildArchive 出真包(走 DB),解开后允许 caller 改 manifest / 删文件,
 * 重新 generateAsync 出新 buffer。返回 [originalBuf, mutate(fn) -> Promise<Buffer>]。
 */
async function makeRealArchiveBuffer(): Promise<{
  buffer: Buffer
  deckId: number
  userId: number
  asset1Id: string
  asset2Id: string
  png1: Buffer
  png2: Buffer
}> {
  const { user } = await createTestUser(`parse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@a.com`)
  const content = '---\ntitle: x\n---\n\n# slide one\n\n---\n\n# slide two'
  const { deck } = await createDeckDirect(user.id, 'Parse Test Deck', content)
  const png1 = fakePng(7)
  const png2 = fakePng(11)
  const { id: asset1Id } = await createAsset({
    deckId: deck.id,
    userId: user.id,
    mimeType: 'image/png',
    data: png1,
    prompt: 'a',
    model: 'm',
  })
  const { id: asset2Id } = await createAsset({
    deckId: deck.id,
    userId: user.id,
    mimeType: 'image/jpeg',
    data: png2,
  })
  const buffer = await buildArchive({ deckId: deck.id, userId: user.id })
  return { buffer, deckId: deck.id, userId: user.id, asset1Id, asset2Id, png1, png2 }
}

/** 解包 → 应用 mutate(可改 manifest / 删文件)→ 重新生成 zip Buffer。 */
async function mutateZip(
  buffer: Buffer,
  mutate: (zip: JSZip, manifest: ArchiveManifest) => void | Promise<void>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer)
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as ArchiveManifest
  await mutate(zip, manifest)
  // 写回 manifest 内存改动(caller 直接改 manifest 对象时也会通过这一步落字段)
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
}

describe('parseArchive', () => {
  it('happy:buildArchive → parseArchive 还原 manifest / content / assets 字节全对', async () => {
    const { buffer, asset1Id, asset2Id, png1, png2 } = await makeRealArchiveBuffer()
    const parsed = await parseArchive(buffer)

    expect(parsed.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(parsed.manifest.deck.title).toBe('Parse Test Deck')
    expect(parsed.manifest.assets).toHaveLength(2)
    expect(parsed.content).toBe('---\ntitle: x\n---\n\n# slide one\n\n---\n\n# slide two')

    expect(parsed.assets.size).toBe(2)
    const got1 = parsed.assets.get(asset1Id)
    const got2 = parsed.assets.get(asset2Id)
    expect(got1).toBeDefined()
    expect(got2).toBeDefined()
    expect(got1!.equals(png1)).toBe(true)
    expect(got2!.equals(png2)).toBe(true)
  })

  it('schemaVersion = 99 → schema-unsupported(message 含 99 + 不被支持)', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await mutateZip(buffer, (_, m) => {
      ;(m as ArchiveManifest & { schemaVersion: number }).schemaVersion = 99
    })
    try {
      await parseArchive(bad)
      expect.fail('应抛 ArchiveError')
    } catch (e) {
      expect(e).toBeInstanceOf(ArchiveError)
      expect((e as ArchiveError).code).toBe('schema-unsupported')
      expect((e as ArchiveError).userMessage).toContain('99')
      expect((e as ArchiveError).userMessage).toContain('不被当前 Lumideck 支持')
    }
  })

  it('manifest 缺 deck.title → manifest-invalid', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await mutateZip(buffer, (_, m) => {
      // @ts-expect-error 故意删字段验校验
      delete m.deck.title
    })
    try {
      await parseArchive(bad)
      expect.fail('应抛 ArchiveError')
    } catch (e) {
      expect(e).toBeInstanceOf(ArchiveError)
      expect((e as ArchiveError).code).toBe('manifest-invalid')
    }
  })

  it('manifest assets 字段非数组 → manifest-invalid', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await mutateZip(buffer, (_, m) => {
      ;(m as unknown as { assets: unknown }).assets = 'oops'
    })
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'manifest-invalid' })
  })

  it('asset 文件被删 → asset-missing', async () => {
    const { buffer, asset1Id } = await makeRealArchiveBuffer()
    const bad = await mutateZip(buffer, (zip) => {
      zip.remove(`assets/${asset1Id}.png`)
    })
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'asset-missing' })
  })

  it('asset bytesSize 改大 → asset-corrupt', async () => {
    const { buffer, asset1Id } = await makeRealArchiveBuffer()
    const bad = await mutateZip(buffer, (_, m) => {
      const target = m.assets.find((a) => a.id === asset1Id)
      if (target) target.bytesSize = 99999
    })
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'asset-corrupt' })
  })

  it('非 zip Buffer(全 0xFF)→ not-a-zip', async () => {
    const garbage = Buffer.alloc(512, 0xff)
    await expect(parseArchive(garbage)).rejects.toMatchObject({ code: 'not-a-zip' })
  })

  it('损坏 zip(PK 头但内容截断)→ not-a-zip', async () => {
    // 头 4 字节是合法 zip magic,后面全是 0,jszip loadAsync 会失败
    const broken = Buffer.alloc(64)
    broken[0] = 0x50
    broken[1] = 0x4b
    broken[2] = 0x03
    broken[3] = 0x04
    await expect(parseArchive(broken)).rejects.toMatchObject({ code: 'not-a-zip' })
  })

  it('manifest.json 缺失 → manifest-missing', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await (async () => {
      const zip = await JSZip.loadAsync(buffer)
      zip.remove('manifest.json')
      return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
    })()
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'manifest-missing' })
  })

  it('manifest.json 非合法 JSON → manifest-invalid', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await (async () => {
      const zip = await JSZip.loadAsync(buffer)
      zip.file('manifest.json', '{ not valid json')
      return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
    })()
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'manifest-invalid' })
  })

  it('content.md 缺失 → content-missing', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await (async () => {
      const zip = await JSZip.loadAsync(buffer)
      zip.remove('content.md')
      return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' })
    })()
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'content-missing' })
  })

  it('asset id 不是 uuid 形状 → manifest-invalid', async () => {
    const { buffer } = await makeRealArchiveBuffer()
    const bad = await mutateZip(buffer, (_, m) => {
      m.assets[0]!.id = 'not-a-uuid'
    })
    await expect(parseArchive(bad)).rejects.toMatchObject({ code: 'manifest-invalid' })
  })
})
