<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDecks, type Deck, type DeckVersion } from '../composables/useDecks'
import DeckEditorCanvas from '../components/DeckEditorCanvas.vue'
import { ApiError } from '../api/client'

// 编辑器进入只读取 deck 元数据与 currentVersion。原生放映页不依赖全局运行时，
// 多个用户可同时编辑和放映各自的 deck。

const route = useRoute()
const router = useRouter()
const decksApi = useDecks()

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; deck: Deck; currentVersion: DeckVersion | null }

const deckId = computed(() => Number(route.params.id))
const state = ref<State>({ kind: 'loading' })

async function enterDeck() {
  state.value = { kind: 'loading' }
  const id = deckId.value
  if (!Number.isInteger(id) || id <= 0) {
    state.value = { kind: 'error', message: '非法的 deck id' }
    return
  }

  try {
    const { deck, currentVersion } = await decksApi.getDeck(id)
    state.value = { kind: 'ready', deck, currentVersion }
  } catch (err) {
    const msg =
      err instanceof ApiError && err.status === 404
        ? 'Deck 不存在或已被删除'
        : err instanceof ApiError
          ? err.message
          : String((err as Error).message || err)
    state.value = { kind: 'error', message: msg }
  }
}

onMounted(() => {
  void enterDeck()
})

// 切 deck（通过 URL 变化）时重新拉
watch(
  () => deckId.value,
  async (newId, oldId) => {
    if (newId === oldId) return
    await enterDeck()
  },
)

function handleExit() {
  void router.push('/decks')
}

/** 模板或配图风格变更后，重新拉取 deck + currentVersion 刷新编辑页数据。 */
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

/** 子组件 inline 改完标题后，父组件同步自己的 state.deck.title */
function handleTitleUpdated(payload: { title: string }) {
  if (state.value.kind === 'ready') {
    state.value.deck.title = payload.title
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

  <DeckEditorCanvas
    v-else
    :deck="state.deck"
    :current-version="state.currentVersion"
    @exit-to-list="handleExit"
    @template-switched="handleTemplateSwitched"
    @style-changed="handleTemplateSwitched"
    @title-updated="handleTitleUpdated"
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
