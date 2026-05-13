/**
 * Phase 12 Task H:CanonicalMessage[] → Gemini { systemInstruction, contents }。
 *
 * Gemini 协议跟 OpenAI / Anthropic 差异较大,关键点:
 *
 * 1. **roles**:只有 `'user'` 和 `'model'`(不是 'assistant')。canonical 'assistant'
 *    → Gemini 'model'。**没有 'system' role** —— 系统消息单独走 `config.systemInstruction`
 *    顶层字段(`Content` shape:`{ parts: [{ text }] }`)。**没有 'tool' role** ——
 *    `functionResponse` 是 'user' role 下的一个 part。
 *
 * 2. **content shape**:每条 `Content { role, parts: Part[] }`。Part 类型:
 *    - `{ text: string }` —— canonical TextBlock
 *    - `{ inlineData: { mimeType, data } }` —— canonical ImageBlock(data 是 base64 串)
 *    - `{ functionCall: { name, args } }` —— canonical ToolUseBlock(assistant only)
 *    - `{ functionResponse: { name, response } }` —— canonical ToolResultBlock。
 *      `response` **必须是 object 不能是 string**(Gemini API spec);string content
 *      会被包成 `{ content: 'string text' }`。
 *
 * 3. **systemInstruction**:取第一条 role:'system' message,把所有 text blocks 拼成
 *    `{ parts: [{ text: '<concat>' }] }`。后续 system messages silent drop(跟 Anthropic
 *    一致)。`cacheControl` 字段在 Gemini 没有等价语义 —— silent drop(canonical 设计
 *    上允许这种 best-effort 降级,plan §Task H 风险评估)。
 *
 * 4. **tool_result 匹配方式**:Gemini 用 `name` 匹配 functionResponse 跟之前 functionCall,
 *    **不**用 id。canonical 的 toolUseId 在翻译时丢失,但 canonical 跨 provider 一致性
 *    需要 id —— 这条 mismatch 在 from-gemini-stream 生成 id 时补偿(参考那边的实现)。
 *    Gemini 端只要 name + response 能对得上即可。
 *
 *    问题:canonical ToolResultBlock 只有 toolUseId,没有 name。怎么知道对应的 function
 *    name?方案:**translate 时从同消息的上下文找不到 name → 把 toolUseId 直接当 name 传**。
 *    实际场景下 caller(canonical layer)应该已经把 functionCall 的 name 写进 toolUseId
 *    串(from-gemini-stream 生成 id `gemini-fc-<hex>-<name>`),翻译层从 id 抽取 name 即可。
 *
 * 5. **structured output 跟 tools 互斥**:Gemini API spec —— responseSchema 跟
 *    functionDeclarations 不能同时启用(API 会返 400)。canonical request 若同时
 *    传 tools + structuredOutput,本翻译层让 **tools 优先**,structuredOutput silent
 *    drop + console.warn(plan §Task H 技术细节 #6)。
 *
 * 6. **thinking blocks**:Gemini SDK 当前 `Part.thought: boolean` 字段是返回端的标记
 *    (服务端告诉客户端"这部分是思考"),**输入端不接受 canonical ThinkingBlock**
 *    (Gemini API 不允许客户端注入思考内容)。canonical assistant.content 里的
 *    ThinkingBlock 在 translate 时 **silent drop + warning**(plan §Task H 技术细节 #5)。
 *
 * 7. **schema sanitization**:Gemini Schema 是 OpenAPI 3.0.3 select 子集,**不支持
 *    additionalProperties / $ref**(跟 Anthropic 不同 —— Anthropic 不接受 oneOf 但
 *    接受 additionalProperties)。Gemini 通过 `parametersJsonSchema` 字段可以传完整
 *    JSON Schema,但需要 SDK 支持 + provider 端开通,稳妥起见走 `parameters` 字段 +
 *    sanitize 路径。drop 字段:`additionalProperties` / `$ref` / `oneOf`(后两个跟
 *    Anthropic 一致;Gemini 实际支持 oneOf 跟 anyOf 别名,但 canonical 跨 provider 兼容
 *    下统一 drop)。
 */

import type { Content, FunctionDeclaration, Part, Tool } from '@google/genai'
import { assertNever, type Block, type CanonicalMessage, type ToolDef } from '../types.js'

