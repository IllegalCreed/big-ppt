/**
 * Phase 12 Task G:CanonicalMessage[] → Anthropic system + MessageParam[]。
 *
 * Anthropic 协议跟 OpenAI 差异巨大:
 *
 * 1. **system 字段独立**:不在 messages 数组里,而是 MessageCreateParams.system
 *    顶层字段。canonical 第一条 role:'system' message 被抽出来变成 system 串(或
 *    `Array<TextBlockParam>` 形式,后者支持 cache_control 标记)。其余 system messages
 *    silent drop(Anthropic 一次请求只接受单个 system prompt)。
 *
 * 2. **messages 只有 user / assistant 两个 role**(没 'tool')。canonical 的 tool
 *    role / user role 内含 tool_result blocks → 全部并入 user role 的 content 数组。
 *
 *    合并规则:连续的 canonical tool / user / 含 tool_result 的 user messages,在翻译时
 *    合并成**单条** user message,其 content 数组先排 tool_result blocks 再排 text / image
 *    blocks(顺序保持 LLM 视角"先看 tool result 再读 user prompt")。
 *
 *    更宽松的实现:不强制合并相邻 user messages —— Anthropic 实测允许多个连续 user
 *    messages,只是会浪费 token。本实现走"每条 canonical user/tool message 翻译成
 *    一条 Anthropic user message"的 1:1 映射,语义清晰,缺点是 LLM 端可能看到的
 *    user message 数比 canonical 多。
 *
 *    **特殊情况**:canonical tool message(独立 role:'tool')翻译为 Anthropic user message
 *    含 tool_result blocks(Anthropic spec:tool_result 必须出现在 user role 下)。
 *
 * 3. **content blocks 几乎 1:1 映射**:
 *    - TextBlock → `{ type: 'text', text }`
 *    - ImageBlock → `{ type: 'image', source: { type: 'base64', media_type, data } }`
 *    - ThinkingBlock(assistant only)→ `{ type: 'thinking', thinking, signature: '' }`
 *    - ToolUseBlock(assistant only)→ `{ type: 'tool_use', id, name, input }`
 *    - ToolResultBlock(user only)→ `{ type: 'tool_result', tool_use_id, content, is_error? }`
 *
 * 4. **cache_control 标记**:canonical message 的 `cacheControl?: { type: 'ephemeral' }`
 *    翻译时给该 message 的**最后一个** content block 加 `cache_control: { type: 'ephemeral' }`。
 *    Anthropic 缓存粒度:cache marker 标在 block 上,从开头到该 block 全部进缓存。
 *
 *    system message 走特殊路径:cacheControl 存在时 system 用 array 形式输出,最后一个
 *    TextBlockParam 加 cache_control;否则用纯 string 形式。
 *
 * 5. **input_schema sanitization**:Anthropic Tool.InputSchema 不支持 oneOf / allOf /
 *    anyOf / not / $ref 这类 JSON Schema 高级特性(Anthropic 是 draft-07 严格子集)。
 *    遇到时递归 drop 并 console.warn,让用户工具仍能注册;LLM 端可能因 schema 不完整
 *    生成有误 input,后续 schema validation 兜底。
 *
 * 6. **thinking 跟 tool_use 顺序**:Anthropic spec 要求 thinking blocks 必须出现在
 *    tool_use blocks **之前**(否则 400 invalid_request)。本翻译按 canonical block
 *    数组顺序输出 —— caller 必须保证 thinking 在前(LLM streaming 自然如此),
 *    本层不做重排。
 */

import type Anthropic from '@anthropic-ai/sdk'
import { assertNever, type Block, type CanonicalMessage, type ToolDef } from '../types.js'

type AnthropicSystemParam = NonNullable<Anthropic.Messages.MessageCreateParams['system']>
type AnthropicMessageParam = Anthropic.Messages.MessageParam
type AnthropicContentBlockParam = Anthropic.Messages.ContentBlockParam
type AnthropicTextBlockParam = Anthropic.Messages.TextBlockParam
type AnthropicToolResultBlockParam = Anthropic.Messages.ToolResultBlockParam
type EphemeralCacheControl = Anthropic.Messages.CacheControlEphemeral

const EPHEMERAL: EphemeralCacheControl = { type: 'ephemeral' }

/**
 * canonical messages → Anthropic input(system + messages 二元组)。
 *
 * - 第一条 role:'system' message 抽出来变 system 字段(后续 system messages 丢弃)
 * - 其余翻译成 Anthropic.MessageParam 数组(role:'user'/'assistant')
 * - role:'tool' message 走 user role + tool_result blocks 通道
 */
