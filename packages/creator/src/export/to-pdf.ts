/**
 * Phase 14 Task B：PNG Buffer[] → 单个 PDF blob。
 *
 * 输出契约：
 * - 16:9 PDF，每页 960×540 pt（landscape），跟 slide-canvas 960×540 px 1:1（pt
 *   是 PDF/PostScript 单位，渲染设备会缩到目标 DPI；Acrobat 默认每英寸 72pt =
 *   72px 维持视觉一致）
 * - PNG 直接以 dataUrl 形式嵌入（jsPDF.addImage 接受 `data:image/png;base64,`
 *   字符串），压缩走 'FAST'：PNG 本身已 deflate 过，FAST 跳过 PDF 二次压缩
 *   节省序列化耗时
 *
 * jsPDF 4.x API：
 * - 构造：`new jsPDF({ orientation, unit, format })`，4.x 跟 2.x 一致
 * - `addPage(format, orientation)`：第一页随构造自动建，后续手动 addPage
 * - `output('blob')`：返 Blob；types/index.d.ts L839 显式列出 'blob' overload
 */
import jsPDF from 'jspdf'
import type { Buffer } from 'buffer'

/** PDF 单页尺寸（pt = PDF 单位，pt 1:1 px @ 72 DPI；960×540 维持 16:9） */
const PDF_PAGE_WIDTH = 960
const PDF_PAGE_HEIGHT = 540

export async function pngsToPdf(pngs: Buffer[]): Promise<Blob> {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT],
  })

  for (let i = 0; i < pngs.length; i++) {
    if (i > 0) {
      // 后续页：手动 addPage 维持同样 format + orientation
      pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT], 'landscape')
    }
    // toString('base64') 走 buffer polyfill：浏览器 + Node 都支持
    const dataUrl = `data:image/png;base64,${pngs[i]!.toString('base64')}`
    // addImage(dataUrl, format, x, y, w, h, alias, compression)
    // alias 传 undefined 让 jsPDF 自己生成（防 N 页同一 alias 撞缓存被去重）
    pdf.addImage(
      dataUrl,
      'PNG',
      0,
      0,
      PDF_PAGE_WIDTH,
      PDF_PAGE_HEIGHT,
      undefined,
      'FAST',
    )
  }

  return pdf.output('blob')
}