/**
 * canonical messages → Gemini input(systemInstruction + contents 二元组)。
 *
 * - 第一条 role:'system' message 抽出来变 systemInstruction Content(后续 system silent drop)
 * - 其余翻译成 Gemini Content 数组(role:'user'/'model')
 * - role:'tool' message 走 user role + functionResponse parts 通道
 *
 * 设计跟 Anthropic 一致:跨包语义最大限度 1:1,thinking / 不支持的 block 类型 silent drop。
 */
export function toGeminiInput(messages: CanonicalMessage[]): {
  systemInstruction?: Content
  contents: Content[]
} {
  let systemInstruction: Content | undefined
  const contents: Content[] = []
  let systemSeen = false

  for (const msg of messages) {
    switch (msg.role) {
      case 'system': {
        if (systemSeen) break // Gemini 只接受单个 systemInstruction,后续 silent drop
        systemSeen = true
        const sys = translateSystem(msg)
        if (sys !== undefined) systemInstruction = sys
        break
      }
      case 'user': {
        const c = translateUser(msg)
        if (c) contents.push(c)
        break
      }
      case 'assistant': {
        const c = translateAssistant(msg)
        if (c) contents.push(c)
        break
      }
      case 'tool': {
        // canonical role:'tool' 在 Gemini 协议下是 user role 含 functionResponse parts
        const c = translateToolMessage(msg)
        if (c) contents.push(c)
        break
      }
      default:
        return assertNever(msg.role)
    }
  }

  return systemInstruction === undefined
    ? { contents }
    : { systemInstruction, contents }
}

/**
 * system message 翻译:
 * - 取 text blocks 拼成 systemInstruction 的 parts:[{text}]
 * - 全空 / 无 text → undefined
 *
 * 非 text blocks(image / thinking / tool_*)在 system 下没合法语义,silent drop。
 * `cacheControl` Gemini 没等价机制,silent drop(canonical 允许 best-effort 降级)。
 */
function translateSystem(msg: CanonicalMessage): Content | undefined {
  const text = msg.content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
  if (text.length === 0) return undefined
  return { role: 'user', parts: [{ text }] }
}

function translateUser(msg: CanonicalMessage): Content | null {
  const parts = translateUserParts(msg.content)
  if (parts.length === 0) return null
  return { role: 'user', parts }
}

/**
 * canonical user.content → Gemini user parts。
 *
 * - text / image 保留
 * - tool_result blocks → functionResponse parts(Gemini user role 才能装)
 * - thinking / tool_use 不属 user role,silent drop
 */
