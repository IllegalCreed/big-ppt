<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDecks, useDeckLock, type Deck, type DeckVersion, type LockHolderWire } from '../composables/useDecks'
import DeckEditorCanvas from '../components/DeckEditorCanvas.vue'
import OccupiedWaitingPage from '../components/OccupiedWaitingPage.vue'
import { ApiError } from '../api/client'

const route = useRoute()
const router = useRouter()
const decksApi = useDecks()
const lockApi = useDeckLock()

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'occupied'; holder: LockHolderWire }
  | { kind: 'ready'; deck: Deck; currentVersion: DeckVersion | null }

const deckId = computed(() => Number(route.params.id))
const state = ref<State>({ kind: 'loading' })

const HEARTBEAT_INTERVAL_MS = 30 * 1000
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

async function enterDeck() {
  state.value = { kind: 'loading' }
  const id = deckId.value
  if (!Number.isInteger(id) || id <= 0) {
    state.value = { kind: 'error', message: '非法的 deck id' }
    return
  }

  // 1. 尝试抢占锁
  try {
    const result = await lockApi.activate(id)
    if (!result.ok) {
      state.value = { kind: 'occupied', holder: result.holder }
      return
    }
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 404
        ? 'Deck 不存在或已被删除'
        : err instanceof ApiError
          ? err.message
          : String((err as Error).message || err)
    state.value = { kind: 'error', message: msg }
    return
  }

  // 2. 拉 deck 详情 + currentVersion
  try {
    const { deck, currentVersion } = await decksApi.getDeck(id)
    state.value = { kind: 'ready', deck, currentVersion }
    startHeartbeat()
  } catch (err) {
    state.value = {
      kind: 'error',
      message: err instanceof ApiError ? err.message : String((err as Error).message || err),
    }
  }
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    void lockApi.heartbeat().catch(() => {
      /* 暂时失败下次继续，不打断编辑 */
    })
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

async function releaseLock() {
  stopHeartbeat()
  try {
    await lockApi.release()
  } catch {
    /* ignore */
  }
}

function onBeforeUnload() {
  // navigator.sendBeacon 保证页面关闭也能送到
  navigator.sendBeacon?.('/api/release-deck')
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  void enterDeck()
})

onBeforeUnmount(async () => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  await releaseLock()
})

// 等待页通知已释放时重新抢占
function onLockReleased() {
  void enterDeck()
}

// 切 deck（通过 URL 变化）时重新走生命周期
watch(
  () => deckId.value,
  async (newId, oldId) => {
    if (newId === oldId) return
    await releaseLock()
    await enterDeck()
  },
)

async function handleExit() {
  await releaseLock()
  await router.push('/decks')
}

/** 模板切换完成后，重新拉取 deck + currentVersion 刷新编辑页数据 */
async function handleTemplateSwitched() {
  const id = deckId.value
  if (!Number.isInteger(id) || id <= 0) return
  try {
    const { deck, currentVersion } = await decksApi.getDeck(id)
    state.value = { kind: 'ready', deck, currentVersion }
  } catch {
    // 拉取失败不崩溃；下次用户交互或刷新时会重新拉
  }
}
</script>

<template>
  <div v-if="state.kind === 'loading'" class="loading-screen">
    <p>进入 deck 中...</p>
  </div>

  <div v-else-if="state.kind === 'error'" class="error-screen">
    <p>{{ state.message }}</p>
    <button type="button" class="btn-secondary" @click="router.push('/decks')">返回列表</button>
  </div>

  <OccupiedWaitingPage
    v-else-if="state.kind === 'occupied'"
    :initial-holder="state.holder"
    :deck-id="deckId"
    @lock-released="onLockReleased"
  />

  <DeckEditorCanvas
    v-else
    :deck="state.deck"
    :current-version="state.currentVersion"
    @exit-to-list="handleExit"
    @template-switched="handleTemplateSwitched"
  />
</template>

<style scoped>
.loading-screen,
.error-screen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  background: var(--color-bg-app);
  color: var(--color-fg-secondary);
  font-family: var(--font-sans);
}

.btn-secondary {
  height: 38px;
  padding: 0 var(--space-4);
  border: 1px solid var(--color-border-strong);
  background: transparent;
  color: var(--color-fg-secondary);
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  cursor: pointer;
}

.btn-secondary:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
