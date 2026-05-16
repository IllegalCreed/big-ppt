/** Phase 13 Task F:AssetManagerPanel 抽屉(列表 / 空态 / 容量条 / 删除流程)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AssetManagerPanel from '../src/components/AssetManagerPanel.vue'

const originalFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function $(sel: string): HTMLElement | null {
  return document.body.querySelector(sel) as HTMLElement | null
}

function $all(sel: string): HTMLElement[] {
  return Array.from(document.body.querySelectorAll(sel)) as HTMLElement[]
}

const MB = 1024 * 1024

const FIXTURE_ASSETS = [
  {
    id: 'a',
    filename: 'spec.pdf',
    mime: 'application/pdf',
    sizeBytes: 2 * MB,
    extractStatus: 'done' as const,
    uploadedAt: '2026-05-16T08:00:00Z',
  },
  {
    id: 'b',
    filename: 'data.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 5 * 1024,
    extractStatus: 'pending' as const,
    uploadedAt: '2026-05-16T07:00:00Z',
  },
  {
    id: 'c',
    filename: 'cover.png',
    mime: 'image/png',
    sizeBytes: 800 * 1024,
    extractStatus: 'skipped' as const,
    uploadedAt: '2026-05-16T06:00:00Z',
  },
]

describe('AssetManagerPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    document.body.replaceChildren()
  })

  it('open=true 触发 listAssets:空态时显示「还没上传任何素材」', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { assets: [], quota: { usedBytes: 0, limitBytes: 100 * MB } }),
    )
    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    expect(document.body.textContent).toContain('还没上传任何素材')
    expect($('.asset-list')).toBe(null)
    wrapper.unmount()
  })

  it('3 资产渲染:filename / size 格式化 / extractStatus badge 文案', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        assets: FIXTURE_ASSETS,
        quota: { usedBytes: 2 * MB + 5 * 1024 + 800 * 1024, limitBytes: 100 * MB },
      }),
    )
    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    const rows = $all('.asset-row')
    expect(rows).toHaveLength(3)
    const names = $all('.asset-name').map((n) => n.textContent?.trim())
    expect(names).toEqual(['spec.pdf', 'data.xlsx', 'cover.png'])

    // status badge:done → 已解析, pending → 排队中, skipped → 图片(直读)
    expect(document.body.textContent).toContain('已解析')
    expect(document.body.textContent).toContain('排队中')
    expect(document.body.textContent).toContain('图片(直读)')

    // size 格式化:2MB / 5.0KB / 800KB(800 * 1024 = 819200 < 1024*1024)
    const sizes = $all('.asset-size').map((n) => n.textContent?.trim())
    expect(sizes).toEqual(['2.00MB', '5.0KB', '800.0KB'])
    wrapper.unmount()
  })

  it('容量条 width 反映 usedBytes / limitBytes;低于 90% 无警告 class', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        assets: [],
        quota: { usedBytes: 50 * MB, limitBytes: 100 * MB },
      }),
    )
    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    const fill = $('[data-testid="quota-bar-fill"]') as HTMLElement
    expect(fill).not.toBe(null)
    expect(fill.style.width).toBe('50%')
    expect(fill.classList.contains('fill-warning')).toBe(false)
    expect($('.quota-warning-text')).toBe(null)
    wrapper.unmount()
  })

  it('容量 > 90% 加 fill-warning + 红色警告文案', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        assets: [],
        quota: { usedBytes: 95 * MB, limitBytes: 100 * MB },
      }),
    )
    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    const fill = $('[data-testid="quota-bar-fill"]') as HTMLElement
    expect(fill.classList.contains('fill-warning')).toBe(true)
    expect($('.quota-warning-text')).not.toBe(null)
    expect(document.body.textContent).toContain('容量即将用尽')
    wrapper.unmount()
  })

  it('删除流程:点删除 → 二次确认 → DELETE 成功 → 列表去掉 + quota 更新', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          assets: FIXTURE_ASSETS.slice(0, 2),
          quota: { usedBytes: 2 * MB + 5 * 1024, limitBytes: 100 * MB },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { quota: { usedBytes: 5 * 1024, limitBytes: 100 * MB } }),
      )

    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    expect($all('.asset-row')).toHaveLength(2)

    // 点第一行的删除按钮 → 出现二次确认
    const deleteBtn = $('button[aria-label="删除 spec.pdf"]')!
    deleteBtn.click()
    await flushPromises()
    const confirmBtn = $all('button').find((b) => b.textContent?.trim() === '确认删除')!
    expect(confirmBtn).toBeTruthy()

    confirmBtn.click()
    await flushPromises()

    expect($all('.asset-row')).toHaveLength(1)
    const remainingName = $('.asset-name')!.textContent?.trim()
    expect(remainingName).toBe('data.xlsx')
    // 容量条更新:5KB / 100MB ≈ 0%
    const fill = $('[data-testid="quota-bar-fill"]') as HTMLElement
    expect(fill.style.width.startsWith('0')).toBe(true)

    // 第二次 fetch 是 DELETE
    const delCall = fetchMock.mock.calls[1]
    expect(delCall[0]).toBe('/api/uploads/a')
    expect((delCall[1] as RequestInit).method).toBe('DELETE')
    wrapper.unmount()
  })

  it('删除取消:点删除 → 取消 → 行仍在 + 无 DELETE 请求', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        assets: FIXTURE_ASSETS.slice(0, 1),
        quota: { usedBytes: 2 * MB, limitBytes: 100 * MB },
      }),
    )
    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    $('button[aria-label="删除 spec.pdf"]')!.click()
    await flushPromises()
    const cancelBtn = $all('button').find((b) => b.textContent?.trim() === '取消')!
    cancelBtn.click()
    await flushPromises()

    // 行还在
    expect($all('.asset-row')).toHaveLength(1)
    // 仅 1 次 fetch(初始 listAssets),没有 DELETE
    expect(fetchMock.mock.calls).toHaveLength(1)
    wrapper.unmount()
  })

  it('点 X 关闭按钮:emit update:open=false', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { assets: [], quota: { usedBytes: 0, limitBytes: 100 * MB } }),
    )
    const wrapper = mount(AssetManagerPanel, { props: { open: true } })
    await flushPromises()

    const closeBtn = $('button[aria-label="关闭"]')!
    closeBtn.click()
    await flushPromises()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })
})
