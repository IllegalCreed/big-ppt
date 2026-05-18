/**
 * Phase 14 Task B：pngsToPptx 单测。
 *
 * 用真 pptxgenjs（jsdom env 跑得通），喂 1×1 fake PNG，断产物 zip 结构：
 * - 用 jszip 解压 blob，检查 PPTX 标准结构：
 *   - `ppt/presentation.xml`（presentation 根定义）
 *   - `ppt/slides/slide1.xml` ... `slideN.xml`（每页一个）
 * - 不深入 XML 内容（让 PowerPoint 自己消化背景图位置）；结构性断言即可
 *
 * jsdom 抉择：pptxgenjs 4.x 内部用 JSZip 序列化，不依赖真浏览器 canvas /
 * dom API；`write({ outputType: 'blob' })` 在 jsdom 下返合法 Blob，无需切
 * nodebuffer。verified by 本测跑通。
 */
import { describe, expect, it } from 'vitest'
import { Buffer } from 'buffer'
import JSZip from 'jszip'
import { pngsToPptx } from '../to-pptx'

/** 1×1 透明 PNG */
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function makeFakePng(): Buffer {
  return Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64')
}

describe('pngsToPptx', () => {
  it('N=3 页 → 返 Blob，zip 内含 presentation.xml + slide1/2/3.xml', async () => {
    const blob = await pngsToPptx([makeFakePng(), makeFakePng(), makeFakePng()])
    expect(blob).toBeInstanceOf(Blob)

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('ppt/presentation.xml')).not.toBeNull()
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull()
    expect(zip.file('ppt/slides/slide2.xml')).not.toBeNull()
    expect(zip.file('ppt/slides/slide3.xml')).not.toBeNull()
    // 第 4 页不应存在
    expect(zip.file('ppt/slides/slide4.xml')).toBeNull()
  })

  it('N=1 页 → 仅 slide1.xml', async () => {
    const blob = await pngsToPptx([makeFakePng()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(zip.file('ppt/slides/slide1.xml')).not.toBeNull()
    expect(zip.file('ppt/slides/slide2.xml')).toBeNull()
  })

  it('N=2 页：2 张独立 PNG media（pptxgenjs 背景图不 dedup，命名 Slide-N-image-1.png）', async () => {
    // 实测 pptxgenjs 4.x 即便输入相同 PNG buffer 也每页一个独立 media entry
    // （命名 `ppt/media/Slide-N-image-1.png`），所以 N 页 = N 张 media PNG。
    // 严格 === N 防 single-slide bug（少 push 一张）被 lenient `>= 1` 漏掉。
    const blob = await pngsToPptx([makeFakePng(), makeFakePng()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const mediaFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith('ppt/media/') && name.endsWith('.png'),
    )
    expect(mediaFiles.length).toBe(2)
  })

  it('N=3 页：3 张独立 PNG media', async () => {
    const blob = await pngsToPptx([makeFakePng(), makeFakePng(), makeFakePng()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const mediaFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith('ppt/media/') && name.endsWith('.png'),
    )
    expect(mediaFiles.length).toBe(3)
  })

  it('zip Content-Types.xml 声明 PPTX type（结构合法性兜底）', async () => {
    const blob = await pngsToPptx([makeFakePng()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const ctFile = zip.file('[Content_Types].xml')
    expect(ctFile).not.toBeNull()
    const xml = await ctFile!.async('string')
    // PPTX 标准 content type
    expect(xml).toContain('presentationml')
  })
})
