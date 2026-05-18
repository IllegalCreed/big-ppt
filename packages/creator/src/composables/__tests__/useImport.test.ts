/**
 * Phase 15 Task 31-E:useImport composable 单测。
 *
 * mock globalThis.fetch:不打真后端,只验:
 * - happy path:fetch URL + FormData(file 字段)正确 + return body 透传
 * - 400 schema 错(backend `code:'manifest-invalid'`):error.value set + throw
 * - 413 oversized:error.value set + throw
 * - 网络错(fetch reject):throw 透传 + finally importing 复位 false
 *
 * 不引入 Vue Test Utils:composable 只用 ref,顶层 import + 同步 mock 即可。
 *
 * vitest 4 顶层 vi.mock 不必要(useImport 不 mock 其他模块);fetch 走 globalThis
 * 重写,beforeEach reset,afterEach delete。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useImport } from '../useImport'

/**
 * jsdom 的 Blob 不实现 .stream(),用真 Response 会 break;duck-typed fake Response
 * (跟 useExport.test.ts 的 fakeResponse 同套路)。
 */
function fakeResponse(opts: {
  ok: boolean
  status: number
  body?: unknown
  jsonThrows?: boolean
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    json: async () => {
      if (opts.jsonThrows) throw new Error('not-json')
      return opts.body ?? {}
    },
  } as unknown as Response
}

function makeFile(name = 'a.lumideck', content = 'fake-zip-bytes'): File {
  return new File([content], name, { type: 'application/zip' })
}

describe('useImport', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    delete (globalThis as unknown as { fetch?: typeof fetch }).fetch
  })

  it('happy path:fetch /api/decks/import + FormData.file + 返 { deckId, title }', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: true, status: 201, body: { deckId: 7, title: 'X(导入)' } }),
    )

    const { importArchive, importing, error } = useImport()
    expect(importing.value).toBe(false)
    expect(error.value).toBeNull()

    const file = makeFile()
    const result = await importArchive(file)

    expect(result).toEqual({ deckId: 7, title: 'X(导入)' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/decks/import')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).credentials).toBe('include')
    // FormData 内字段名 = 'file'
    const form = (init as RequestInit).body as FormData
    expect(form).toBeInstanceOf(FormData)
    const got = form.get('file')
    expect(got).toBeInstanceOf(File)
    expect((got as File).name).toBe('a.lumideck')

    // finally 后 importing 复位
    expect(importing.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('400 schema 错(backend code:manifest-invalid)→ error.value set + throw', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 400,
        body: { error: '数据包版本 99 不被支持', code: 'manifest-invalid' },
      }),
    )

    const { importArchive, importing, error } = useImport()

    await expect(importArchive(makeFile())).rejects.toThrow('数据包版本 99 不被支持')
    expect(error.value).toBe('数据包版本 99 不被支持')
    expect(importing.value).toBe(false)
  })

  it('413 oversized → error.value set + throw', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({
        ok: false,
        status: 413,
        body: { error: '数据包超过 100MB 上限' },
      }),
    )

    const { importArchive, error, importing } = useImport()

    await expect(importArchive(makeFile())).rejects.toThrow('数据包超过 100MB 上限')
    expect(error.value).toBe('数据包超过 100MB 上限')
    expect(importing.value).toBe(false)
  })

  it('非 JSON 错误 body:走 status 码兜底', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 502, jsonThrows: true }),
    )

    const { importArchive, error } = useImport()

    await expect(importArchive(makeFile())).rejects.toThrow(/导入失败 502/)
    expect(error.value).toMatch(/导入失败 502/)
  })

  it('网络错(fetch reject):throw 透传 + finally 复位 importing=false', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const { importArchive, importing } = useImport()

    await expect(importArchive(makeFile())).rejects.toThrow('network down')
    // fetch 直接 reject 时,error.value 不被 set(只有 !ok 路径 set);
    // 但 finally 必须复位 importing,不然 UI 永远 disabled
    expect(importing.value).toBe(false)
  })

  it('error.value 状态在两次调用间被清:第二次调用 reset 第一次的 error', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: false, status: 400, body: { error: 'first' } }),
    )
    fetchMock.mockResolvedValueOnce(
      fakeResponse({ ok: true, status: 201, body: { deckId: 2, title: 'Y(导入)' } }),
    )

    const { importArchive, error } = useImport()

    await expect(importArchive(makeFile())).rejects.toThrow('first')
    expect(error.value).toBe('first')

    await importArchive(makeFile())
    expect(error.value).toBeNull()
  })
})
