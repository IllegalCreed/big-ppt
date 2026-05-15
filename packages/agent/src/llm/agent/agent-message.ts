/**
 * Phase 12.7 Task B：canonical CanonicalMessage ↔ pi-agent-core AgentMessage
 * 双向翻译。
 *
 * 设计要点：
 * - **role 映射**:
 *   - `user` ↔ `user`
 *   - `assistant` ↔ `assistant`
 *   - `tool` ↔ `toolResult`（pi-agent-core 用 camelCase）
 *   - `system` 不入 AgentMessage 链——pi-agent-core 设计上系统提示走
 *     `Agent.initialState.systemPrompt`，不混在 conversation transcript。
 *     `canonicalToAgentMessage` 收到 `system` 直接抛错，调用方应在 Task C
 *     的 `createAgent` 入口把 system 提取出来塞到 initialState。
 * - **block 映射 5 类**：
 *   - text ↔ text
 *   - image: canonical `{mediaType, dataBase64}` ↔ pi `{mimeType, data}` 字段
 *     名差异需要换名（plan §关键设计抉择 #2）
 *   - thinking: canonical `{text}` ↔ pi `{thinking}` 字段名差异
 *   - tool_use ↔ toolCall: type 名 + 字段名 (`input` ↔ `arguments`) 都不同
 *   - tool_result: canonical 是 block，pi 是顶层 message（content / isError
 *     单独字段）—— 见下条
 * - **tool_result 形态错配**：canonical 把"一个 tool 结果"建模成 `role:'tool'`
 *   消息内的 `ToolResultBlock`（block 数组可放多个）；pi-agent-core 一条
 *   `ToolResultMessage` 代表**单个**工具结果（toolCallId / content / isError
 *   全部都在 message 顶层）。所以：
 *   - canonical → pi: `role:'tool'` 消息**第 1 个** `tool_result` block 决定
 *     这条 ToolResultMessage 的 toolCallId / isError；同消息内的其他
 *     `tool_result` block 当前丢弃（canonical 现网生成方一条 'tool' 消息只
 *     1 个 result block，未来若并行 tool 用法上需要给每个 result 一条
 *     CanonicalMessage）。这是 plan §设计抉择已确认的取舍。
 *   - pi → canonical: 单条 ToolResultMessage 翻成单条 `role:'tool'` 消息内
 *     单个 `ToolResultBlock`，对称。
 * - **toolName 丢失**：canonical `ToolResultBlock` 没有 `toolName` 字段
 *   （它只对显示有意义），pi-agent-core `ToolResultMessage.toolName` 是
 *   字符串必填。canonical → pi 我们填空串占位（loop 内部用 toolCallId
 *   绑配对，不读 toolName）；pi → canonical 直接 drop。
 *
 * 与 plan 28 Task B 假设的偏离（写到这里供 commit body 引用）:
 * - plan 文本提到"AgentMessage role 值 'tool_result' vs 'toolResult'?"——实际
 *   pi-agent-core/pi-ai 是 `toolResult`（camelCase），canonical 是 `tool`，
 *   我们按 camelCase 实现。
 * - plan 提"content block type 名 'toolCall' vs 'tool_use'?"——实际 pi-ai
 *   block 是 `toolCall`，canonical 是 `tool_use`，按 type 名翻译。
 * - canonical `ThinkingBlock` 字段是 `{text}` 单字段（无 signature），pi-ai
 *   是 `{thinking, thinkingSignature?, redacted?}` —— signature / redacted 在
 *   canonical 缺位，pi → canonical 时丢弃；canonical → pi 时不构造（loop
 *   会接受 signature 缺失的 thinking block）。
 */

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type { Block, CanonicalMessage } from '../types.js'
import { assertNever } from '../types.js'

type PiUserBlock = TextContent | ImageContent
type PiAssistantBlock = TextContent | ThinkingContent | ToolCall

/* ────────────────────────────────────────────────────────────────────────
 * pi-agent-core AgentMessage → canonical CanonicalMessage
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 把 pi-agent-core `AgentMessage`（user / assistant / toolResult 之一）翻成
 * 单条 canonical `CanonicalMessage`。
 *
 * 输入限定为标准 LLM 三种 role；若调用方注入自定义 `CustomAgentMessages`
 * 子类型（NotificationMessage / ArtifactMessage 等），调用前应自行过滤——
 * 这里不识别会抛错。
 */
export function agentMessageToCanonical(m: AgentMessage): CanonicalMessage {
  switch (m.role) {
    case 'user':
      return { role: 'user', content: piUserContentToBlocks(m) }
    case 'assistant':
      return { role: 'assistant', content: piAssistantContentToBlocks(m) }
    case 'toolResult':
      return { role: 'tool', content: [piToolResultToBlock(m)] }
    default:
      throw new Error(
        `[agentMessageToCanonical] 未知 role: ${
          (m as { role?: unknown }).role ?? '<unknown>'
        }`,
      )
  }
}

function piUserContentToBlocks(m: UserMessage): Block[] {
  if (typeof m.content === 'string') {
    return [{ type: 'text', text: m.content }]
  }
  return m.content.map(piUserBlockToCanonical)
}

function piUserBlockToCanonical(b: PiUserBlock): Block {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'image':
      // 字段名换：data → dataBase64, mimeType → mediaType
      return { type: 'image', mediaType: b.mimeType, dataBase64: b.data }
  }
}

