import type { LivePresentationInfo, PresentationSnapshot } from '@big-ppt/shared'
import { api } from './client'

export async function getDeckLivePresentation(
  deckId: number,
): Promise<LivePresentationInfo | null> {
  const response = await api.get<{ live: LivePresentationInfo | null }>(`/api/decks/${deckId}/live`)
  return response.live
}

export async function startDeckLivePresentation(
  deckId: number,
  state: PresentationSnapshot,
): Promise<LivePresentationInfo> {
  const response = await api.post<{ live: LivePresentationInfo }>(`/api/decks/${deckId}/live`, {
    state,
  })
  return response.live
}

export async function updateDeckLivePresentation(
  deckId: number,
  token: string,
  state: PresentationSnapshot,
): Promise<number> {
  const response = await api.put<{ revision: number }>(
    `/api/decks/${deckId}/live/${encodeURIComponent(token)}/state`,
    { state },
  )
  return response.revision
}

export async function endDeckLivePresentation(deckId: number, token: string): Promise<boolean> {
  const response = await api.delete<{ ended: boolean }>(
    `/api/decks/${deckId}/live/${encodeURIComponent(token)}`,
  )
  return response.ended
}
