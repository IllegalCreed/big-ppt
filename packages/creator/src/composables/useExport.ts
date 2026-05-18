/**
 * Phase 14 Task C：客户端导出 orchestration composable。
 *
 * 把 Task A 的 capturePages(逐页截图)+ Task B 的三种 converter
 * (pngsToPdf / pngsToPptx / pngsToZip)+ triggerDownload(浏览器下载)串成
 * 一条同步导出流。ExportModal UI 通过这个 composable 暴露的 reactive 状态
 * (exporting / error / progress)做 spinner + 进度条 + 错误兜底。
 *
 * 设计抉择:
 * - **不引 await 内层 finally 重新 throw**:capture-pages 抛错或 converter 抛错
 *   都走 catch 路径设 error.value + 立即 re-throw 让 caller(ExportModal)能 await
 *   到失败,UI 可显式渲染错误态 + retry 按钮。`finally` 只清理 exporting/progress。
 * - **totalPages === 0 guard**:UI 入口必须拦,不让 capture-pages 跑空 loop 出
 *   "空白产物"。to-pdf/pptx/zip 内层默认对空 input 返合法但空白的产物(jsPDF 构造
 *   自带一页空白),这种 silent 行为对单测 OK,对用户是 confusing(下载 0 页 deck
 *   不应该出 valid blob),故 useExport 显式 throw。
 * - **filename 走两层清洗**:`title.replace(/[\\/:*?"<>|]/g, '_')` 滤掉 Win/Mac/Linux
 *   文件名保留字符 + 拼时间戳防覆盖。空 title 不特殊处理(replace 后仍是空 string,
 *   filename 退化成 `-<timestamp>.<ext>`,浏览器仍能下载;dev 阶段 deck 必有 title)。
 * - **format → ext / converter 选择走 if/else 而非 map**:三选一,if/else 更直观;
 *   将来加格式(SVG / interactive HTML)再升级成 lookup table。
 */
import { ref } from 'vue'
import { capturePages } from '../export/capture-pages'
import { pngsToPdf } from '../export/to-pdf'
import { pngsToPptx } from '../export/to-pptx'
import { pngsToZip } from '../export/to-png-zip'
import { triggerDownload } from '../export/download'

export type ExportFormat = 'pdf' | 'png-zip' | 'pptx'

export interface ExportDeckPayload {
  id: number
  title: string
  markdown: string
  templateId: string
  totalPages: number
}

export interface ExportProgress {
  done: number
  total: number
}

export function useExport() {
  const exporting = ref(false)
  const error = ref<string | null>(null)
  const progress = ref<ExportProgress | null>(null)

  async function exportDeck(deck: ExportDeckPayload, format: ExportFormat): Promise<void> {
    // Guard:0 页直接拒(plan 30 minor 2:UI 入口必须拦,不让 capture-pages 跑空 loop)
    if (deck.totalPages <= 0) {
      const msg = 'deck 无可导出页面'
      error.value = msg
      throw new Error(msg)
    }

    exporting.value = true
    error.value = null
    progress.value = { done: 0, total: deck.totalPages }

    try {
      const pngs = await capturePages({
        deckId: deck.id,
        markdown: deck.markdown,
        templateId: deck.templateId,
        totalPages: deck.totalPages,
        onProgress: (done, total) => {
          progress.value = { done, total }
        },
      })

      let blob: Blob
      let ext: string
      if (format === 'pdf') {
        blob = await pngsToPdf(pngs)
        ext = 'pdf'
      } else if (format === 'pptx') {
        blob = await pngsToPptx(pngs)
        ext = 'pptx'
      } else {
        blob = await pngsToZip(pngs)
        ext = 'zip'
      }

      // Win/Mac/Linux 文件名保留字符全替成 _;时间戳防覆盖
      const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_')
      const filename = `${safeName}-${Date.now()}.${ext}`
      triggerDownload(blob, filename)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      exporting.value = false
      progress.value = null
    }
  }

  return { exporting, error, progress, exportDeck }
}
