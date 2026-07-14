import type {
  ApplyImageStyleRequest,
  ApplyImageStyleResponse,
  ExploreImageStylesResponse,
  ImageStyleLibraryResponse,
  SaveImageStylePresetRequest,
  SaveImageStylePresetResponse,
} from '@big-ppt/shared'
import { api } from './client'

export type ImageStyleSource = ApplyImageStyleRequest['source']

export async function fetchImageStyleLibrary(deckId: number): Promise<ImageStyleLibraryResponse> {
  return api.get<ImageStyleLibraryResponse>(`/api/decks/${deckId}/style-library`)
}

export async function applyImageStyle(
  deckId: number,
  input: ApplyImageStyleRequest,
): Promise<ApplyImageStyleResponse> {
  return api.post<ApplyImageStyleResponse>(`/api/decks/${deckId}/style-library/apply`, input)
}

export async function useFreeImageStyle(deckId: number): Promise<void> {
  await api.post(`/api/decks/${deckId}/style-library/free`)
}

export async function exploreImageStyles(deckId: number): Promise<ExploreImageStylesResponse> {
  return api.post<ExploreImageStylesResponse>(`/api/decks/${deckId}/style-library/explore`)
}

export async function saveImageStyle(
  deckId: number,
  input: SaveImageStylePresetRequest,
): Promise<SaveImageStylePresetResponse> {
  return api.post<SaveImageStylePresetResponse>(`/api/decks/${deckId}/style-library/save`, input)
}

export async function renameImageStylePreset(presetId: string, name: string): Promise<void> {
  await api.patch(`/api/style-presets/${encodeURIComponent(presetId)}`, { name })
}

export async function deleteImageStylePreset(presetId: string): Promise<void> {
  await api.delete(`/api/style-presets/${encodeURIComponent(presetId)}`)
}
