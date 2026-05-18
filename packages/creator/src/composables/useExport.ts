/**
 * Phase 14 Task C / Phase 15 Task D:客户端导出 orchestration composable。
 *
 * 把 Task A 的 capturePages(逐页截图)+ Task B 的三种 converter
 * (pngsToPdf / pngsToPptx / pngsToZip)+ triggerDownload(浏览器下载)串成
 * 一条同步导出流;Phase 15 Task D 加 'lumideck' 归档分支(直接 fetch backend
 * `GET /api/decks/:id/export-archive` 拿 zip,不走截图链路)。
 *
 * ExportModal UI 通过这个 composable 暴露的 reactive 状态(exporting / error /
 * progress)做 spinner + 进度条 + 错误兜底。
 *
 * 设计抉择:
 * - **不引 await 内层 finally 重新 throw**:capture-pages 抛错或 converter 抛错
 *   都走 catch 路径设 error.value + 立即 re-throw 让 caller(ExportModal)能 await
 *   到失败,UI 可显式渲染错误态 + retry 按钮。`finally` 只清理 exporting/progress。
 * - **totalPages === 0 guard 只对 client 截图链路生效**:UI 入口必须拦截截图链路
 *   跑空 loop;但 'lumideck' 后端归档允许空 deck(manifest + 空 content.md 也是
 *   合法包),故 lumideck 分支提前 return 不查 totalPages。
 * - **filename 走两层清洗**:`title.replace(/[\\/:*?"<>|]/g, '_')` 滤掉 Win/Mac/Linux
 *   文件名保留字符 + 拼时间戳防覆盖。空 title 不特殊处理(replace 后仍是空 string,
 *   filename 退化成 `-<timestamp>.<ext>`,浏览器仍能下载;dev 阶段 deck 必有 title)。
 * - **format → ext / converter 选择走 if/else 而非 map**:四选一仍直观,将来加更多
 *   格式(SVG / interactive HTML)再升级成 lookup table。
 * - **lumideck 进度 indeterminate**:后端 export-archive 是 single shot,无逐页 hook,
 *   故 progress 设 `{done:0, total:1}` 作 indeterminate sentinel;ExportModal 据
 *   `format === 'lumideck'` 切换显示文案("正在打包..." 代替 "第 X/Y 页")。
 * - **lumideck 直接 fetch 不走 api/ 模块**:沿用 useExport 已有惯例(其他三种格式
 *   也是 composable 内直调依赖);将来重构可统一抽到 `api/archive.ts`。
 */
import { ref } from 'vue'
import { capturePages } from '../export/capture-pages'
import { pngsToPdf } from '../export/to-pdf'
import { pngsToPptx } from '../export/to-pptx'
import { pngsToZip } from '../export/to-png-zip'
import { triggerDownload } from '../export/download'

export type ExportFormat = 'pdf' | 'png-zip' | 'pptx' | 'lumideck'

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
    // 'lumideck' 分支:后端归档包,跳过截图链路;允许空 deck(后端不需要 totalPages)
    if (format === 'lumideck') {
      exporting.value = true
      error.value = null
      // indeterminate progress sentinel({done:0, total:1});UI 据 format 切换文案
      progress.value = { done: 0, total: 1 }
      try {
        const resp = await fetch(`/api/decks/${deck.id}/export-archive`, {
          credentials: 'include',
        })
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          throw new Error(`导出失败: ${resp.status} ${errText || resp.statusText}`)
        }
        const blob = await resp.blob()
        const safeName = deck.title.replace(/[\\/:*?"<>|]/g, '_')
        const filename = `${safeName}-${Date.now()}.lumideck`
        triggerDownload(blob, filename)
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        exporting.value = false
        progress.value = null
      }
      return
    }

    // 以下三种 client 截图链路:必须 0 页 guard
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