export function toAnthropicInput(messages: CanonicalMessage[]): {
  system?: AnthropicSystemParam
  messages: AnthropicMessageParam[]
} {
  let system: AnthropicSystemParam | undefined
  const out: AnthropicMessageParam[] = []
  let systemSeen = false

  for (const msg of messages) {
    switch (msg.role) {
      case 'system': {
        if (systemSeen) break // Anthropic 只接受单个 system prompt,后续 silent drop
        systemSeen = true
        const sys = translateSystem(msg)
        if (sys !== undefined) system = sys
        break
      }
      case 'user': {
        const m = translateUser(msg)
        if (m) out.push(m)
        break
      }
      case 'assistant': {
        const m = translateAssistant(msg)
        if (m) out.push(m)
        break
      }
      case 'tool': {
        // canonical role:'tool' 在 Anthropic 协议下是 user message 含 tool_result blocks
        const m = translateToolMessage(msg)
        if (m) out.push(m)
        break
      }
      default:
        return assertNever(msg.role)
    }
  }

  return system === undefined ? { messages: out } : { system, messages: out }
}

/**
 * system message 翻译:
 * - 取 text blocks 拼成 system prompt
 * - 无 cacheControl 时返 string(简洁)
 * - 有 cacheControl 时返 Array<TextBlockParam>,最后一个 TextBlockParam 带 cache_control
 * - 全空 text blocks → undefined
 *
 * 非 text blocks(image / thinking / tool_*)在 system 下没合法语义,silent drop。
 */
function translateSystem(msg: CanonicalMessage): AnthropicSystemParam | undefined {
  const texts = msg.content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
  if (texts.length === 0) return undefined

  if (!msg.cacheControl) {
    return texts.join('')
  }

  // cacheControl 存在:用 array 形式让最后一个 TextBlockParam 挂 cache_control
  const parts: AnthropicTextBlockParam[] = texts.map((text) => ({ type: 'text', text }))
  const last = parts[parts.length - 1]!
  parts[parts.length - 1] = { ...last, cache_control: EPHEMERAL }
  return parts
}

function translateUser(msg: CanonicalMessage): AnthropicMessageParam | null {
  const content = translateUserContentBlocks(msg.content)
  if (content.length === 0) return null
  applyCacheControlIfNeeded(content, msg.cacheControl)
  return { role: 'user', content }
}

/**
 * canonical user.content → Anthropic user content blocks。
 *
 * - tool_result blocks 保留(Anthropic user role 才能装)
 * - text / image 保留
 * - thinking / tool_use 不属 user role,silent drop
 */
function translateUserContentBlocks(blocks: Block[]): AnthropicContentBlockParam[] {
  const out: AnthropicContentBlockParam[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push({ type: 'text', text: block.text })
        break
      case 'image':
        out.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: block.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
            data: block.dataBase64,
          },
        })
        break
      case 'tool_result':
        out.push(translateToolResultBlock(block))
        break
      case 'thinking':
      case 'tool_use':
        // 不属 user role,silent drop
        break
      default:
        assertNever(block)
    }
  }
  return out
}

function translateAssistant(msg: CanonicalMessage): AnthropicMessageParam | null {
  const content = translateAssistantContentBlocks(msg.content)
  if (content.length === 0) return null
  applyCacheControlIfNeeded(content, msg.cacheControl)
  return { role: 'assistant', content }
}

/**
 * canonical assistant.content → Anthropic assistant content blocks。
 *
 * - text / thinking / tool_use 保留(thinking 必须在 tool_use 前,caller 保证顺序)
 * - image / tool_result 不属 assistant role,silent drop
 */
function translateAssistantContentBlocks(blocks: Block[]): AnthropicContentBlockParam[] {
  const out: AnthropicContentBlockParam[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push({ type: 'text', text: block.text })
        break
      case 'thinking':
        // ThinkingBlockParam 要求 signature 字段(实际 round-trip 时 SDK 给的 signature
        // 应该被 caller 沿用,canonical 简化没存 signature),空串占位让 SDK 不拒
        out.push({ type: 'thinking', thinking: block.text, signature: '' })
        break
      case 'tool_use':
        out.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        })
        break
      case 'image':
      case 'tool_result':
        // 不属 assistant role,silent drop
        break
      default:
        assertNever(block)
    }
  }
  return out
}

/**
 * canonical role:'tool' message → Anthropic user message + tool_result blocks。
 *
 * 仅保留 content 中的 tool_result blocks(text / image / 其他在 tool message 没合法语义)。
 */
function translateToolMessage(msg: CanonicalMessage): AnthropicMessageParam | null {
  const blocks: AnthropicToolResultBlockParam[] = []
  for (const block of msg.content) {
    if (block.type === 'tool_result') {
      blocks.push(translateToolResultBlock(block))
    }
  }
  if (blocks.length === 0) return null
  applyCacheControlIfNeeded(blocks, msg.cacheControl)
  return { role: 'user', content: blocks }
}

