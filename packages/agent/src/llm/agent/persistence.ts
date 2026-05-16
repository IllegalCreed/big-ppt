/** Phase 12.7 Task C: agent_end 后 batch 写 deck_chats（slice 出本 turn 增量,单 transaction 失败回滚）。 */
import { getDb } from '../../db/client.js'
import { deckChats } from '../../db/schema.js'
import { canonicalToRow } from '../chat-row.js'
import type { CanonicalMessage } from '../types.js'

export async function persistTurnToDeckChats(
  deckId: number,
  allMessages: CanonicalMessage[],
  existingCount: number,
): Promise<void> {
  if (allMessages.length <= existingCount) return

  const newMessages = allMessages.slice(existingCount)
  const db = getDb()

  await db.transaction(async (tx) => {
    for (const m of newMessages) {
      const { content, toolCallId, canonicalContent } = canonicalToRow(m)
      await tx.insert(deckChats).values({
        deckId,
        role: m.role,
        content,
        toolCallId,
        canonicalContent,
      })
    }
  })
}
