/**
 * Phase 14 Task B：pngsToZip 单测。
 *
 * 用真 jszip，喂 fake PNG buffer，断 zip 结构：
 * - 文件命名 slide-01.png ... slide-NN.png 严格 2 位 zero-pad
 * - 文件数 = 输入 buffer 数
 * - 解压后内容字节与输入一致（STORE 压缩 = 原样存）
 * - zip magic bytes `PK\x03\x04` 开头
 */
import { describe, expect, it } from 'vitest'
import { Buffer } from 'buffer'
import JSZip from 'jszip'
import { pngsToZip } from '../to-png-zip'

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function makeFakePng(): Buffer {
  return Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64')
}

describe('pngsToZip', () => {
  it('N=3 页 → zip 含 slide-01.png slide-02.png slide-03.png', async () => {
    const blob = await pngsToZip([makeFakePng(), makeFakePng(), makeFakePng()])
    expect(blob).toBeInstanceOf(Blob)

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['slide-01.png', 'slide-02.png', 'slide-03.png'])
  })

  it('N=12 页 → 仍 2 位 zero-pad（slide-01 ... slide-12）', async () => {
    const pngs = Array.from({ length: 12 }, () => makeFakePng())
    const blob = await pngsToZip(pngs)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const names = Object.keys(zip.files).sort()
    expect(names).toHaveLength(12)
    expect(names[0]).toBe('slide-01.png')
    expect(names[11]).toBe('slide-12.png')
  })

  it('解压内容与输入字节完全一致（STORE 压缩不变形）', async () => {
    const png = makeFakePng()
    const blob = await pngsToZip([png])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const inner = await zip.file('slide-01.png')!.async('uint8array')
    expect(inner.length).toBe(png.length)
    // 字节级一致
    for (let i = 0; i < png.length; i++) {
      expect(inner[i]).toBe(png[i])
    }
  })

  it('zip magic bytes PK\\x03\\x04 开头', async () => {
    const blob = await pngsToZip([makeFakePng()])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(bytes[0]).toBe(0x50) // P
    expect(bytes[1]).toBe(0x4b) // K
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
  })

  it('N=1 页 → 仅 slide-01.png', async () => {
    const blob = await pngsToZip([makeFakePng()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(['slide-01.png'])
  })

  it('N=0 页 → 空 zip（仅 zip header，无 entry）', async () => {
    const blob = await pngsToZip([])
    expect(blob).toBeInstanceOf(Blob)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toHaveLength(0)
  })
})
