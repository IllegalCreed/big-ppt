<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Clock, RefreshCw } from 'lucide-vue-next'
import type { LockHolderWire } from '../composables/useDecks'
import { useDeckLock } from '../composables/useDecks'

const props = defineProps<{
  /** 初始 holder 信息（从 activate 失败的响应里拿的） */
  initialHolder: LockHolderWire
  /** 发起方想进的 deck id；轮询释放时回调让 parent 重试 */
  deckId: number
}>()
const emit = defineEmits<{ 'lock-released': [] }>()

const router = useRouter()
const { status: lockStatus } = useDeckLock()

const holder = ref<LockHolderWire>({ ...props.initialHolder })
const retrying = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const lockedAtLabel = computed(() => formatRelative(holder.value.lockedAt))
const heartbeatLabel = computed(() => formatRelative(holder.value.lastHeartbeatAt))

function formatRelative(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.max(0, Math.floor(diffMs / 1000))
  if (diffSec < 60) return `${diffSec} 秒前`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr} 小时前`
}

async function poll() {
  try {
    const s = await lockStatus()
    if (!s.locked) {
      emit('lock-released')
      return
    }
    holder.value = s.holder
  } catch {
    // 暂时网络错，下一次轮询继续
  }
}

async function onRetryNow() {
  retrying.value = true
  await poll()
  retrying.value = false
}

function backToList() {
  void router.push('/decks')
}

onMounted(() => {
  pollTimer = setInterval(poll, 5000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="waiting-shell">
    <div class="waiting-card">
      <div class="icon-wrap">
        <Clock :size="32" :stroke-width="1.6" />
      </div>
      <h1>当前有人在编辑</h1>
      <p class="subtitle">
        Lumideck 目前只支持单实例编辑，其他人释放后你会自动进入。
      </p>

      <div class="holder-grid">
        <div class="field">
          <span class="label">占用者</span>
          <span class="value">{{ holder.email ?? '未知' }}</span>
        </div>
        <div class="field">
          <span class="label">正在编辑</span>
          <span class="value">{{ holder.deckTitle ?? `Deck #${holder.deckId}` }}</span>
        </div>
        <div class="field">
          <span class="label">开始占用</span>
          <span class="value">{{ lockedAtLabel }}</span>
        </div>
        <div class="field">
          <span class="label">最近活跃</span>
          <span class="value">{{ heartbeatLabel }}</span>
        </div>
      </div>

      <p class="hint">
        若占用者 5 分钟无心跳，锁将自动释放（本页每 5 秒自动轮询）。
      </p>

      <div class="waiting-actions">
        <button type="button" class="btn-secondary" @click="backToList">返回列表</button>
        <button type="button" class="btn-primary" :disabled="retrying" @click="onRetryNow">
          <RefreshCw :size="14" :stroke-width="2" :class="{ spinning: retrying }" />
          <span>立即重试</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.waiting-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-app);
  padding: var(--space-6);
  font-family: var(--font-sans);
}

.waiting-card {
  width: 100%;
  max-width: 520px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-2);
}

.waiting-card h1 {
  font-family: var(--font-serif);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  margin: 0;
}

.subtitle {
  color: var(--color-fg-tertiary);
  text-align: center;
  margin: 0 0 var(--space-4) 0;
  font-size: var(--fs-base);
}

.holder-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-3) var(--space-6);
  padding: var(--space-4);
  background: var(--color-bg-app);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-subtle);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
}

.value {
  font-size: var(--fs-base);
  color: var(--color-fg-primary);
  font-weight: var(--fw-medium);
}

.hint {
  color: var(--color-fg-tertiary);
  text-align: center;
  font-size: var(--fs-sm);
  margin: var(--space-2) 0;
}

.waiting-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 38px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--dur-fast) var(--ease-out);
}

.btn-primary {
  background: var(--color-accent);
  color: var(--color-accent-fg, #fff);
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: #A94E2E;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-fg-secondary);
  border-color: var(--color-border-strong);
}

.btn-secondary:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
