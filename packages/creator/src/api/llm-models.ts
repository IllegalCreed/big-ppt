/**
 * Phase 12.5 Task D：Settings UI 的 model dropdown 拉 pi-ai 可用 model 列表。
 *
 * 失败时返空数组（不抛），caller 走 fallback（input 还是会显示 placeholder 引导
 * 用户手填 model id）。这样 UI 不会因为一次接口抖动卡住，combobox 也允许用户
 * 自由输入 pi-ai 列表外的 model id（中转 / 自部署 baseUrl 场景常有）。
 */
export type ModelInfo = { id: string; name: string }

export async function fetchModels(providerId: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(
      `/api/llm/models?provider=${encodeURIComponent(providerId)}`,
      { credentials: 'include' },
    )
    if (!res.ok) {
      console.warn(`fetchModels(${providerId}) failed: ${res.status}`)
      return []
    }
    const body = (await res.json()) as { models?: ModelInfo[] }
    return body.models ?? []
  } catch (err) {
    console.warn(`fetchModels(${providerId}) threw:`, (err as Error).message)
    return []
  }
}
