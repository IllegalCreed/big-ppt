/** Phase 13 Task F:UploadProgress chip 渲染契约。 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UploadProgress from '../src/components/UploadProgress.vue'

describe('UploadProgress', () => {
  it('uploading 默认 status:icon ↑ + filename + 格式化 size(KB)', () => {
    const w = mount(UploadProgress, { props: { filename: 'doc.pdf', sizeBytes: 2048 } })
    expect(w.find('.icon').text()).toBe('↑')
    expect(w.find('.filename').text()).toBe('doc.pdf')
    // 2048 bytes = 2.0KB
    expect(w.find('.size').text()).toBe('2.0KB')
    expect(w.classes()).toContain('upload-chip-uploading')
  })

  it('status=done:icon ✓ + done class', () => {
    const w = mount(UploadProgress, {
      props: { filename: 'a.pdf', sizeBytes: 1024 * 1024, status: 'done' },
    })
    expect(w.find('.icon').text()).toBe('✓')
    // 1MB → 1.00MB
    expect(w.find('.size').text()).toBe('1.00MB')
    expect(w.classes()).toContain('upload-chip-done')
  })

  it('status=error + errorMsg:icon ✕ + .error 文本 + tooltip', () => {
    const w = mount(UploadProgress, {
      props: {
        filename: 'big.pdf',
        sizeBytes: 500,
        status: 'error',
        errorMsg: '超出 10MB 单文件上限',
      },
    })
    expect(w.find('.icon').text()).toBe('✕')
    expect(w.classes()).toContain('upload-chip-error')
    const err = w.find('.error')
    expect(err.exists()).toBe(true)
    expect(err.text()).toBe('超出 10MB 单文件上限')
    expect(err.attributes('title')).toBe('超出 10MB 单文件上限')
    // 小 size 走 B 分支
    expect(w.find('.size').text()).toBe('500B')
  })
})
