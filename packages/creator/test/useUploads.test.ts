/** Phase 13 Task F:useUploads API client composable 单测。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUploads } from '../src/composables/useUploads'

type FetchMock = ReturnType<typeof vi.fn>

const originalFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('useUploads', () => {
  let fetchMock: FetchMock

  beforeEach(() => {
    fetchMock = vi.fn() as FetchMock
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('uploadFile happy path:返回 {asset, quota} 且带 FormData 发到 /api/uploads', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        asset: {
          id: 'a1',
          filename: 'x.pdf',
          mime: 'application/pdf',
          sizeBytes: 1024,
          extractStatus: 'pending',
          uploadedAt: '2026-05-16T00:00:00Z',
        },
        quota: { usedBytes: 1024, limitBytes: 100 * 1024 * 1024 },
      }),
    )
    const { uploadFile } = useUploads()
    const file = new File(['hello world'], 'x.pdf', { type: 'application/pdf' })

    const out = await uploadFile(file)

    expect(out.asset.id).toBe('a1')
    expect(out.asset.filename).toBe('x.pdf')
    expect(out.quota.usedBytes).toBe(1024)
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('/api/uploads')
    expect((call[1] as RequestInit).method).toBe('POST')
    expect((call[1] as RequestInit).credentials).toBe('include')
    expect((call[1] as RequestInit).body).toBeInstanceOf(FormData)
  })

  it('uploadFile 413 quota 错:抛出 server 给的 message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(413, {
        error: { code: 'QUOTA_EXCEEDED', message: '超出 100MB 用户配额' },
      }),
    )
    const { uploadFile } = useUploads()
    const file = new File(['x'], 'big.pdf', { type: 'application/pdf' })

    await expect(uploadFile(file)).rejects.toThrow('超出 100MB 用户配额')
  })

  it('uploadFile uploading ref:发起前 true,resolve 后 false', async () => {
    let resolveFn: (v: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolveFn = r)))
    const { uploadFile, uploading } = useUploads()
    expect(uploading.value).toBe(false)

    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    const p = uploadFile(file)
    expect(uploading.value).toBe(true)

    resolveFn(
      jsonResponse(200, {
        asset: {
          id: 'a',
          filename: 'a.pdf',
          mime: 'application/pdf',
          sizeBytes: 1,
          extractStatus: 'pending',
          uploadedAt: '2026-05-16T00:00:00Z',
        },
        quota: { usedBytes: 1, limitBytes: 100 * 1024 * 1024 },
      }),
    )
    await p
    expect(uploading.value).toBe(false)
  })

  it('listAssets:GET /api/uploads 返 {assets, quota} 形状', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        assets: [
          {
            id: 'a',
            filename: 'a.pdf',
            mime: 'application/pdf',
            sizeBytes: 100,
            extractStatus: 'done',
            uploadedAt: '2026-05-16T00:00:00Z',
          },
        ],
        quota: { usedBytes: 100, limitBytes: 100 * 1024 * 1024 },
      }),
    )
    const { listAssets } = useUploads()
    const out = await listAssets()
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0].filename).toBe('a.pdf')
    expect(out.quota.usedBytes).toBe(100)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/uploads')
  })

  it('listAssets 错:抛出 HTTP 状态信息', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'oops' }))
    const { listAssets } = useUploads()
    await expect(listAssets()).rejects.toThrow('列出素材失败:HTTP 500')
  })

  it('deleteAsset:DELETE /api/uploads/:id 返新 quota', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { quota: { usedBytes: 50, limitBytes: 100 * 1024 * 1024 } }),
    )
    const { deleteAsset } = useUploads()
    const q = await deleteAsset('xyz123')
    expect(q.usedBytes).toBe(50)
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('/api/uploads/xyz123')
    expect((call[1] as RequestInit).method).toBe('DELETE')
  })

  it('deleteAsset 错:用 server message;无 message 用 fallback', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { message: '素材不存在' } }))
    const { deleteAsset } = useUploads()
    await expect(deleteAsset('nope')).rejects.toThrow('素材不存在')
  })
})
