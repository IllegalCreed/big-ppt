<script setup lang="ts">
import type {
  LivePresentationEvent,
  LivePresentationViewPayload,
  PublicLiveErrorCode,
} from '@big-ppt/shared'
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { api, ApiError } from '../api/client'
import LiveAudienceViewer from '../presentation/LiveAudienceViewer.vue'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'
type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: PublicLiveErrorCode | 'unknown'; message: string }
  | { kind: 'ended'; message: string }
  | { kind: 'ready'; live: LivePresentationViewPayload }

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))
const state = ref<State>({ kind: 'loading' })
const connectionState = ref<ConnectionState>('connecting')
let source: EventSource | null = null
let probeTimer: ReturnType<typeof setTimeout> | null = null
let loadToken = 0

function publicError(cause: unknown): { code: PublicLiveErrorCode | 'unknown'; message: string } {
  const body = cause instanceof ApiError ? (cause.body as { code?: PublicLiveErrorCode }) : null
  const code = body?.code ?? 'unknown'
  const messages: Record<PublicLiveErrorCode | 'unknown', string> = {
    'not-found': '这个直播链接不存在',
    ended: '直播已结束',
    expired: '直播已过期',
    unknown: cause instanceof Error ? cause.message : '直播内容加载失败',
  }
  return { code, message: messages[code] }
}

function closeEvents(): void {
  source?.close()
  source = null
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = null
}

function applyEvent(event: LivePresentationEvent): void {
  if (event.type === 'ended') {
    closeEvents()
    state.value = {
      kind: 'ended',
      message: event.reason === 'expired' ? '直播已过期' : '直播已结束',
    }
    return
  }
  if (state.value.kind !== 'ready' || event.revision < state.value.live.revision) return
  state.value = {
    kind: 'ready',
    live: { ...state.value.live, state: event.state, revision: event.revision },
  }
}

function parseEvent(event: MessageEvent<string>): LivePresentationEvent | null {
  try {
    const value = JSON.parse(event.data) as LivePresentationEvent
    return value?.type === 'state' || value?.type === 'ended' ? value : null
  } catch {
    return null
  }
}

async function probeStatus(expectedToken: string): Promise<void> {
  try {
    const response = await api.get<{ live: LivePresentationViewPayload }>(
      `/api/live/${encodeURIComponent(expectedToken)}/presentation`,
    )
    if (token.value !== expectedToken || state.value.kind !== 'ready') return
    if (response.live.revision >= state.value.live.revision) {
      state.value = { kind: 'ready', live: response.live }
    }
  } catch (cause) {
    if (token.value !== expectedToken) return
    const failure = publicError(cause)
    if (failure.code !== 'unknown') {
      closeEvents()
      state.value = {
        kind: 'ended',
        message: failure.code === 'not-found' ? '直播连接已结束' : failure.message,
      }
    }
  }
}

function connectEvents(expectedToken: string): void {
  closeEvents()
  connectionState.value = 'connecting'
  const nextSource = new EventSource(`/api/live/${encodeURIComponent(expectedToken)}/events`)
  source = nextSource
  nextSource.onopen = () => {
    if (source === nextSource) connectionState.value = 'connected'
  }
  nextSource.addEventListener('state', (rawEvent) => {
    const event = parseEvent(rawEvent as MessageEvent<string>)
    if (event) applyEvent(event)
  })
  nextSource.addEventListener('ended', (rawEvent) => {
    const event = parseEvent(rawEvent as MessageEvent<string>)
    if (event) applyEvent(event)
  })
  nextSource.onerror = () => {
    if (source !== nextSource || state.value.kind !== 'ready') return
    connectionState.value = 'reconnecting'
    if (!probeTimer) {
      probeTimer = setTimeout(() => {
        probeTimer = null
        void probeStatus(expectedToken)
      }, 2200)
    }
  }
}

async function load(): Promise<void> {
  const expectedToken = token.value
  const requestToken = ++loadToken
  closeEvents()
  state.value = { kind: 'loading' }
  try {
    const response = await api.get<{ live: LivePresentationViewPayload }>(
      `/api/live/${encodeURIComponent(expectedToken)}/presentation`,
    )
    if (requestToken !== loadToken || expectedToken !== token.value) return
    state.value = { kind: 'ready', live: response.live }
    connectEvents(expectedToken)
  } catch (cause) {
    if (requestToken !== loadToken) return
    const failure = publicError(cause)
    state.value = { kind: 'error', ...failure }
  }
}

onMounted(() => void load())
watch(token, () => void load())

watchEffect(() => {
  const title = state.value.kind === 'ready' ? state.value.live.presentation.title : '直播观看'
  document.title = `${title} · Lumideck 直播`
})

onBeforeUnmount(() => {
  loadToken++
  closeEvents()
  document.title = 'Lumideck · 幻光千叶'
})
</script>

<template>
  <div v-if="state.kind === 'loading'" class="live-state">连接直播...</div>
  <div v-else-if="state.kind === 'error'" class="live-state error" :data-error-code="state.code">
    <h1>Lumideck</h1>
    <p>{{ state.message }}</p>
  </div>
  <div v-else-if="state.kind === 'ended'" class="live-state ended" data-live-ended>
    <h1>{{ state.message }}</h1>
  </div>
  <LiveAudienceViewer
    v-else
    :presentation="state.live.presentation"
    :snapshot="state.live.state"
    :connection-state="connectionState"
  />
</template>

<style scoped>
.live-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  background: #121416;
  color: #f4f4f2;
  text-align: center;
  font-family: var(--font-sans);
}

.live-state h1,
.live-state p {
  margin: 0;
}

.live-state h1 {
  font-size: 24px;
  letter-spacing: 0;
}

.live-state p {
  color: rgba(255, 255, 255, 0.68);
}

.live-state.error {
  color: #f4b4a2;
}
</style>
