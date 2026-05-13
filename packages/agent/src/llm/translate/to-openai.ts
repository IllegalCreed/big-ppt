/**
 * Phase 12 Task C：CanonicalMessage[] → OpenAI ChatCompletionMessageParam[]。
 *
 * 三个核心转换规则:
 *
 * 1. **assistant mixed content**:canonical 允许 assistant 同时含 text + tool_use blocks
 *    (Anthropic block-based shape)。OpenAI 把 text 放 `content: string`,tool_use 放
 *    `tool_calls[]`(`{ id, function: { name, arguments: JSON.stringify(input) } }`)。
 *    所以同一 CanonicalMessage 翻译成**单条** assistant message,内部聚合 text + 拆 tool_use。
 *
 * 2. **tool_result blocks → role:'tool' messages**:canonical 是 user role 的 block
 *    (Anthropic),OpenAI 是独立 `role: 'tool'` message。一个 user message 里 N 个
 *    tool_result blocks **拆成 N 条** role:'tool' messages(每条带不同 tool_call_id)。
 *    剩下的 text / image blocks 仍保留为一条 user message,**插入位置在被拆 tool 之前**
 *    保留时序(LLM 看到的顺序:tool_result 1 → tool_result 2 → ... → user text)。
 *
 *    Why 拆而非合并:OpenAI tool message 是 1:1 对 tool call(单 tool_call_id),无法把
 *    多个 tool result 塞进一条 message。
 *
 * 3. **多模态**:ImageBlock 用 `{ type: 'image_url', image_url: { url: 'data:<mediaType>;base64,<dataBase64>' } }`
 *    形式(OpenAI 多模态规范)。url 字段必须是完整 data URL,不能只放裸 base64。
 *
 * 4. **thinking blocks silent drop**:OpenAI 没有 thinking 概念,canonical thinking blocks
 *    遇到直接跳过(不抛错、不 warn —— 翻译层语义是"尽力适配",caller 不期望 OpenAI
 *    返回 thinking,丢弃合规)。
 *
 * 5. **system 拼接**:OpenAI system message 只接受 `content: string | ChatCompletionContentPartText[]`,
 *    本实现把多个 text blocks 拼成单 string(简单稳定;structured 形式留给未来需要时)。
 */

import OpenAI from 'openai'
import { assertNever, type Block, type CanonicalMessage, type ToolDef } from '../types.js'

/**
 * canonical → openai message array。
 *
 * 单条 CanonicalMessage 可能映射成 0 / 1 / N 条 OpenAI message(tool_result 拆分场景),
 * 所以用 flatMap 而非 map。
 */
export function toOpenAIMessages(
  messages: CanonicalMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.flatMap(translateMessage)
}

function translateMessage(msg: CanonicalMessage): OpenAI.Chat.ChatCompletionMessageParam[] {
  switch (msg.role) {
    case 'system':
      return translateSystem(msg.content)
    case 'user':
      return translateUser(msg.content)
    case 'assistant':
      return translateAssistant(msg.content)
    case 'tool':
      // canonical role:'tool' 不常见——主要用 user.content 装 tool_result blocks。
      // 但若 caller 显式构造 role:'tool' message,把它当 tool_result-only 处理。
      return extractToolResults(msg.content)
    default:
      return assertNever(msg.role)
  }
}

/**
 * system blocks 仅取 text 拼成单 string;非 text blocks(image / thinking / tool_*)在
 * system role 下没有合法语义,直接丢。空 system → 不输出任何 message。
 */
