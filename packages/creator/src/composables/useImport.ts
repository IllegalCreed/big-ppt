/**
 * Phase 15 Task 31-E:`.lumideck` 归档包导入 composable。
 *
 * 把用户从 `<input type="file">` 选中的 .lumideck 包 POST 到
 * `/api/decks/import`(multipart/form-data,form 字段名 `file`),后端 parse +
 * validate + 还原成新 deck(title 自动加「(导入)」后缀),返 `{ deckId, title }`。
 *
 * 设计抉择:
 * - **直 fetch 不走 api/client**:跟 useExport.ts 的 lumideck 分支同套路(line 65),
 *   composable 内直调依赖,api/ 模块留给非二进制 / 非文件的 JSON 端点;将来重构
 *   可统一抽到 `api/archive.ts`。
 * - **error 走 ref + throw 双暴露**:caller(DeckListPage)依赖 `try/catch` 决定要不
 *   要 router.push,template 同时读 `error.value` 渲染错误文本。两路冗余但都需要
 *   (try/catch 控制 happy path 跳转,reactive ref 让错误持续显示直到下次点击)。
 * - **finally 复位 importing**:同 useExport 的 finally pattern,无论 throw / return
 *   都关闭 loading 态,UI 按钮恢复可点。
 * - **不带 X-Deck-Id header**:导入是创建新 deck 的操作,后端 user-scoped 不需要
 *   activeDeckId context;ALS / X-Deck-Id 只对 deck-scoped 工具调用相关。
 */
import { ref } from 'vue'

export interface ImportResult {
  deckId: number
  title: string
}

export function useImport() {
  const importing = ref(false)
  const error = ref<string | null>(null)

  async function importArchive(file: File): Promise<ImportResult> {
    importing.value = true
    error.value = null
    try {
      const form = new FormData()
      form.append('file', file)
      const resp = await fetch('/api/decks/import', {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (!resp.ok) {
        // 后端 error body 是 JSON `{ error: string, code?: string }`;parse 失败兜底
        // 走 status 码文本(网络中间层 / nginx 抛非 JSON 错误时仍可见原因)
        const data = (await resp.json().catch(() => ({}))) as { error?: string }
        const msg = data.error || `导入失败 ${resp.status}`
        error.value = msg
        throw new Error(msg)
      }
      return (await resp.json()) as ImportResult
    } finally {
      importing.value = false
    }
  }

  return { importing, error, importArchive }
}
