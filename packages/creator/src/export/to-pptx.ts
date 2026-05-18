/**
 * Phase 14 Task B：PNG Buffer[] → 单个 PPTX blob。
 *
 * 输出契约：
 * - 16:9 layout（自定义 `16x9-960`：宽 10in × 高 5.625in，PPTX 单位是英寸）
 * - 每页一个 Slide，背景填整张 PNG（slide.background.data）
 * - 不内嵌任何文本 / 形状层 —— PPT 只是「截图集合」的容器，编辑还是回 Lumideck
 *
 * pptxgenjs 4.x API（types/index.d.ts 核实）：
 * - `pres.defineLayout({ name, width, height })`：定义 PresLayout（宽高单位 in）
 * - `pres.layout = '<name>'`：用上面定义的 layout name
 * - `pres.addSlide()` 返 Slide，`slide.background = { data: 'image/png;base64,...' }`
 *   注意：BackgroundProps.data 是 base64 字符串带 mime prefix（types/index.d.ts L893 example）
 * - `pres.write({ outputType: 'blob' })` 浏览器 / jsdom 下返 Blob，jsdom 单测可直接 await
 *   实测 pptxgenjs 不依赖真浏览器 DOM API（写 zip 用 JSZip 内部），jsdom env 跑得通
 */
import pptxgen from 'pptxgenjs'
import type { Buffer } from 'buffer'

/** 自定义 PPTX 16:9 layout 名（pptxgenjs 自带 LAYOUT_WIDE 是 13.33×7.5，跟 deck 960×540 比例对，但用自定义避免依赖 magic 字符串） */
const PPTX_LAYOUT_NAME = '16x9-960'
const PPTX_LAYOUT_W = 10 // inch
const PPTX_LAYOUT_H = 5.625 // inch，10 / (16/9)

export async function pngsToPptx(pngs: Buffer[]): Promise<Blob> {
  const pres = new pptxgen()
  pres.defineLayout({ name: PPTX_LAYOUT_NAME, width: PPTX_LAYOUT_W, height: PPTX_LAYOUT_H })
  pres.layout = PPTX_LAYOUT_NAME

  for (const png of pngs) {
    const slide = pres.addSlide()
    // background.data 必须带 `image/png;base64,` mime prefix（types/index.d.ts L893
    // example：'image/png;base64,iVtDaf...='）；纯 base64 字符串不被识别
    slide.background = {
      data: `image/png;base64,${png.toString('base64')}`,
    }
  }

  // write({ outputType: 'blob' }) 返回 Promise<Blob>（types overload 用 union 类型，
  // 显式 cast 为 Blob）
  return pres.write({ outputType: 'blob' }) as Promise<Blob>
}