function translateUserParts(blocks: Block[]): Part[] {
  const out: Part[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push({ text: block.text })
        break
      case 'image':
        out.push({
          inlineData: {
            mimeType: block.mediaType,
            data: block.dataBase64,
          },
        })
        break
      case 'tool_result':
        out.push(translateToolResultPart(block))
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

function translateAssistant(msg: CanonicalMessage): Content | null {
  const parts = translateAssistantParts(msg.content)
  if (parts.length === 0) return null
  return { role: 'model', parts }
}

/**
 * canonical assistant.content → Gemini model parts。
 *
 * - text → { text }
 * - tool_use → { functionCall: { name, args } }
 * - thinking → silent drop + warning(Gemini 输入端不接受 thinking)
 * - image / tool_result 不属 assistant role,silent drop
 */
function translateAssistantParts(blocks: Block[]): Part[] {
  const out: Part[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        out.push({ text: block.text })
        break
      case 'tool_use':
        out.push({
          functionCall: {
            name: block.name,
            args: toGeminiArgs(block.input),
          },
        })
        break
      case 'thinking':
        console.warn(
          '[to-gemini] dropping ThinkingBlock — Gemini API 输入端不接受 canonical thinking blocks',
        )
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
 * canonical role:'tool' message → Gemini user message + functionResponse parts。
 *
 * 仅保留 content 中的 tool_result blocks(text / image / 其他在 tool message 没合法语义)。
 */
function translateToolMessage(msg: CanonicalMessage): Content | null {
  const parts: Part[] = []
  for (const block of msg.content) {
    if (block.type === 'tool_result') {
      parts.push(translateToolResultPart(block))
    }
  }
  if (parts.length === 0) return null
  return { role: 'user', parts }
}

/**
 * canonical ToolResultBlock → Gemini functionResponse Part。
 *
 * 关键设计:
 * - Gemini 用 `name` 匹配,不用 id。canonical toolUseId 在 from-gemini-stream 端
 *   生成为 `gemini-fc-<hex>-<name>` 形式(见 from-gemini-stream.ts),这里从 id
 *   抽取 name;若 id 不符合格式,fallback 用 toolUseId 整串当 name(provider 端
 *   实测会按字符串匹配,运行时仍能 round-trip)。
 * - `response` 字段必须是 object;string content 包成 `{ content: '<text>' }`,
 *   Block[] content 取 text blocks 拼接同样包 `{ content }`。
 */
function translateToolResultPart(block: Extract<Block, { type: 'tool_result' }>): Part {
  const name = extractFunctionName(block.toolUseId)
  const contentStr =
    typeof block.content === 'string'
      ? block.content
      : block.content
          .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('')
  return {
    functionResponse: {
      name,
      response: { content: contentStr },
    },
  }
}

/**
 * 从 from-gemini-stream 生成的 id `gemini-fc-<hex>-<name>` 抽 name。
 * 不符合格式时 fallback 用整串当 name(SDK 仍按字符串匹配,运行时不会崩)。
 */
function extractFunctionName(toolUseId: string): string {
  const match = toolUseId.match(/^gemini-fc-[0-9a-f]+-(.+)$/)
  return match ? match[1]! : toolUseId
}

/**
 * canonical tool_use.input → Gemini functionCall.args。
 *
 * canonical input 类型是 `unknown`,Gemini 要求 `Record<string, unknown>`。
 * - object 直接传
 * - 其它类型(undefined / null / primitive / array)包成 `{ value: <x> }` 不丢信息
 */
function toGeminiArgs(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  if (input === undefined) return {}
  return { value: input }
}

/**
 * canonical ToolDef[] → Gemini Tool[](单 Tool 含 functionDeclarations 数组)。
 *
 * Gemini Tool 的形态:`[{ functionDeclarations: [decl1, decl2, ...] }]`。
 * 跟 OpenAI / Anthropic 不同 —— 一个 Tool 容器内放多个 declarations,而不是每个工具
 * 单独一个 Tool。
 */
export function toGeminiTools(tools: ToolDef[]): Tool[] {
  return [
    {
      functionDeclarations: tools.map(
        (t): FunctionDeclaration => ({
          name: t.name,
          description: t.description,
          parameters: sanitizeForGemini(t.inputSchema) as FunctionDeclaration['parameters'],
        }),
      ),
    },
  ]
}

/**
 * 递归遍历 JSON Schema tree,drop Gemini Schema 不支持的字段。
 *
 * Gemini Schema 来自 OpenAPI 3.0.3 select 子集:
 * - **不**支持:`additionalProperties` / `$ref` / `oneOf`(canonical 跨 provider 统一
 *   drop;Gemini 实际支持 oneOf 跟 anyOf 别名,但 Anthropic 不支持,统一移除让 schema
 *   在三家间最大兼容)
 * - **支持**:`type` / `properties` / `required` / `items` / `description` / `enum` /
 *   `format` / `pattern` / `minimum` / `maximum` / `minLength` / `maxLength` /
 *   `minItems` / `maxItems` / `nullable` / `default` 等
 *
 * 每次 drop console.warn 让开发者知道哪个 tool 哪个字段被剪。
 */
export function sanitizeForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  return sanitizeNode(schema, '')
}

const DROP_FIELDS = ['additionalProperties', '$ref', 'oneOf'] as const

function sanitizeNode(node: unknown, path: string): Record<string, unknown> {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return node as Record<string, unknown>
  }
  const src = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(src)) {
    if ((DROP_FIELDS as readonly string[]).includes(key)) {
      console.warn(
        `[to-gemini] dropping unsupported schema field "${key}" at "${path || '(root)'}" — Gemini Schema 不支持`,
      )
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] = sanitizeNode(propVal, `${path}.properties.${propKey}`)
      }
      out[key] = props
    } else if (key === 'items' && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = sanitizeNode(value, `${path}.${key}`)
    } else if (key === 'definitions' && value && typeof value === 'object') {
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
