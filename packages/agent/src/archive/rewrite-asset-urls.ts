/**
 * Phase 15:import 时把 markdown 里的 /api/assets/<oldId> 替换成 /api/assets/<newId>。
 *
 * 用 idMap(oldUuid → newUuid)做映射。map 中无对应 id 时保持原样
 * (graceful degrade,不抛错;断链由前端渲染时显示坏图占位)。
 *
 * regex case-sensitive,大小写不一样的路径(如 /API/Assets/...)不被替换。
 */
const ASSET_ID_RE = /\/api\/assets\/([0-9a-f-]{36})/g

export function rewriteAssetUrls(markdown: string, idMap: Map<string, string>): string {
  return markdown.replace(ASSET_ID_RE, (whole, oldId: string) => {
    const newId = idMap.get(oldId)
    return newId ? `/api/assets/${newId}` : whole
  })
}
