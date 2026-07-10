import { describe, expect, it } from 'vitest'
import { contentDisposition } from '../src/utils/content-disposition.js'

describe('contentDisposition', () => {
  it('emits ascii fallback plus UTF-8 filename*', () => {
    const header = contentDisposition('attachment', '幻光"deck".lumideck')

    expect(header).toContain('attachment; filename="___deck_.lumideck"')
    expect(header).toContain("filename*=UTF-8''%E5%B9%BB%E5%85%89%22deck%22.lumideck")
  })
})
