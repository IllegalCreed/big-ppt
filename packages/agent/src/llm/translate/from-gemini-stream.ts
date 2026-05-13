/**
 * Phase 12 Task H:Gemini streaming events → AsyncIterable<CanonicalEvent>。
 *
 * **Gemini streaming protocol**(SDK `generateContentStream` 返
 * AsyncGenerator<GenerateContentResponse>):
 *
 *   每个 GenerateContentResponse 含:
 *   - `candidates: [{ content: { parts, role? }, finishReason?, ... }]`(通常 1 个 candidate)
 *   - `usageMetadata?: { promptTokenCount, candidatesTokenCount, totalTokenCount,
 *      cachedContentTokenCount? }`
 *
 *   parts 数组遍历:
 *   - `{ text }` → 累积 emit `text.delta`
 *   - `{ functionCall: { name, args } }` → 一次性 emit `tool_call.start` + `tool_call.delta` +
 *     `tool_call.end`(Gemini 不分片,每个 chunk 的 functionCall 都是完整 name + args)
 *   - `{ thought: true, text }` → emit `thinking.delta`(SDK 用 `thought: boolean` 标记)
 *   - 其它 part 类型(inlineData / functionResponse / codeExecutionResult 等):silent drop
 *
 *   最后 chunk 含 finishReason → emit `finish` event with usage。
 *
 * **id 生成**:Gemini functionCall 没有原生 id 字段(OpenAI/Anthropic 有);为了 canonical
 * 一致性,自己生成 id `gemini-fc-<hex>-<name>`,这样:
 * - to-gemini.ts 翻译 functionResponse 时可以反向从 id 抽 name
 * - frontend 可以匹配 tool_use 跟 tool_result(虽然实际 round-trip 用 name 匹配)
 *
 * **cache.hit 事件**:`usageMetadata.cachedContentTokenCount > 0` 时 emit。
 * `cachedTokens = cachedContentTokenCount`,`costTokens = promptTokenCount`(实际付费 input)。
 * **注意**:Gemini 的 cached content 需要 explicitly 创建(`client.caches.create()`),
 * dogfood 期间可能从来不会非 0。但翻译层处理这种情况让未来开通缓存时零修改。
 *
 * **finishReason 映射**(`FinishReason` enum 来自 SDK):
 * - 'STOP'                    → 'stop'
 * - 'MAX_TOKENS'              → 'length'
 * - 'SAFETY'                  → 'content_filter'
 * - 'PROHIBITED_CONTENT'      → 'content_filter'
 * - 'SPII'                    → 'content_filter'
 * - 'BLOCKLIST'               → 'content_filter'
 * - 'RECITATION'              → 'content_filter'(版权/引用导致)
 * - 'IMAGE_SAFETY'            → 'content_filter'
 * - 'IMAGE_PROHIBITED_CONTENT'→ 'content_filter'
 * - 'IMAGE_RECITATION'        → 'content_filter'
 * - 'LANGUAGE'                → 'content_filter'(语言违规)
 * - 'MALFORMED_FUNCTION_CALL' → 'tool_use'(模型尝试 tool call 但 JSON 错;canonical
 *                                视为 tool_use 让 caller 拿到 stop_reason 后再处理)
 * - 'UNEXPECTED_TOOL_CALL'    → 'tool_use'
 * - 'OTHER' / 'NO_IMAGE' / 'IMAGE_OTHER' / 未知 → 'stop' 兜底
 *
 * **状态机**:每个 chunk 的 functionCall 都是完整的,所以不需要跨 chunk 状态追踪 ——
 * 见到一个 emit 一组 start/delta/end。text part 累积成单个 logical text block(canonical
 * 只关心 delta 流,LLM 端如何切片不影响 canonical 表达)。
 */

import { FinishReason as GeminiFinishReason } from '@google/genai'
import type { GenerateContentResponse, Part } from '@google/genai'
import type { CanonicalEvent, FinishReason, TokenUsage } from '../types.js'

/**
 * Gemini stream → canonical event 流。
 *
 * 状态:累积 usage(每个 chunk 的 usageMetadata 是**累计**值,后续 chunk 覆盖前面)。
 */
