<script setup lang="ts">
import type { PresentationPayload } from '@big-ppt/shared'
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import PresentationViewer from '../presentation/PresentationViewer.vue'
import PresenterMode from '../presentation/PresenterMode.vue'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; presentation: PresentationPayload }

const route = useRoute()
const router = useRouter()
const state = ref<State>({ kind: 'loading' })
const deckId = computed(() => Number(route.params.id))
const initialPage = computed(() => {
  const value = Number(route.query.page)
  return Number.isInteger(value) && value > 0 ? value : 1
})
const channelId = ref(
  typeof route.query.channel === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(route.query.channel)
    ? route.query.channel
    : globalThis.crypto.randomUUID(),
)
const isPresenter = computed(() => route.query.view === 'presenter')

async function load(): Promise<void> {
  const id = deckId.value
  if (!Number.isInteger(id) || id <= 0) {
    state.value = { kind: 'error', message: '非法的 deck id' }
    return
  }
  state.value = { kind: 'loading' }
  try {
    const response = await api.get<{ presentation: PresentationPayload }>(
      `/api/decks/${id}/presentation`,
    )
    state.value = { kind: 'ready', presentation: response.presentation }
  } catch (error) {
    state.value = {
      kind: 'error',
      message:
        error instanceof ApiError && error.status === 404
          ? '演示文稿不存在或无权访问'
          : error instanceof Error
            ? error.message
            : '演示文稿加载失败',
    }
  }
}

function routeFor(view: 'audience' | 'presenter', page: number): string {
  return router.resolve({
    name: 'deck-presentation',
    params: { id: deckId.value },
    query: { page, channel: channelId.value, ...(view === 'presenter' ? { view } : {}) },
  }).href
}

function presentationWindowName(view: 'audience' | 'presenter'): string {
  return `lumideck-${view}-${deckId.value}-${channelId.value}`
}

function openPresenter(page: number): void {
  window.open(
    routeFor('presenter', page),
    presentationWindowName('presenter'),
    'popup=yes,width=1440,height=900',
  )
}

function openAudience(page: number): void {
  window.open(
    routeFor('audience', page),
    presentationWindowName('audience'),
    'popup=yes,width=1280,height=720',
  )
}

function exit(): void {
  if (window.opener && !window.opener.closed) {
    window.close()
    return
  }
  void router.push(`/decks/${deckId.value}`)
}

onMounted(() => {
  void load()
})

watch(deckId, () => void load())

watchEffect(() => {
  if (state.value.kind !== 'ready') return
  const role = isPresenter.value ? '演讲者视图' : '观众窗口'
  document.title = `${role} · ${state.value.presentation.title}`
})

onBeforeUnmount(() => {
  document.title = 'Lumideck · 幻光千叶'
})
</script>

<template>
  <div v-if="state.kind === 'loading'" class="page-state">加载演示文稿...</div>
  <div v-else-if="state.kind === 'error'" class="page-state error">
    <p>{{ state.message }}</p>
    <button type="button" @click="router.push('/decks')">返回列表</button>
  </div>
  <PresenterMode
    v-else-if="isPresenter"
    :presentation="state.presentation"
    :channel-id="channelId"
    :initial-page="initialPage"
    @exit="exit"
    @open-audience="openAudience"
  />
  <PresentationViewer
    v-else
    :presentation="state.presentation"
    :channel-id="channelId"
    :initial-page="initialPage"
    @exit="exit"
    @open-presenter="openPresenter"
  />
</template>

<style scoped>
.page-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: #121416;
  color: #f4f4f2;
  font-family: var(--font-sans);
}

.page-state button {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  background: #c15f3c;
  color: #fff;
  cursor: pointer;
}

.page-state.error {
  color: #f4b4a2;
}
</style>
