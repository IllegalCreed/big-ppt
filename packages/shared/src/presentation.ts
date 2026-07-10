export interface PresentationPayload {
  deckId: number
  title: string
  templateId: string
  markdown: string
  updatedAt: string
}

export type ShareLinkStatus = 'active' | 'expired' | 'revoked'

export interface ShareLinkInfo {
  slug: string
  path: string
  status: ShareLinkStatus
  expiresAt: string | null
  revokedAt: string | null
  accessCount: number
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PublicShareErrorCode = 'not-found' | 'expired' | 'revoked'

export type BlackoutMode = 'none' | 'black' | 'white'
export type DrawingTool = 'pen' | 'highlighter'

export interface DrawingPoint {
  x: number
  y: number
}

export interface DrawingStroke {
  id: string
  tool: DrawingTool
  color: string
  width: number
  points: DrawingPoint[]
}

export type SlideDrawings = Record<number, DrawingStroke[]>

export interface PresentationSnapshot {
  page: number
  blackout: BlackoutMode
  drawings: SlideDrawings
}

export const DRAWING_VIEWBOX_WIDTH = 1000
export const DRAWING_VIEWBOX_HEIGHT = 562.5

export interface LivePresentationInfo {
  token: string
  path: string
  createdAt: string
  expiresAt: string
}

export interface LivePresentationViewPayload {
  presentation: PresentationPayload
  state: PresentationSnapshot
  revision: number
  expiresAt: string
}

export type LivePresentationEndReason = 'ended' | 'expired' | 'replaced'

export type LivePresentationEvent =
  | { type: 'state'; state: PresentationSnapshot; revision: number }
  | { type: 'ended'; reason: LivePresentationEndReason }

export type PublicLiveErrorCode = 'not-found' | 'ended' | 'expired'