function piAssistantContentToBlocks(m: AssistantMessage): Block[] {
  return m.content.map(piAssistantBlockToCanonical)
}

function piAssistantBlockToCanonical(b: PiAssistantBlock): Block {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'thinking':
      // 字段名换：thinking → text；signature / redacted 不在 canonical 表达。
      return { type: 'thinking', text: b.thinking }
    case 'toolCall':
      return {
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: b.arguments,
      }
  }
}

function piToolResultToBlock(m: ToolResultMessage): Block {
  // toolName 在 canonical 没有承载位置，直接 drop；content 走 (text|image)[]
  // → canonical Block[] 翻译（image 字段名同 user content 一样换）。
  const content: Block[] = m.content.map(piUserBlockToCanonical)
  const block = {
    type: 'tool_result' as const,
    toolUseId: m.toolCallId,
    content,
    isError: m.isError,
  }
  return block
}

/* ────────────────────────────────────────────────────────────────────────
 * canonical CanonicalMessage → pi-agent-core AgentMessage
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 把 canonical `CanonicalMessage` 翻成 pi-agent-core `AgentMessage`。
 *
 * - `system` 直接抛错（不入 message 链）；
 * - `assistant` 输出 stub-shape `AssistantMessage`：api / provider / model /
 *   usage / stopReason 字段是 pi 类型必填，但在 transcript 注入场景这些不会
 *   被下游 LLM 读（pi 内部用它做"上游响应回放"，注入历史时只看 content + role
 *   + timestamp）。我们填 placeholder 让类型门通过，跟既有
 *   `pi-ai-adapter.ts` line 320-325 注入 assistant 走同套路。
 */
export function canonicalToAgentMessage(m: CanonicalMessage): AgentMessage {
  switch (m.role) {
    case 'system':
      throw new Error(
        '[canonicalToAgentMessage] system role 不入 AgentMessage 链—— ' +
          '应在 Agent.initialState.systemPrompt 里设置',
      )
    case 'user':
      return canonicalUserToPi(m)
    case 'assistant':
      return canonicalAssistantToPi(m)
    case 'tool':
      return canonicalToolToPi(m)
    default:
      // exhaustive: 若 CanonicalRole 加新 role 这里 TS 立刻报错
      return assertNever(m.role)
  }
}

function canonicalUserToPi(m: CanonicalMessage): UserMessage {
  const content: PiUserBlock[] = []
  for (const b of m.content) {
    const piBlock = canonicalBlockToPiUser(b)
    if (piBlock) content.push(piBlock)
  }
  return {
    role: 'user',
    content,
    timestamp: Date.now(),
  }
}

function canonicalBlockToPiUser(b: Block): PiUserBlock | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'image':
      return { type: 'image', data: b.dataBase64, mimeType: b.mediaType }
    case 'thinking':
    case 'tool_use':
    case 'tool_result':
      // user 不允许这些 block 类型——按 pi-ai 约定丢弃
      return null
  }
}

function canonicalAssistantToPi(m: CanonicalMessage): AssistantMessage {
  const content: PiAssistantBlock[] = []
  for (const b of m.content) {
    const piBlock = canonicalBlockToPiAssistant(b)
    if (piBlock) content.push(piBlock)
  }
  return {
    role: 'assistant',
    content,
    // 注入 transcript 用 placeholder——pi 不会回放这些字段。
    api: 'openai-completions',
    provider: 'unknown',
    model: 'unknown',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function canonicalBlockToPiAssistant(b: Block): PiAssistantBlock | null {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'thinking':
      return { type: 'thinking', thinking: b.text }
    case 'tool_use':
      return {
        type: 'toolCall',
        id: b.id,
        name: b.name,
        arguments: (b.input ?? {}) as Record<string, unknown>,
      }
    case 'image':
    case 'tool_result':
      // assistant 不允许这些类型——drop
      return null
  }
}

function canonicalToolToPi(m: CanonicalMessage): ToolResultMessage {
  // 找该消息内**第一个** tool_result block 决定 ToolResultMessage 的 shape；
  // 其他 tool_result block 在当前 spec 下不可能出现（生成方一条 'tool'
  // 消息只放 1 个 result block），出现就 drop。
  const trBlock = m.content.find(
    (b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result',
  )
  if (!trBlock) {
    throw new Error(
      '[canonicalToAgentMessage] role=tool 必须至少含 1 个 tool_result block',
    )
  }

  // content 走 string → 单 TextContent；Block[] → (text|image)[] 翻译过滤。
  const piContent: (TextContent | ImageContent)[] = []
  if (typeof trBlock.content === 'string') {
    piContent.push({ type: 'text', text: trBlock.content })
  } else {
    for (const b of trBlock.content) {
      const piBlock = canonicalBlockToPiUser(b) // 复用 user shape（text/image 子集）
      if (piBlock) piContent.push(piBlock)
    }
  }

  return {
    role: 'toolResult',
    toolCallId: trBlock.toolUseId,
    // canonical 不承载 toolName，填空串占位；pi-agent-core loop 内部用
    // toolCallId 配对而非 toolName，不影响 conversation correctness。
    toolName: '',
    content: piContent,
    isError: trBlock.isError ?? false,
    timestamp: Date.now(),
  }
}
