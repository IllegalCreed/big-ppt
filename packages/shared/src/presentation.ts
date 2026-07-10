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
