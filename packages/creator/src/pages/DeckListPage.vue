<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { FileText, LogOut, Plus, Sparkles, Trash2 } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth'
import { useDecks, type Deck } from '../composables/useDecks'
import { ApiError } from '../api/client'

const router = useRouter()
const { currentUser, logout } = useAuth()
const { listDecks, createDeck, deleteDeck, updateDeck } = useDecks()

const decks = ref<Deck[]>([])
const loading = ref(true)
const creating = ref(false)
const error = ref('')

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    decks.value = await listDecks()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  if (creating.value) return
  creating.value = true
  try {
    const deck = await createDeck({ title: '未命名幻灯片' })
    await router.push(`/decks/${deck.id}`)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    creating.value = false
  }
}

function openDeck(deck: Deck) {
  void router.push(`/decks/${deck.id}`)
}

async function onRename(deck: Deck, event: Event) {
  event.stopPropagation()
  const next = prompt('新标题', deck.title)?.trim()
  if (!next || next === deck.title) return
  try {
    const updated = await updateDeck(deck.id, { title: next })
    deck.title = updated.title
  } catch (err) {
    alert(err instanceof ApiError ? err.message : String((err as Error).message || err))
  }
}

async function onDelete(deck: Deck, event: Event) {
  event.stopPropagation()
  if (!confirm(`确认删除「${deck.title}」？`)) return
  try {
    await deleteDeck(deck.id)
    decks.value = decks.value.filter((d) => d.id !== deck.id)
  } catch (err) {
    alert(err instanceof ApiError ? err.message : String((err as Error).message || err))
  }
}

async function onLogout() {
  await logout()
  await router.replace('/login')
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(refresh)
</script>

<template>
  <div class="list-page">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <Sparkles :size="18" :stroke-width="1.8" />
        </div>
        <div class="brand-text">
          <div class="brand-title">Lumideck</div>
          <div class="brand-subtitle">幻光千叶</div>
        </div>
      </div>
      <div class="topbar-actions">
        <span v-if="currentUser" class="user-email">{{ currentUser.email }}</span>
        <button type="button" class="icon-btn" title="退出登录" aria-label="退出登录" @click="onLogout">
          <LogOut :size="18" :stroke-width="1.8" />
        </button>
      </div>
    </header>

    <main class="content">
      <div class="content-header">
        <h1>我的幻灯片</h1>
        <button type="button" class="btn-primary" :disabled="creating" @click="onCreate">
          <Plus :size="16" :stroke-width="2" />
          <span>{{ creating ? '创建中...' : '新建 Deck' }}</span>
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="decks.length === 0" class="empty">
        <FileText :size="48" :stroke-width="1.2" />
        <p>还没有 deck，点右上角新建一个开始创作。</p>
      </div>
      <ul v-else class="deck-grid">
        <li
          v-for="deck in decks"
          :key="deck.id"
          class="deck-card"
          tabindex="0"
          role="button"
          @click="openDeck(deck)"
          @keydown.enter="openDeck(deck)"
        >
          <div class="deck-title-row">
            <FileText :size="18" :stroke-width="1.6" />
            <span class="deck-title">{{ deck.title }}</span>
            <span v-if="deck.status === 'archived'" class="badge">归档</span>
          </div>
          <div class="deck-meta">更新于 {{ formatDate(deck.updatedAt) }}</div>
          <div class="deck-actions" @click.stop>
            <button type="button" class="card-action" title="重命名" @click="onRename(deck, $event)">
              重命名
            </button>
            <button type="button" class="card-action danger" title="删除" @click="onDelete(deck, $event)">
              <Trash2 :size="14" :stroke-width="1.8" />
            </button>
          </div>
        </li>
      </ul>
    </main>
  </div>
</template>

<style scoped>
.list-page {
  min-height: 100vh;
  background: var(--color-bg-app);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  height: 56px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.brand-mark {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.brand-title {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}

.brand-subtitle {
  font-size: 11px;
  color: var(--color-fg-tertiary);
  letter-spacing: 0.08em;
  margin-top: 2px;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.user-email {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  padding: 0 var(--space-2);
}

.icon-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.content {
  flex: 1;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-8) var(--space-6);
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-6);
}

.content-header h1 {
  font-family: var(--font-serif);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  margin: 0;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 38px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-accent-fg, #fff);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  cursor: pointer;
}

.btn-primary:hover:not(:disabled) {
  background: #A94E2E;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  margin: 0 0 var(--space-4) 0;
  padding: var(--space-2) var(--space-3);
  background: rgba(180, 71, 44, 0.08);
  border: 1px solid rgba(180, 71, 44, 0.25);
  border-radius: var(--radius-md);
  color: #B4472C;
  font-size: var(--fs-sm);
}

.loading {
  text-align: center;
  padding: var(--space-8);
  color: var(--color-fg-tertiary);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-12) var(--space-6);
  color: var(--color-fg-tertiary);
  border: 1px dashed var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.empty p {
  margin: 0;
  font-size: var(--fs-base);
}

.deck-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
}

.deck-card {
  position: relative;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  cursor: pointer;
  transition: box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.deck-card:hover,
.deck-card:focus-visible {
  border-color: var(--color-accent);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  outline: none;
}

.deck-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-fg-primary);
}

.deck-title {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  font-size: 10px;
  background: var(--color-bg-subtle);
  color: var(--color-fg-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}

.deck-meta {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
}

.deck-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.deck-card:hover .deck-actions,
.deck-card:focus-within .deck-actions {
  opacity: 1;
}

.card-action {
  background: transparent;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.card-action:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.card-action.danger:hover {
  border-color: #B4472C;
  color: #B4472C;
}
</style>