function translateSystem(blocks: Block[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const text = blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
  if (text.length === 0) return []
  return [{ role: 'system', content: text }]
}

/**
 * user blocks 处理:
 * - tool_result blocks → 拆成 N 条 role:'tool' message
 * - text / image blocks → 拼成 1 条 role:'user' message
 * - thinking blocks → silent drop
 * - tool_use blocks → assistant 才该有,user 里出现按 drop 处理(保守容错)
 *
 * 输出顺序:tool_result 在前,user 在后(保留 LLM 视角的"先看 tool result 再读 user prompt")。
 */
function translateUser(blocks: Block[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const toolMessages = extractToolResults(blocks)
  const userParts: OpenAI.Chat.ChatCompletionContentPart[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        userParts.push({ type: 'text', text: block.text })
        break
      case 'image':
        userParts.push({
          type: 'image_url',
          image_url: { url: `data:${block.mediaType};base64,${block.dataBase64}` },
        })
        break
      case 'thinking':
      case 'tool_use':
      case 'tool_result':
        // thinking / tool_use 不属 user message;tool_result 已被 extractToolResults 处理
        break
      default:
        assertNever(block)
    }
  }

  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [...toolMessages]
  if (userParts.length > 0) {
    // 单 text block 时用 `content: string` 简化(OpenAI 接受两种,但 string 形式
    // 更接近大多数 caller 的预期 + 兼容更老的 OpenAI-compatible provider)
    if (userParts.length === 1 && userParts[0]!.type === 'text') {
      out.push({ role: 'user', content: userParts[0]!.text })
    } else {
      out.push({ role: 'user', content: userParts })
    }
  }
  return out
}

/**
 * assistant blocks 处理:
 * - text blocks 拼接成 content string
 * - tool_use blocks 提到 tool_calls 数组,arguments 用 JSON.stringify(input)
 * - thinking blocks silent drop(plan §to-openai 第 4 条)
 * - tool_result / image blocks 不属 assistant role,drop
 *
 * 输出**单条** assistant message;若 text + tool_use 同时存在,两者共存在同一 message。
 */
function translateAssistant(blocks: Block[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  let text = ''
  const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        text += block.text
        break
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
        break
      case 'thinking':
        // OpenAI 无对应概念,silent drop
        break
      case 'image':
      case 'tool_result':
        // assistant 不应含 image / tool_result;保守 drop
        break
      default:
        assertNever(block)
    }
  }

  // 全空 assistant message 没意义,跳过(避免给 OpenAI 发 `content: null, tool_calls: []`)
  if (text.length === 0 && toolCalls.length === 0) return []

  const out: OpenAI.Chat.ChatCompletionAssistantMessageParam = { role: 'assistant' }
  // OpenAI spec:tool_calls 与 content 互斥不强制,但 content 为空时建议省略字段。
  // 这里 text='' + tool_calls 非空时显式写 null 让 OpenAI 知道这是工具调用 turn。
  if (text.length > 0) {
    out.content = text
  } else if (toolCalls.length > 0) {
    out.content = null
  }
  if (toolCalls.length > 0) {
    out.tool_calls = toolCalls
  }
  return [out]
}

/**
 * 从 blocks 里抽出所有 tool_result,翻译成 N 条 role:'tool' message。
 * 一个 ToolResultBlock 严格对应一条 tool message(单 tool_call_id)。
 *
 * content 处理:
 * - string → 直接放 message.content
 * - Block[] → 仅保留 text blocks 拼接(OpenAI tool message content 只接受 string
 *   或 ChatCompletionContentPartText[];image / 嵌套 tool_use 没合法表达,drop)
 * - isError=true → 没有原生 flag,把 "[ERROR] " 前缀加到 content 让 LLM 知道
 */
function extractToolResults(blocks: Block[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = []
  for (const block of blocks) {
    if (block.type !== 'tool_result') continue
    const contentStr = stringifyToolResultContent(block.content)
    const final = block.isError ? `[ERROR] ${contentStr}` : contentStr
    out.push({
      role: 'tool',
      content: final,
      tool_call_id: block.toolUseId,
    })
  }
  return out
}

function stringifyToolResultContent(content: string | Block[]): string {
  if (typeof content === 'string') return content
  // Block[]:仅取 text 拼起来(其他类型在 OpenAI tool message 没合法表达)
  return content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/**
 * canonical ToolDef → OpenAI function tool。
 *
 * 三家 provider 的 tool schema 都派生自 JSON Schema(plan §Task B types §ToolDef);
 * OpenAI 包在 `{ type: 'function', function: { name, description, parameters } }` 壳里。
 */
export function toOpenAITools(tools: ToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }))
}
