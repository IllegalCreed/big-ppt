/**
 * Phase 12 Task F:deck_chats 双向 helper (DB row ↔ canonical Block[])。
 *
 * 历史:
 * - Phase 5 起 deck_chats row shape:`{role, content: string, toolCallId: string | null}`
 *   assistant content 入库时是 OpenAI delta shape JSON 字符串 `{content?, tool_calls?}`;
 *   tool content 是 tool result 文本,toolCallId 单独字段;user / system 是纯文本。
 * - Phase 12 Task F 起加 `canonicalContent` 列(JSON Block[]);新插入双写新旧字段,
 *   读路径优先 canonicalContent。老 row 由 migration script 一次性回填,**或**读路径
 *   `legacyRowToCanonical()` fallback 重组(脚本未跑过的兼容期)。
 *
 * 设计:
 * - `rowToCanonical()`:统一读入口,canonicalContent ? JSON.parse : legacy fallback。
 *   所有 selecting deckChats 的 caller 走这函数,不暴露双 shape 给业务层。
 * - `canonicalToRow()`:统一写入口,把 CanonicalMessage 拍成 {content, toolCallId, canonicalContent}
 *   三元组写库;老字段保留供历史 reader / migration GC 期 fallback。
 * - 老字段填值策略:
 *   - `content`:Block[] 里所有 text + tool_result.content 串拼接(无分隔符,简单 lossy
 *     便于 grep 但保不住结构;无所谓,canonicalContent 才是 source of truth)
 *   - `toolCallId`:Block[] 里第一个 tool_use.id 或 tool_result.toolUseId(老 reader 仍能拿到)
 */

import type { CanonicalMessage, Block, CanonicalRole } from './types.js'

/**
 * 解析 DB row 成 canonical message。
 *
 * 优先用新 canonicalContent 字段(已通过 migration 或本 row 是双写期新插入);
 * 缺则 fallback 解析老 content + toolCallId 字段重组 Block[]。
 */
export function rowToCanonical(row: {
  role: string
  content: string
  toolCallId: string | null
  canonicalContent: string | null
}): CanonicalMessage {
  if (row.canonicalContent) {
    let parsed: unknown
    try {
      parsed = JSON.parse(row.canonicalContent)
    } catch {
      // canonicalContent 损坏(理论不应发生 —— 双写期都是我们自己 JSON.stringify 的)。
      // 容错降级到 legacy 路径,而非抛错让整个 chat history fetch 失败。
      return legacyRowToCanonical(row)
    }
    if (!Array.isArray(parsed)) {
      return legacyRowToCanonical(row)
    }
    return {
      role: row.role as CanonicalRole,
      content: parsed as Block[],
    }
  }
  return legacyRowToCanonical(row)
}

/**
 * 老 shape row 重组为 canonical Block[]。
 *
 * 4 类历史 row 形态:
 * - `role: 'tool'`:content = tool result 文本;toolCallId = tool call id。
 *   → `[{ type: 'tool_result', toolUseId, content }]`
 * - `role: 'assistant'`,content = OpenAI delta JSON `{content?, tool_calls?}`:
 *   → text + tool_use blocks(顺序:text 在前,tool_calls 依次)
 * - `role: 'assistant'`,content = 纯文本(老 turn 没走 tool):
 *   → `[{ type: 'text', text: content }]`
 * - `role: 'user' | 'system'`:content = 纯文本(前端 frontend 入库形态)
 *   → `[{ type: 'text', text: content }]`
 *
 * Why 单独 export 给 migration script:script 不 import dist 的 chat-row,直接复用本
 * pure-function 逻辑跑老 row → canonical 填回 canonical_content 列。
 */
export function legacyRowToCanonical(row: {
  role: string
  content: string
  toolCallId: string | null
}): CanonicalMessage {
  const role = row.role as CanonicalRole
  if (role === 'tool') {
    return {
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          toolUseId: row.toolCallId ?? '',
          content: row.content,
        },
      ],
    }
  }
  if (role === 'assistant') {
    // 试 parse content 为 OpenAI delta shape;失败 fallback 纯文本
    try {
      const parsed = JSON.parse(row.content) as {
        content?: string | null
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
      }
      // 判断:必须是 object 且至少有 content 或 tool_calls 字段才算 OpenAI shape;
      // 否则可能是用户写的 JSON 字符串(如 `"{}"`)误判,降级纯文本
      const looksLikeOpenAIShape =
        parsed !== null &&
        typeof parsed === 'object' &&
        ('content' in parsed || 'tool_calls' in parsed)
      if (!looksLikeOpenAIShape) {
        return { role: 'assistant', content: [{ type: 'text', text: row.content }] }
      }
      const blocks: Block[] = []
      if (parsed.content) {
        blocks.push({ type: 'text', text: parsed.content })
      }
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        for (const tc of parsed.tool_calls) {
          let input: unknown
          try {
            input = JSON.parse(tc.function.arguments)
          } catch {
            input = tc.function.arguments
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
      }
      return {
        role: 'assistant',
        content: blocks.length > 0 ? blocks : [{ type: 'text', text: row.content }],
      }
    } catch {
      // content 不是 JSON,按纯文本
      return { role: 'assistant', content: [{ type: 'text', text: row.content }] }
    }
  }
  // user / system: content 当 text
  return { role, content: [{ type: 'text', text: row.content }] }
}

/**
 * canonical message → DB row 三元组(双写期同时写新旧字段)。
 *
 * - 老字段 `content`:Block[] 内 text + tool_result 拍平串拼;老 reader 看到的近似全文。
 * - 老字段 `toolCallId`:首个 tool_result.toolUseId(role='tool')或 tool_use.id(assistant)。
 *   无 tool block 时填 null。
 * - 新字段 `canonicalContent`:Block[] 完整 JSON 序列化;canonical 读路径唯一权威字段。
 */
export function canonicalToRow(msg: CanonicalMessage): {
  content: string
  toolCallId: string | null
  canonicalContent: string
} {
  return {
    content: flattenTextBlocks(msg.content),
    toolCallId: extractFirstToolCallId(msg),
    canonicalContent: JSON.stringify(msg.content),
  }
}

function flattenTextBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_result') {
        return typeof b.content === 'string' ? b.content : flattenTextBlocks(b.content)
      }
      return ''
    })
    .join('')
}

function extractFirstToolCallId(msg: CanonicalMessage): string | null {
  for (const b of msg.content) {
    if (b.type === 'tool_result') return b.toolUseId || null
    if (b.type === 'tool_use') return b.id
  }
  return null
}
