/** Phase 13 Task C: PDF 文本抽取(pdf-parse 2.x class API)。 */
import { PDFParse } from 'pdf-parse'

const MAX_PAGES = 50
const MAX_CHARS = 50_000

export async function parsePdf(buffer: Buffer): Promise<string> {
  // pdf-parse 2.x:类实例 + getText({ first: N }) 只解析前 N 页
  // 注:DocumentInitParameters.data 接 Uint8Array;Buffer 实际是 Uint8Array 子类,
  //    构造器内部会做 ArrayBufferView → Uint8Array 转换,直接传 buffer 即可
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText({ first: MAX_PAGES })
    const totalPages = result.total ?? result.pages.length
    let text = (result.text ?? '').trim()
    if (text.length > MAX_CHARS) {
      const originalLen = text.length
      text = text.slice(0, MAX_CHARS) + `\n\n... (truncated, 原 ${originalLen} 字 / ${totalPages} 页)`
    }
    if (totalPages > MAX_PAGES) {
      text += `\n\n... (省略第 ${MAX_PAGES + 1}+ 页,共 ${totalPages} 页)`
    }
    return text
  } finally {
    // pdfjs Document 持原生 worker handle,必须 destroy 释放
    await parser.destroy().catch(() => {
      // 关闭失败不影响业务,吞掉
    })
  }
}
