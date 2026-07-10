<script setup lang="ts">
import type { LivePresentationInfo, PresentationSnapshot } from '@big-ppt/shared'
import { Check, Copy, Radio, Square, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  endDeckLivePresentation,
  getDeckLivePresentation,
  startDeckLivePresentation,
  updateDeckLivePresentation,
} from '../api/live-presentation'
import { ApiError } from '../api/client'
import type { PresentationUiTheme } from './types'

const props = withDefaults(
  defineProps<{
    open: boolean
    deckId: number
    deckTitle: string
    snapshot: PresentationSnapshot
    uiTheme?: PresentationUiTheme
  }>(),
  { uiTheme: 'dark' },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:active': [active: boolean]
}>()

const live = ref<LivePresentationInfo | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)
let loadToken = 0
let publishTimer: ReturnType<typeof setTimeout> | null = null
let publishInFlight = false
let queuedSnapshot: PresentationSnapshot | null = null
let publishDelayMs = 80
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const liveUrl = computed(() => (live.value ? `${window.location.origin}${live.value.path}` : ''))
const expiresLabel = computed(() =>
  live.value ? new Date(live.value.expiresAt).toLocaleString() : '',
)

function cloneSnapshot(snapshot: PresentationSnapshot): PresentationSnapshot {
  return {
    page: snapshot.page,
    blackout: snapshot.blackout,
    drawings: Object.fromEntries(
      Object.entries(snapshot.drawings).map(([page, strokes]) => [
        page,
        strokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({ ...point })),
        })),
      ]),
    ),
  }
}

function setLive(next: LivePresentationInfo | null): void {
  live.value = next
  emit('update:active', next !== null)
}

function clearPublisher(): void {
  if (publishTimer) clearTimeout(publishTimer)
  publishTimer = null
  queuedSnapshot = null
  publishDelayMs = 80
}

async function flushSnapshot(): Promise<void> {
  publishTimer = null
  if (publishInFlight || !queuedSnapshot || !live.value) return
  const state = queuedSnapshot
  const target = live.value
  const targetDeckId = props.deckId
  queuedSnapshot = null
  publishInFlight = true
  try {
    await updateDeckLivePresentation(targetDeckId, target.token, state)
    publishDelayMs = 80
    error.value = null
  } catch (cause) {
    if (live.value?.token !== target.token || props.deckId !== targetDeckId) return
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 409)) {
      setLive(null)
    } else {
      queuedSnapshot ??= state
      publishDelayMs = 1500
    }
    error.value = cause instanceof Error ? cause.message : '直播状态同步失败'
  } finally {
    publishInFlight = false
    if (queuedSnapshot && live.value) {
      publishTimer = setTimeout(() => void flushSnapshot(), publishDelayMs)
    }
  }
}

function queueSnapshot(snapshot: PresentationSnapshot): void {
  if (!live.value || saving.value) return
  queuedSnapshot = cloneSnapshot(snapshot)
  if (!publishTimer && !publishInFlight) {
    publishTimer = setTimeout(() => void flushSnapshot(), 80)
  }
}

