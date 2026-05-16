/** Phase 12.7 Task C: 从 deck_chats 读 canonical messages 给 Agent initialState.messages。 */
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/client.js'
import { deckChats } from '../../db/schema.js'
import { rowToCanonical } from '../chat-row.js'
import type { CanonicalMessage } from '../types.js'

export async function loadDeckChatHistory(deckId: number): Promise<CanonicalMessage[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(deckChats)
    .where(eq(deckChats.deckId, deckId))
    .orderBy(deckChats.createdAt)
  return rows.map(rowToCanonical)
}