export async function* fromGeminiStream(
  stream: AsyncIterable<GenerateContentResponse>,
): AsyncGenerator<CanonicalEvent> {
  let stopReason: FinishReason = 'stop'
  let usage: TokenUsage = { input: 0, output: 0 }
  let cacheHitEmitted = false

  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0]
    const parts: Part[] = candidate?.content?.parts ?? []

    for (const part of parts) {
      // thinking part:SDK 用 `thought: boolean` 标记
      if (part.thought === true && typeof part.text === 'string') {
        yield { type: 'thinking.delta', text: part.text }
        continue
      }
      // text part
      if (typeof part.text === 'string' && part.text.length > 0) {
        yield { type: 'text.delta', text: part.text }
        continue
      }
      // functionCall part:Gemini 每个 chunk 的 functionCall 都是完整的
      if (part.functionCall && part.functionCall.name) {
        const name = part.functionCall.name
        const args = part.functionCall.args ?? {}
        const id = generateFunctionCallId(name)
        yield { type: 'tool_call.start', id, name }
        yield { type: 'tool_call.delta', id, argsChunk: JSON.stringify(args) }
        yield { type: 'tool_call.end', id }
        continue
      }
      // inlineData / functionResponse / codeExecutionResult 等:canonical 没对应 emit 类型,silent drop
    }

    // usage:每个 chunk 的 usageMetadata 是累计值,后续覆盖
    const u = chunk.usageMetadata
    if (u) {
      const input = u.promptTokenCount ?? 0
      const output = u.candidatesTokenCount ?? 0
      const cached = u.cachedContentTokenCount ?? 0
      usage = { input, output }
      if (cached > 0) {
        usage.cached = cached
        if (!cacheHitEmitted) {
          cacheHitEmitted = true
          yield { type: 'cache.hit', cachedTokens: cached, costTokens: input }
        }
      }
    }

    // finishReason:某个 chunk 上一旦出现就是收尾标记
    if (candidate?.finishReason) {
      stopReason = mapFinishReason(candidate.finishReason)
    }
  }

  yield { type: 'finish', reason: stopReason, usage }
}

/**
 * 生成 canonical 端的 functionCall id。
 *
 * 格式 `gemini-fc-<8hex>-<name>`:
 * - 前缀 `gemini-fc-` 让来源可识别
 * - 8 字符 hex 提供唯一性(碰撞概率极低)
 * - 末尾跟 name,让 to-gemini.ts 的 extractFunctionName 能反向抽出
 *
 * 单测可注入 `_idSourceForTesting` 让结果确定性。
 */
function generateFunctionCallId(name: string): string {
  const hex = _idSource()
  return `gemini-fc-${hex}-${name}`
}

/**
 * @internal id 来源函数,测试可覆盖让 id 确定性。
 * 默认走 crypto.randomBytes(4).toString('hex'),8 字符 hex。
 */
let _idSource: () => string = () => {
  // 动态 require 在模块顶层 import 节点 crypto;避免 ESM 顶层耦合(测试覆盖时改 _idSource)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto')
  return randomBytes(4).toString('hex')
}

/**
 * @internal 仅测试用:注入确定性 id 来源(每次返同串)。
 * 传 null 恢复默认 crypto.randomBytes。
 */
export function __setIdSourceForTesting(fn: (() => string) | null): void {
  if (fn === null) {
    _idSource = () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { randomBytes } = require('node:crypto') as typeof import('node:crypto')
      return randomBytes(4).toString('hex')
    }
  } else {
    _idSource = fn
  }
}

/**
 * Gemini FinishReason → canonical FinishReason。
 *
 * 详细映射见模块头注释。
 */
function mapFinishReason(reason: GeminiFinishReason | string): FinishReason {
  switch (reason) {
    case GeminiFinishReason.STOP:
      return 'stop'
    case GeminiFinishReason.MAX_TOKENS:
      return 'length'
    case GeminiFinishReason.SAFETY:
    case GeminiFinishReason.PROHIBITED_CONTENT:
    case GeminiFinishReason.SPII:
    case GeminiFinishReason.BLOCKLIST:
    case GeminiFinishReason.RECITATION:
    case GeminiFinishReason.IMAGE_SAFETY:
    case GeminiFinishReason.IMAGE_PROHIBITED_CONTENT:
    case GeminiFinishReason.IMAGE_RECITATION:
    case GeminiFinishReason.LANGUAGE:
      return 'content_filter'
    case GeminiFinishReason.MALFORMED_FUNCTION_CALL:
    case GeminiFinishReason.UNEXPECTED_TOOL_CALL:
      return 'tool_use'
    case GeminiFinishReason.OTHER:
    case GeminiFinishReason.NO_IMAGE:
    case GeminiFinishReason.IMAGE_OTHER:
    case GeminiFinishReason.FINISH_REASON_UNSPECIFIED:
      return 'stop'
    default:
      return 'stop'
  }
}
