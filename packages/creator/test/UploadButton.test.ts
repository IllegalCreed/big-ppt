/** Phase 13 Task F:UploadButton 组件测(点击 / change / drop / 错误传播)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import UploadButton from '../src/components/UploadButton.vue'

const originalFetch = globalThis.fetch

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function asset(over: Partial<{ id: string; filename: string; sizeBytes: number }> = {}) {
  return {
    asset: {
      id: over.id ?? 'a1',
      filename: over.filename ?? 'x.pdf',
      mime: 'application/pdf',
      sizeBytes: over.sizeBytes ?? 100,
      extractStatus: 'pending' as const,
      uploadedAt: '2026-05-16T00:00:00Z',
    },
    quota: { usedBytes: over.sizeBytes ?? 100, limitBytes: 100 * 1024 * 1024 },
  }
}

describe('UploadButton', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('渲染按钮 + 隐藏 file input(multiple + accept 列表覆盖核心 mime)', () => {
    const wrapper = mount(UploadButton)
    const btn = wrapper.find('button.upload-button')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toBe('上传文件')

    const input = wrapper.find('input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('multiple')).toBeDefined()
    expect(input.attributes('accept')).toContain('application/pdf')
    expect(input.attributes('accept')).toContain('image/png')
    expect(input.attributes('accept')).toContain('text/csv')
  })

  it('点击 button 触发隐藏 input.click()', async () => {
    const wrapper = mount(UploadButton, { attachTo: document.body })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    const spy = vi.spyOn(input, 'click').mockImplementation(() => {})

    await wrapper.find('button.upload-button').trigger('click')
    expect(spy).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('change 事件:挑文件 → 调 fetch 上传 → emit uploaded + quota-update', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, asset({ filename: 'doc.pdf', sizeBytes: 5000 })))
    const wrapper = mount(UploadButton, { attachTo: document.body })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    const file = new File(['hello'], 'doc.pdf', { type: 'application/pdf' })

    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => ({
        0: file,
        length: 1,
        item: (i: number) => (i === 0 ? file : null),
        [Symbol.iterator]: function* () {
          yield file
        },
      }),
    })
    await wrapper.find('input[type="file"]').trigger('change')
    await flushPromises()

    const uploaded = wrapper.emitted('uploaded')
    expect(uploaded).toBeTruthy()
    expect((uploaded![0][0] as { filename: string }).filename).toBe('doc.pdf')
    const quota = wrapper.emitted('quota-update')
    expect(quota).toBeTruthy()
    expect((quota![0][0] as { limitBytes: number }).limitBytes).toBe(100 * 1024 * 1024)
    wrapper.unmount()
  })

  it('drop 事件:走同样上传路径,emit uploaded;dragover preventDefault', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, asset({ filename: 'pic.png' })))
    const wrapper = mount(UploadButton, { attachTo: document.body })
    const file = new File(['x'], 'pic.png', { type: 'image/png' })
    const btn = wrapper.find('button.upload-button')

    // dragover preventDefault
    const dragEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dragEvent, 'preventDefault', { value: vi.fn() })
    btn.element.dispatchEvent(dragEvent)
    expect((dragEvent.preventDefault as ReturnType<typeof vi.fn>)).toHaveBeenCalled()

    // drop
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(dropEvent, 'preventDefault', { value: vi.fn() })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: {
          0: file,
          length: 1,
          item: (i: number) => (i === 0 ? file : null),
          [Symbol.iterator]: function* () {
            yield file
          },
        },
      },
    })
    btn.element.dispatchEvent(dropEvent)
    await flushPromises()

    expect((dropEvent.preventDefault as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    const uploaded = wrapper.emitted('uploaded')
    expect(uploaded).toBeTruthy()
    expect((uploaded![0][0] as { filename: string }).filename).toBe('pic.png')
    wrapper.unmount()
  })

  it('上传错:emit error(server 给的 message)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(413, { error: { code: 'TOO_LARGE', message: '文件超 10MB' } }),
    )
    const wrapper = mount(UploadButton, { attachTo: document.body })
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement
    const file = new File(['x'.repeat(100)], 'big.pdf', { type: 'application/pdf' })

    Object.defineProperty(input, 'files', {
      configurable: true,
      get: () => ({
        0: file,
        length: 1,
        item: () => file,
        [Symbol.iterator]: function* () {
          yield file
        },
      }),
    })
    await wrapper.find('input[type="file"]').trigger('change')
    await flushPromises()

    const errEvent = wrapper.emitted('error')
    expect(errEvent).toBeTruthy()
    expect(errEvent![0][0]).toBe('文件超 10MB')
    expect(wrapper.emitted('uploaded')).toBeUndefined()
    wrapper.unmount()
  })
})
