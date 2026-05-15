import type { CanonicalMessage } from '../types.js'

export async function persistTurnToDeckChats(
  _deckId: number,
  _allMessages: CanonicalMessage[],
  _existingCount: number,
): Promise<void> {
  throw new Error('Task C 实施')
}
