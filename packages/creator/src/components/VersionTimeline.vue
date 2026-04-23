<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RotateCcw, X } from 'lucide-vue-next'
import { useDecks, type DeckVersionSummary } from '../composables/useDecks'
import { ApiError } from '../api/client'

const props = defineProps<{
  deckId: number
  currentVersionId: number | null
  open: boolean
}>()
const emit = defineEmits<{
  close: []
  'restored': [versionId: number]
}>()

const { listVersions, restoreVersion } = useDecks()

const versions = ref<DeckVersionSummary[]>([])
const loading = ref(false)
const restoring = ref<number | null>(null)
const error = ref('')

/** 同 turnId 聚合为一组（第一个是 "当前 turn"，后续 tool_call 合入） */
const groups = computed(() => {
  const out: Array<{ key: string; turnId: string | null; items: DeckVersionSummary[] }> = []
  for (const v of versions.value) {
    const key = v.turnId ?? `single-${v.id}`
    const last = out[out.length - 1]
    if (last && last.key === key && v.turnId) {
      last.items.push(v)
    } else {
      out.push({ key, turnId: v.turnId, items: [v] })
    }
  }
  return out
})

async function refresh() {
  if (!props.deckId) return
  loading.value = true
  error.value = ''
  try {
    versions.value = await listVersions(props.deckId)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    loading.value = false
  }
}

async function onRestore(versionId: number) {
  if (restoring.value !== null) return
  restoring.value = versionId
  try {
    await restoreVersion(props.deckId, versionId)
    emit('restored', versionId)
    await refresh()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    restoring.value = null
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

watch(
  () => [props.open, props.deckId, props.currentVersionId] as const,
  ([open]) => {
    if (open) void refresh()
  },
  { immediate: true },
)
</script>

<template>
  <Transition name="slide">
    <aside v-if="open" class="timeline-drawer">
      <header class="drawer-header">
        <h3>版本历史</h3>
        <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </header>

      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="loading" class="loading">加载中...</div>
      <ol v-else class="version-list">
        <li
          v-for="group in groups"
          :key="group.key"
          class="group"
          :class="{ 'is-multi': group.items.length > 1 }"
        >
          <div v-if="group.items.length > 1" class="group-title">
            同轮 {{ group.items.length }} 次修改
          </div>
          <ol class="items">
            <li
              v-for="version in group.items"
              :key="version.id"
              class="item"
              :class="{ current: version.id === currentVersionId }"
            >
              <div class="item-main">
                <div class="item-meta">
                  <span class="tag">{{ version.message || '修改' }}</span>
                  <span class="time">{{ formatTime(version.createdAt) }}</span>
                </div>
                <div v-if="version.id === currentVersionId" class="current-badge">当前</div>
              </div>
              <button
                v-if="version.id !== currentVersionId"
                type="button"
                class="restore-btn"
                :disabled="restoring !== null"
                @click="onRestore(version.id)"
              >
                <RotateCcw :size="13" :stroke-width="2" />
                <span>{{ restoring === version.id ? '回滚中...' : '回滚' }}</span>
              </button>
            </li>
          </ol>
        </li>
      </ol>
    </aside>
  </Transition>
</template>

<style scoped>
.timeline-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  height: 100vh;
  background: var(--color-bg-surface);
  border-left: 1px solid var(--color-border-subtle);
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.04);
  z-index: 50;
  display: flex;
  flex-direction: column;
  font-family: var(--font-sans);
}

.slide-enter-active,
.slide-leave-active {
  transition: transform var(--dur-base) var(--ease-out);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--color-border-subtle);
}

.drawer-header h3 {
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  margin: 0;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
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

.error {
  color: #B4472C;
  padding: var(--space-3) var(--space-5);
  font-size: var(--fs-sm);
  margin: 0;
}

.loading {
  padding: var(--space-8);
  text-align: center;
  color: var(--color-fg-tertiary);
}

.version-list {
  list-style: none;
  padding: var(--space-3);
  margin: 0;
  overflow-y: auto;
  flex: 1;
}

.group {
  margin-bottom: var(--space-3);
}

.group.is-multi {
  background: var(--color-bg-app);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2);
}

.group-title {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  padding: 2px var(--space-2) var(--space-1);
  letter-spacing: 0.02em;
}

.items {
  list-style: none;
  padding: 0;
  margin: 0;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out);
}

.item:hover {
  background: var(--color-bg-subtle);
}

.item.current {
  background: var(--color-accent-soft);
}

.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-meta {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
}

.tag {
  font-size: var(--fs-sm);
  color: var(--color-fg-primary);
  font-weight: var(--fw-medium);
}

.time {
  font-size: 11px;
  color: var(--color-fg-tertiary);
}

.current-badge {
  font-size: 10px;
  background: var(--color-accent);
  color: var(--color-accent-fg, #fff);
  padding: 2px 6px;
  border-radius: 3px;
  margin-left: auto;
}

.restore-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  cursor: pointer;
  margin-left: var(--space-2);
}

.restore-btn:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.restore-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
