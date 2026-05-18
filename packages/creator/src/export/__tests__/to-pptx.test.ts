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

  it('每页背景嵌入一张图片资源（ppt/media/ 下应有 PNG）', async () => {
    const blob = await pngsToPptx([makeFakePng(), makeFakePng()])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    // ppt/media/ 下应有 PNG 资源；pptxgenjs 命名为 imageN.png（dedup 时会复用）
    const mediaFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith('ppt/media/') && name.endsWith('.png'),
    )
    // 至少 1 个图片资源（背景图）
    expect(mediaFiles.length).toBeGreaterThanOrEqual(1)
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
