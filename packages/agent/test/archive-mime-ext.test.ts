/**
 * Phase 15 Task A:mimeToExt 映射表测试。
 */
import { describe, expect, it } from 'vitest'
import { mimeToExt } from '../src/archive/mime-ext.js'

describe('archive/mime-ext', () => {
  it('image/png → png', () => {
    expect(mimeToExt('image/png')).toBe('png')
  })

  it('image/jpeg → jpg', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg')
  })

  it('image/webp → webp', () => {
    expect(mimeToExt('image/webp')).toBe('webp')
  })

  it('image/gif → gif', () => {
    expect(mimeToExt('image/gif')).toBe('gif')
  })

  it('大小写混合(Image/PNG)正确归一到 png', () => {
    expect(mimeToExt('Image/PNG')).toBe('png')
  })

  it('未知 MIME → bin fallback', () => {
    expect(mimeToExt('application/octet-stream')).toBe('bin')
    expect(mimeToExt('video/mp4')).toBe('bin')
    expect(mimeToExt('')).toBe('bin')
  })
})