async function load(): Promise<void> {
  const token = ++loadToken
  const targetDeckId = props.deckId
  loading.value = true
  error.value = null
  clearPublisher()
  setLive(null)
  try {
    const result = await getDeckLivePresentation(targetDeckId)
    if (token !== loadToken || targetDeckId !== props.deckId) return
    setLive(result)
    if (result) queueSnapshot(props.snapshot)
  } catch (cause) {
    if (token === loadToken) {
      error.value = cause instanceof Error ? cause.message : '直播状态加载失败'
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function start(): Promise<void> {
  if (saving.value || live.value) return
  saving.value = true
  error.value = null
  try {
    setLive(await startDeckLivePresentation(props.deckId, cloneSnapshot(props.snapshot)))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '直播启动失败'
  } finally {
    saving.value = false
  }
}

async function stop(): Promise<void> {
  const target = live.value
  if (!target || saving.value) return
  if (!window.confirm('确定结束直播吗？远程观众将立即退出当前直播。')) return
  saving.value = true
  error.value = null
  clearPublisher()
  try {
    await endDeckLivePresentation(props.deckId, target.token)
    if (live.value?.token === target.token) setLive(null)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '直播结束失败'
  } finally {
    saving.value = false
  }
}

async function copyLink(): Promise<void> {
  if (!liveUrl.value) return
  try {
    await navigator.clipboard.writeText(liveUrl.value)
  } catch {
    const input = document.createElement('textarea')
    input.value = liveUrl.value
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1800)
}

watch(
  [() => props.deckId, () => props.open],
  ([deckId, open], [previousDeckId, previousOpen]) => {
    if (deckId !== previousDeckId || (open && !previousOpen)) void load()
    if (!open) {
      copied.value = false
      error.value = null
    }
  },
  { immediate: true },
)

watch(
  () => props.snapshot,
  (snapshot) => queueSnapshot(snapshot),
  { deep: true },
)

onBeforeUnmount(() => {
  loadToken++
  clearPublisher()
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="live-modal-overlay" :class="`ui-theme-${uiTheme}`">
      <section
        class="live-share-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`直播观看 ${deckTitle}`"
      >
        <header class="modal-header">
          <div>
            <h2>直播观看</h2>
            <p>{{ deckTitle }}</p>
          </div>
          <button
            type="button"
            class="icon-btn"
            title="关闭"
            aria-label="关闭直播窗口"
            @click="emit('update:open', false)"
          >
            <X :size="19" />
          </button>
        </header>

        <div class="modal-body">
          <div class="status-row" role="status">
            <span class="status-dot" :class="{ active: live }" />
            <span>{{ loading ? '加载中...' : live ? '直播中' : '未开始' }}</span>
            <span v-if="live" class="expiry">有效至 {{ expiresLabel }}</span>
          </div>

          <div v-if="live" class="link-row">
            <input :value="liveUrl" readonly aria-label="直播观看链接" />
            <button
              type="button"
              class="icon-btn bordered"
              :title="copied ? '已复制' : '复制直播链接'"
              :aria-label="copied ? '已复制' : '复制直播链接'"
              @click="copyLink"
            >
              <Check v-if="copied" :size="17" />
              <Copy v-else :size="17" />
            </button>
          </div>

          <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        </div>

        <footer class="modal-footer">
          <button v-if="live" type="button" class="btn danger" :disabled="saving" @click="stop">
            <Square :size="15" />
            结束直播
          </button>
          <span class="footer-spacer" />
          <button type="button" class="btn secondary" @click="emit('update:open', false)">
            关闭
          </button>
          <button
            v-if="!live"
            type="button"
            class="btn primary"
            :disabled="loading || saving"
            @click="start"
          >
            <Radio :size="16" />
            开始直播
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.live-modal-overlay {
  --live-bg: #1b1e21;
  --live-fg: #f4f4f2;
  --live-muted: rgba(255, 255, 255, 0.68);
  --live-border: rgba(255, 255, 255, 0.14);
  --live-hover: rgba(255, 255, 255, 0.1);
  --live-accent: #c15f3c;

  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(8, 10, 12, 0.64);
  color: var(--live-fg);
  font-family: var(--font-sans);
}

.live-modal-overlay.ui-theme-light {
  --live-bg: #ffffff;
  --live-fg: #202326;
  --live-muted: rgba(32, 35, 38, 0.65);
  --live-border: rgba(32, 35, 38, 0.16);
  --live-hover: rgba(32, 35, 38, 0.08);

  background: rgba(32, 35, 38, 0.38);
}

.live-share-modal {
  width: min(540px, 100%);
  border: 1px solid var(--live-border);
  border-radius: 8px;
  background: var(--live-bg);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
}

.modal-header,
.modal-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
}

.modal-header {
  justify-content: space-between;
  border-bottom: 1px solid var(--live-border);
}

.modal-header h2,
.modal-header p,
.error-message {
  margin: 0;
}

.modal-header h2 {
  font-size: 17px;
}

.modal-header p {
  margin-top: 3px;
  color: var(--live-muted);
  font-size: 12px;
}

.modal-body {
  display: grid;
  gap: 16px;
  padding: 20px 18px;
}

.status-row,
.link-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
}

.status-row {
  color: var(--live-muted);
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: #7a7f84;
}

.status-dot.active {
  background: #22a06b;
  box-shadow: 0 0 0 3px rgba(34, 160, 107, 0.16);
}

.expiry {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 12px;
}

.link-row input {
  min-width: 0;
  height: 38px;
  flex: 1;
  padding: 0 11px;
  border: 1px solid var(--live-border);
  border-radius: 6px;
  background: transparent;
  color: var(--live-fg);
  font-family: var(--font-mono);
  font-size: 12px;
}

.error-message {
  color: #e47758;
  font-size: 13px;
}

.modal-footer {
  border-top: 1px solid var(--live-border);
}

.footer-spacer {
  flex: 1;
}

.icon-btn {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--live-muted);
  cursor: pointer;
}

.icon-btn:hover,
.icon-btn.bordered:hover {
  background: var(--live-hover);
  color: var(--live-fg);
}

.icon-btn.bordered {
  border: 1px solid var(--live-border);
}

.btn {
  min-height: 36px;
  padding: 0 13px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-family: inherit;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.btn.primary {
  border: 1px solid var(--live-accent);
  background: var(--live-accent);
  color: #fff;
}

.btn.secondary {
  border: 1px solid var(--live-border);
  background: transparent;
  color: var(--live-muted);
}

.btn.danger {
  border: 1px solid rgba(228, 119, 88, 0.48);
  background: transparent;
  color: #e47758;
}

@media (max-width: 560px) {
  .expiry {
    display: none;
  }
}
</style>
