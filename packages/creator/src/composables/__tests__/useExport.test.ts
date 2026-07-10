/**
 * Phase 14 Task C:useExport composable 单测。
 *
 * 全 mock capture-pages + 三个 converter + triggerDownload:不关心真截图 / PDF
 * 生成(那是 Task A/B 单测的职责),只验编排流:
 * - happy path 调用顺序 + filename 清理 + ext 跟 format 对齐
 * - error path:capture-pages 抛 / converter 抛 → error.value 设值 + re-throw
 * - totalPages === 0 guard 立即 throw,不调 capture-pages
 * - progress 在 capture-pages onProgress 期间更新
 * - exporting/progress 在 finally 复位
 *
 * 动态加载边界统一 mock lazy-export 模块，测试仍保持顶层 vi.mock + static import，
 * 避开 Vitest 4 多次 dynamic import mock 不稳定的问题。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// ── mocks ────────────────────────────────────────────────────────────────
const capturePagesMock = vi.fn()
const pngsToPdfMock = vi.fn()
const pngsToPptxMock = vi.fn()
const pngsToZipMock = vi.fn()
vi.mock('../../export/lazy-export', () => ({
  capturePagesLazy: (opts: unknown) => capturePagesMock(opts),
  pngsToPdfLazy: (pngs: unknown) => pngsToPdfMock(pngs),
  pngsToPptxLazy: (pngs: unknown) => pngsToPptxMock(pngs),
  pngsToZipLazy: (pngs: unknown) => pngsToZipMock(pngs),
}))

const triggerDownloadMock = vi.fn()
vi.mock('../../export/download', () => ({
  triggerDownload: (blob: Blob, filename: string) => triggerDownloadMock(blob, filename),
}))

// ── import 被测体(mock 已就位)──────────────────────────────────────────
import { useExport, type ExportDeckPayload } from '../useExport'

function makeFakePng(): Buffer {
  // 仅作 fake 返回值用,真实字节不重要
  return Buffer.from([0x89, 0x50, 0x4e, 0x47])
}

function makeDeck(over: Partial<ExportDeckPayload> = {}): ExportDeckPayload {
  return {
    id: 42,
    title: 'My Test Deck',
    markdown: '# slide 1\n---\n# slide 2',
    templateId: 'beitou-standard',
    totalPages: 3,
    ...over,
  }
}

describe('useExport', () => {
  beforeEach(() => {
    capturePagesMock.mockReset()
    pngsToPdfMock.mockReset()
    pngsToPptxMock.mockReset()
    pngsToZipMock.mockReset()
    triggerDownloadMock.mockReset()

    capturePagesMock.mockResolvedValue([makeFakePng(), makeFakePng(), makeFakePng()])
    pngsToPdfMock.mockResolvedValue(new Blob(['fake-pdf'], { type: 'application/pdf' }))
    pngsToPptxMock.mockResolvedValue(
      new Blob(['fake-pptx'], {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    )
    pngsToZipMock.mockResolvedValue(new Blob(['fake-zip'], { type: 'application/zip' }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('happy path PDF:capturePages → pngsToPdf → triggerDownload (filename ext = pdf)', async () => {
    const { exportDeck, exporting } = useExport()
    expect(exporting.value).toBe(false)

    await exportDeck(makeDeck(), 'pdf')

    expect(capturePagesMock).toHaveBeenCalledTimes(1)
    expect(capturePagesMock.mock.calls[0]![0]).toMatchObject({
      deckId: 42,
      markdown: '# slide 1\n---\n# slide 2',
      templateId: 'beitou-standard',
      totalPages: 3,
    })
    expect(pngsToPdfMock).toHaveBeenCalledTimes(1)
    expect(pngsToPptxMock).not.toHaveBeenCalled()
    expect(pngsToZipMock).not.toHaveBeenCalled()
    expect(triggerDownloadMock).toHaveBeenCalledTimes(1)
    const [blob, filename] = triggerDownloadMock.mock.calls[0]!
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toMatch(/^My Test Deck-\d+\.pdf$/)

    // 状态复位
    expect(exporting.value).toBe(false)
  })

  it('happy path PPTX:走 pngsToPptx + filename ext = pptx', async () => {
    const { exportDeck } = useExport()
    await exportDeck(makeDeck(), 'pptx')

    expect(pngsToPptxMock).toHaveBeenCalledTimes(1)
    expect(pngsToPdfMock).not.toHaveBeenCalled()
    expect(triggerDownloadMock.mock.calls[0]![1]).toMatch(/\.pptx$/)
  })

  it('happy path PNG-zip:走 pngsToZip + filename ext = zip', async () => {
    const { exportDeck } = useExport()
    await exportDeck(makeDeck(), 'png-zip')

    expect(pngsToZipMock).toHaveBeenCalledTimes(1)
    expect(pngsToPdfMock).not.toHaveBeenCalled()
    expect(triggerDownloadMock.mock.calls[0]![1]).toMatch(/\.zip$/)
  })

  it('filename 清洗:`/ \\ : * ? " < > |` → 全部替成 _', async () => {
    const { exportDeck } = useExport()
    await exportDeck(makeDeck({ title: 'a/b\\c:d*e?f"g<h>i|j' }), 'pdf')

    const [, filename] = triggerDownloadMock.mock.calls[0]!
    expect(filename).toMatch(/^a_b_c_d_e_f_g_h_i_j-\d+\.pdf$/)
  })

  it('filename 清洗:中文 title 保留(不在保留字符集合里)', async () => {
    const { exportDeck } = useExport()
    await exportDeck(makeDeck({ title: '我的演示文稿' }), 'pdf')

    const [, filename] = triggerDownloadMock.mock.calls[0]!
    expect(filename).toMatch(/^我的演示文稿-\d+\.pdf$/)
  })

  it('totalPages === 0 → 立即 throw + 不调 capture-pages', async () => {
    const { exportDeck, error } = useExport()

    await expect(exportDeck(makeDeck({ totalPages: 0 }), 'pdf')).rejects.toThrow(
      'deck 无可导出页面',
    )

    expect(capturePagesMock).not.toHaveBeenCalled()
    expect(triggerDownloadMock).not.toHaveBeenCalled()
    expect(error.value).toBe('deck 无可导出页面')
  })

  it('capture-pages 抛 → error.value 设值 + 重 throw + 不调 converter / download', async () => {
    capturePagesMock.mockRejectedValueOnce(new Error('截图失败:fonts not ready'))
    const { exportDeck, error, exporting } = useExport()

    await expect(exportDeck(makeDeck(), 'pdf')).rejects.toThrow('截图失败:fonts not ready')

    expect(error.value).toBe('截图失败:fonts not ready')
    expect(pngsToPdfMock).not.toHaveBeenCalled()
    expect(triggerDownloadMock).not.toHaveBeenCalled()
    expect(exporting.value).toBe(false) // finally 复位
  })

  it('converter 抛(pngsToPdf 抛)→ error.value 设值 + 重 throw + 不调 download', async () => {
    pngsToPdfMock.mockRejectedValueOnce(new Error('jspdf 出错:超出内存'))
    const { exportDeck, error } = useExport()

    await expect(exportDeck(makeDeck(), 'pdf')).rejects.toThrow('jspdf 出错:超出内存')

    expect(capturePagesMock).toHaveBeenCalledTimes(1)
    expect(error.value).toBe('jspdf 出错:超出内存')
    expect(triggerDownloadMock).not.toHaveBeenCalled()
  })

  it('非 Error 类抛(throw "string") → error.value 用 String(e) 兜底', async () => {
    capturePagesMock.mockRejectedValueOnce('字符串 reject')
    const { exportDeck, error } = useExport()

    await expect(exportDeck(makeDeck(), 'pdf')).rejects.toBe('字符串 reject')
    expect(error.value).toBe('字符串 reject')
  })

  it('progress 在 onProgress 期间更新', async () => {
    const { exportDeck, progress } = useExport()
    const captured: Array<{ done: number; total: number }> = []
    capturePagesMock.mockImplementationOnce(
      async (opts: { onProgress?: (done: number, total: number) => void }) => {
        opts.onProgress?.(1, 3)
        captured.push({ ...progress.value! })
        opts.onProgress?.(2, 3)
        captured.push({ ...progress.value! })
        opts.onProgress?.(3, 3)
        captured.push({ ...progress.value! })
        return [makeFakePng(), makeFakePng(), makeFakePng()]
      },
    )

    await exportDeck(makeDeck(), 'pdf')

    expect(captured).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])
    // finally 后 progress 复位 null
    expect(progress.value).toBeNull()
  })

  it('exporting 在 capture 期间为 true', async () => {
    // 让 capturePages 卡住,我们 check exporting=true,再放行
    let release: () => void = () => {}
    capturePagesMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = () => res([makeFakePng()])
        }),
    )

    const { exportDeck, exporting } = useExport()
    const pending = exportDeck(makeDeck({ totalPages: 1 }), 'pdf')
    await nextTick()
    expect(exporting.value).toBe(true)

    release()
    await pending
    expect(exporting.value).toBe(false)
  })

  // ── Phase 15 Task D:lumideck 归档包分支 ────────────────────────────────
  describe('lumideck format', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    /**
     * jsdom 的 Blob 不实现 .stream(),用 `new Response(blob)` 会触发
     * "object.stream is not a function";改用 duck-typed fake Response,
     * 只提供 useExport 实际用到的 4 个成员:`ok` / `status` / `statusText`
     * / `blob()` / `text()`。
     */
    function fakeResponse(opts: {
      ok: boolean
      status: number
      statusText?: string
      blob?: Blob
      text?: string
    }): Response {
      return {
        ok: opts.ok,
        status: opts.status,
        statusText: opts.statusText ?? '',
        blob: async () => opts.blob ?? new Blob(['fake']),
        text: async () => opts.text ?? '',
      } as unknown as Response
    }

    beforeEach(() => {
      fetchMock = vi.fn()
      ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
        fetchMock as unknown as typeof fetch
    })

    afterEach(() => {
      // 复位 fetch:vitest 测试间隔离
      delete (globalThis as unknown as { fetch?: typeof fetch }).fetch
    })

    it('lumideck happy path:fetch /api/decks/:id/export-archive → triggerDownload(.lumideck)', async () => {
      const fakeBlob = new Blob(['fake-archive'], { type: 'application/zip' })
      fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, blob: fakeBlob }))

      const { exportDeck } = useExport()
      await exportDeck(makeDeck({ id: 99, title: 'Archive Test' }), 'lumideck')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/decks/99/export-archive')
      expect(init).toMatchObject({ credentials: 'include' })

      // capture-pages / converter 不应被调
      expect(capturePagesMock).not.toHaveBeenCalled()
      expect(pngsToPdfMock).not.toHaveBeenCalled()
      expect(pngsToPptxMock).not.toHaveBeenCalled()
      expect(pngsToZipMock).not.toHaveBeenCalled()

      // triggerDownload 收到 blob + .lumideck filename
      expect(triggerDownloadMock).toHaveBeenCalledTimes(1)
      const [blob, filename] = triggerDownloadMock.mock.calls[0]!
      expect(blob).toBe(fakeBlob)
      expect(filename).toMatch(/^Archive Test-\d+\.lumideck$/)
    })

    it('lumideck:totalPages=0 不抛(归档不需要 capture 链路 guard)', async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200 }))

      const { exportDeck, error } = useExport()
      // 空 deck 仍应成功
      await exportDeck(makeDeck({ totalPages: 0 }), 'lumideck')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(triggerDownloadMock).toHaveBeenCalledTimes(1)
      expect(error.value).toBeNull()
    })

    it('lumideck:fetch 返 401 → 抛错 + error.value 设值', async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: 'Unauthorized' }),
      )

      const { exportDeck, error, exporting } = useExport()
      await expect(exportDeck(makeDeck(), 'lumideck')).rejects.toThrow(/401/)

      expect(error.value).toMatch(/401/)
      expect(triggerDownloadMock).not.toHaveBeenCalled()
      expect(exporting.value).toBe(false) // finally 复位
    })

    it('lumideck:fetch 返 500 → 抛错', async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: 'Internal Server Error',
        }),
      )

      const { exportDeck, error } = useExport()
      await expect(exportDeck(makeDeck(), 'lumideck')).rejects.toThrow(/500/)
      expect(error.value).toMatch(/500/)
      expect(triggerDownloadMock).not.toHaveBeenCalled()
    })

    it('lumideck:filename title 走保留字符清洗', async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200 }))

      const { exportDeck } = useExport()
      await exportDeck(makeDeck({ title: 'a/b:c?' }), 'lumideck')

      const [, filename] = triggerDownloadMock.mock.calls[0]!
      expect(filename).toMatch(/^a_b_c_-\d+\.lumideck$/)
    })

    it('lumideck:progress 在 fetch 期间是 indeterminate sentinel {done:0,total:1}', async () => {
      // 卡住 fetch,检查 progress 状态
      let release: (resp: Response) => void = () => {}
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((res) => {
            release = res
          }),
      )

      const { exportDeck, progress, exporting } = useExport()
      const pending = exportDeck(makeDeck(), 'lumideck')
      await nextTick()

      expect(exporting.value).toBe(true)
      expect(progress.value).toEqual({ done: 0, total: 1 })

      release(fakeResponse({ ok: true, status: 200 }))
      await pending

      // 复位
      expect(exporting.value).toBe(false)
      expect(progress.value).toBeNull()
    })
  })
})
