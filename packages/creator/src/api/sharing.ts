import type { ShareLinkInfo } from '@big-ppt/shared'
import { api } from './client'

export async function getDeckShare(deckId: number): Promise<ShareLinkInfo | null> {
  const response = await api.get<{ share: ShareLinkInfo | null }>(`/api/decks/${deckId}/share`)
  return response.share
}

export async function createDeckShare(
  deckId: number,
  expiresInDays: number | null,
): Promise<ShareLinkInfo> {
  const response = await api.post<{ share: ShareLinkInfo }>(`/api/decks/${deckId}/share`, {
    expiresInDays,
  })
  return response.share
}

export async function revokeDeckShare(deckId: number): Promise<void> {
  await api.delete(`/api/decks/${deckId}/share`)
}
