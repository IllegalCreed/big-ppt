/**
 * 向 agent 拉取 system prompt（Phase 6C）。
 *
 * 老版本（硬编码 7 个 layout 文本）已下线；prompt 构造逻辑完整迁到 agent，
 * 由目标模板的 manifest 动态拼装，这里只负责 fetch。
 *
 * @param templateId 当前 deck 的模板 id；未提供则走 'beitou-standard' 默认值
 * @param mcpBadges 已启用 MCP 的类别角标，agent 会拼到 prompt 末尾
 * @throws 抛错：agent 未启动 / templateId 非法 / 响应格式异常
 */
import { api } from '../api/client'

export async function buildSystemPrompt(
  templateId: string = 'beitou-standard',
  mcpBadges?: string[],
): Promise<string> {
  const qs = new URLSearchParams({ templateId })
  if (mcpBadges && mcpBadges.length > 0) qs.set('mcpBadges', mcpBadges.join(','))
  const res = await api.get<{ success: boolean; prompt?: string; error?: string }>(
    `/api/system-prompt?${qs.toString()}`,
  )
  if (!res.success || typeof res.prompt !== 'string') {
    throw new Error(res.error ?? 'system-prompt 响应异常')
  }
  return res.prompt
}