/**
 * canonical ToolResultBlock → Anthropic ToolResultBlockParam。
 *
 * content 处理:
 * - string → 直接用 string content
 * - Block[] → 仅取 text blocks 拼接成 string(Anthropic ToolResultBlockParam.content
 *   可以是 Array<TextBlockParam | ImageBlockParam | ...>,但我们简化为 string,跟
 *   to-openai 一致)。未来若需多模态 tool_result 再扩展。
 */
function translateToolResultBlock(block: Extract<Block, { type: 'tool_result' }>): AnthropicToolResultBlockParam {
  const contentStr =
    typeof block.content === 'string'
      ? block.content
      : block.content
          .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('')
  const out: AnthropicToolResultBlockParam = {
    type: 'tool_result',
    tool_use_id: block.toolUseId,
    content: contentStr,
  }
  if (block.isError) out.is_error = true
  return out
}

/**
 * 给 blocks 数组的最后一个 block 加 cache_control(若 cacheControl 存在)。
 *
 * Anthropic 缓存粒度:cache marker 标在 block 上,从开头到该 block 全部进缓存。
 * 在 message 的最后一个 block 标 marker 意味着"截至本 message 内容全部缓存"。
 *
 * 在原对象上 mutate(blocks 是本函数新建的局部数组,没有跨边界引用问题)。
 */
function applyCacheControlIfNeeded(
  blocks: AnthropicContentBlockParam[],
  cacheControl: CanonicalMessage['cacheControl'],
): void {
  if (!cacheControl) return
  if (blocks.length === 0) return
  const last = blocks[blocks.length - 1]!
  // TS narrow:不是所有 ContentBlockParam 都允许 cache_control,但实际所有「常见
  // block params」(text / image / tool_use / tool_result / thinking)都支持。
  // 用 any 这边绕过 TS 严格 narrow;运行时所有 union member 都接受 cache_control。
  ;(last as { cache_control?: EphemeralCacheControl }).cache_control = EPHEMERAL
}

/**
 * canonical ToolDef → Anthropic Tool。
 *
 * input_schema 走 sanitization 去除 Anthropic 不支持的 JSON Schema 字段
 * (oneOf / allOf / anyOf / not / $ref)。
 */
export function toAnthropicTools(tools: ToolDef[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: sanitizeForAnthropic(t.inputSchema) as Anthropic.Messages.Tool['input_schema'],
  }))
}

/**
 * 递归遍历 JSON Schema tree,drop Anthropic 不支持的字段:
 * - `oneOf` / `allOf` / `anyOf` / `not`:Anthropic 严格子集不接受
 * - `$ref`:Anthropic 不解析 $ref(schema 必须 inline 化)
 *
 * 每次 drop console.warn 让开发者知道哪个 tool 哪个字段被剪。
 *
 * 不变量:`type` / `properties` / `required` / `items` / `description` /
 * `enum` / `default` / `format` / `pattern` / `minimum` / `maximum` /
 * `minLength` / `maxLength` / `minItems` / `maxItems` 等基础字段保留。
 *
 * 复杂的 nested 处理:properties / items / definitions 内部的 schema 也递归过一遍。
 */
export function sanitizeForAnthropic(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(schema, '')
}

const DROP_FIELDS = ['oneOf', 'allOf', 'anyOf', 'not', '$ref'] as const

function sanitizeNode(node: unknown, path: string): Record<string, unknown> {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    // 非 object → 不可能含 schema 字段,但 caller 传 array 也兜底,转回去
    return node as Record<string, unknown>
  }
  const src = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(src)) {
    if ((DROP_FIELDS as readonly string[]).includes(key)) {
      console.warn(
        `[to-anthropic] dropping unsupported schema field "${key}" at "${path || '(root)'}" — Anthropic input_schema 不支持`,
      )
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      // properties:{ name: schema } 递归每个 property
      const props: Record<string, unknown> = {}
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] = sanitizeNode(propVal, `${path}.properties.${propKey}`)
      }
      out[key] = props
    } else if ((key === 'items' || key === 'additionalProperties') && value && typeof value === 'object' && !Array.isArray(value)) {
      // items:可能是单 schema 或 schema 数组;additionalProperties 同 schema
      out[key] = sanitizeNode(value, `${path}.${key}`)
    } else if (key === 'definitions' && value && typeof value === 'object') {
      // definitions 块同 properties 递归
      const defs: Record<string, unknown> = {}
      for (const [defKey, defVal] of Object.entries(value as Record<string, unknown>)) {
        defs[defKey] = sanitizeNode(defVal, `${path}.definitions.${defKey}`)
      }
      out[key] = defs
    } else {
      out[key] = value
    }
  }
  return out
}
