/** Phase 12.7 Task C: agent_end 后 batch 写 deck_chats（pi-agent-core 已 delta,直接全量 insert）。 */
import { getDb } from '../../db/client.js'
import { deckChats } from '../../db/schema.js'
import { canonicalToRow } from '../chat-row.js'
import type { CanonicalMessage } from '../types.js'

/**
 * 把本轮新增 canonical messages 批量 insert 到 deck_chats。
 *
 * **入参语义**：`newMessages` 是 pi-agent-core agent_end 事件的 `messages` 字段,
 * agent-loop.js 内部已经只传本轮 newMessages (不是 state 全量) —— 2026-05-16
 * dogfood 踩坑修正:Task C 原实现按「allMessages + existingCount slice」假设走,
 * 实际 pi-agent-core 给的就是 delta,导致 `length <= existingCount` 误触发 no-op
 * 跳过 insert,deck_chats 永远只剩 history loader 看见的旧行。
 */
export async function persistTurnToDeckChats(
  deckId: number,
  newMessages: CanonicalMessage[],
): Promise<void> {
  if (newMessages.length === 0) return

  const rows = newMessages.map((m) => {
    const { content, toolCallId, canonicalContent } = canonicalToRow(m)
    return { deckId, role: m.role, content, toolCallId, canonicalContent }
  })
  const db = getDb()

  await db.transaction(async (tx) => {
    await tx.insert(deckChats).values(rows)
  })
}
