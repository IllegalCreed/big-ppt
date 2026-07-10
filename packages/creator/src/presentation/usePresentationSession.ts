import { getCurrentScope, onScopeDispose, ref } from 'vue'
import type {
  BlackoutMode,
  DrawingStroke,
  PresentationChannelMessage,
  PresentationSnapshot,
  SlideDrawings,
} from './types'

type WithoutSender<T> = T extends { sender: string } ? Omit<T, 'sender'> : never
type OutgoingMessage = WithoutSender<PresentationChannelMessage>

export interface PresentationSessionOptions {
  deckId: number
  channelId?: string
  initialPage?: number
  totalPages: () => number
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isBlackoutMode(value: unknown): value is BlackoutMode {
  return value === 'none' || value === 'black' || value === 'white'
}

export function usePresentationSession(options: PresentationSessionOptions) {
  const clampPage = (page: number) => {
    const total = Math.max(1, options.totalPages())
    return Math.min(total, Math.max(1, Math.trunc(page) || 1))
  }

  const currentPage = ref(clampPage(options.initialPage ?? 1))
  const blackout = ref<BlackoutMode>('none')
  const drawings = ref<SlideDrawings>({})
  const sender = createId()
  const channelName = options.channelId
    ? `lumideck-presentation-${options.deckId}-${options.channelId}`
    : null
  const channel =
    channelName && typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(channelName)
      : null

  function cloneStrokes(strokes: DrawingStroke[]): DrawingStroke[] {
    return strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    }))
  }

  function cloneDrawings(value: SlideDrawings): SlideDrawings {
    return Object.fromEntries(
      Object.entries(value).map(([page, strokes]) => [page, cloneStrokes(strokes)]),
    )
  }

  function snapshot(): PresentationSnapshot {
    return {
      page: currentPage.value,
      blackout: blackout.value,
      drawings: cloneDrawings(drawings.value),
    }
  }

  function post(message: OutgoingMessage): void {
    channel?.postMessage({ ...message, sender } as PresentationChannelMessage)
  }

  function setPage(page: number, broadcast = true): void {
    const next = clampPage(page)
    currentPage.value = next
    if (broadcast) post({ type: 'page', page: next })
  }

  function setBlackout(next: BlackoutMode, broadcast = true): void {
    blackout.value = next
    if (broadcast) post({ type: 'blackout', blackout: next })
  }

  function setStrokes(page: number, strokes: DrawingStroke[], broadcast = true): void {
    const normalizedPage = clampPage(page)
    const plainStrokes = cloneStrokes(strokes)
    drawings.value = { ...drawings.value, [normalizedPage]: plainStrokes }
    if (broadcast) post({ type: 'drawings', page: normalizedPage, strokes: plainStrokes })
  }

  function applySnapshot(state: PresentationSnapshot): void {
    setPage(state.page, false)
    if (isBlackoutMode(state.blackout)) setBlackout(state.blackout, false)
    if (state.drawings && typeof state.drawings === 'object') {
      drawings.value = cloneDrawings(state.drawings)
    }
  }

  if (channel) {
    channel.onmessage = (event: MessageEvent<PresentationChannelMessage>) => {
      const message = event.data
      if (!message || message.sender === sender) return
      switch (message.type) {
        case 'state-request':
          post({ type: 'state', state: snapshot() })
          break
        case 'state':
          applySnapshot(message.state)
          break
        case 'page':
          setPage(message.page, false)
          break
        case 'blackout':
          if (isBlackoutMode(message.blackout)) setBlackout(message.blackout, false)
          break
        case 'drawings':
          if (Array.isArray(message.strokes)) setStrokes(message.page, message.strokes, false)
          break
      }
    }
    queueMicrotask(() => post({ type: 'state-request' }))
  }

  function close(): void {
    channel?.close()
  }

  if (getCurrentScope()) onScopeDispose(close)

  return {
    currentPage,
    blackout,
    drawings,
    channelName,
    isSynchronized: channel !== null,
    setPage,
    setBlackout,
    setStrokes,
    snapshot,
    close,
  }
}
