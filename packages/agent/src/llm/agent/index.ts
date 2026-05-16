/** Phase 12.7 Task C: pi-agent-core Agent factory（注入 streamFn / tools / hooks + agent_end 持久化）。 */
import {
  Agent,
  type AgentEvent,
  type StreamFn,
} from '@earendil-works/pi-agent-core'
import { streamSimple } from '@earendil-works/pi-ai'
import { getActiveProviderConfig } from '../settings.js'
import { decryptApiKey } from '../../crypto/apikey.js'
import { resolveModelForProvider } from '../adapters/pi-ai-adapter.js'
import { buildToolsForUser } from './tool-bridge.js'
import { persistTurnToDeckChats } from './persistence.js'
import { agentMessageToCanonical, canonicalToAgentMessage } from './agent-message.js'
import { loadDeckChatHistory } from './history-loader.js'
import { buildSystemPromptForDeck } from '../../prompts/buildSystemPrompt.js'
import { logServerEvent } from '../../logger/server-log.js'

export interface CreateAgentOpts {
  userId: number
  deckId: number
  encryptedSettings: string
}

export async function createAgent(opts: CreateAgentOpts): Promise<Agent> {
  const cfg = getActiveProviderConfig(opts.encryptedSettings)
  if (!cfg) throw new Error('LLM 未配置 active provider 或缺 apiKey')

  // 直接读 raw JSON（不走 zod 严格 parse）找 advanced.<provider>.thinkingLevel；
  // schema 当前未把 thinkingLevel 字段落进 zod，但运行时让用户/未来 schema 升级
  // 都能填进去无缝生效。损坏密文走 getActiveProviderConfig 已 catch,这里再 try
  // 一次保 createAgent 不被随机 JSON 错带挂。
  let rawSettings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(decryptApiKey(opts.encryptedSettings))
    if (parsed && typeof parsed === 'object') rawSettings = parsed as Record<string, unknown>
  } catch {
    // ignore；rawSettings 保持 {} → thinkingLevel 走 'off' fallback
  }
  const thinkingLevel = resolveThinkingLevel(rawSettings, cfg.provider)

  const model = resolveModelForProvider(cfg.provider, cfg.model, cfg.baseUrl)
  const tools = await buildToolsForUser(opts.userId)
  const systemPrompt = await buildSystemPromptForDeck(opts.deckId, opts.userId)
  const existingCanonical = await loadDeckChatHistory(opts.deckId)
  const existingAgentMessages = existingCanonical.map(canonicalToAgentMessage)
  const existingCount = existingCanonical.length

  // pi-agent-core 的 StreamFn 期望 streamSimple 形态（SimpleStreamOptions 含
  // reasoning / thinkingBudgets 字段）；pi-ai 0.74.0 export 的 streamSimple
  // 签名直接对齐。
  const streamFn: StreamFn = streamSimple as StreamFn

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
      messages: existingAgentMessages,
    },
    streamFn,
    sessionId: `lumideck:user-${opts.userId}:deck-${opts.deckId}`,
    toolExecution: 'parallel',

    beforeToolCall: async ({ toolCall }) => {
      logServerEvent({
        category: 'agent',
        event: 'tool-call',
        userId: opts.userId,
        deckId: opts.deckId,
        toolName: toolCall.name,
      })
      return undefined
    },

    afterToolCall: async ({ toolCall, isError }) => {
      logServerEvent({
        category: 'agent',
        event: 'tool-result',
        userId: opts.userId,
        deckId: opts.deckId,
        toolName: toolCall.name,
        isError,
      })
      return undefined
    },
  })

  // agent_end 后落 deck_chats；任何错误（包括 agentMessageToCanonical 撞未知 role）
  // 都吞掉并落 audit log——SSE 已 close 没法回退,失败用户 refresh 后看到部分历史。
  agent.subscribe(async (event: AgentEvent) => {
    if (event.type !== 'agent_end') return
    try {
      const newCanonical = event.messages.map(agentMessageToCanonical)
      await persistTurnToDeckChats(opts.deckId, newCanonical, existingCount)
    } catch (err) {
      logServerEvent({
        category: 'agent',
        event: 'persist-failed',
        userId: opts.userId,
        deckId: opts.deckId,
        errorMsg: (err as Error).message,
      })
    }
  })

  return agent
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
const THINKING_LEVELS = new Set<string>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])

/** thinkingLevel 解析顺序：advanced.<provider>.thinkingLevel → advanced.common.thinkingLevel → 'off'。 */
function resolveThinkingLevel(
  rawSettings: Record<string, unknown>,
  providerId: string,
): ThinkingLevel {
  const advanced = rawSettings.advanced
  if (!advanced || typeof advanced !== 'object') return 'off'
  const advancedObj = advanced as Record<string, unknown>
  const providerSpec = advancedObj[providerId]
  if (providerSpec && typeof providerSpec === 'object') {
    const lvl = (providerSpec as { thinkingLevel?: unknown }).thinkingLevel
    if (typeof lvl === 'string' && THINKING_LEVELS.has(lvl)) return lvl as ThinkingLevel
  }
  const common = advancedObj.common
  if (common && typeof common === 'object') {
    const lvl = (common as { thinkingLevel?: unknown }).thinkingLevel
    if (typeof lvl === 'string' && THINKING_LEVELS.has(lvl)) return lvl as ThinkingLevel
  }
  return 'off'
}
