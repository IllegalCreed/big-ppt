<script setup lang="ts">
import type { ShareLinkInfo } from '@big-ppt/shared'
import { Check, Copy, Link2, Link2Off, RefreshCw, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { createDeckShare, getDeckShare, revokeDeckShare } from '../api/sharing'

const props = defineProps<{
  open: boolean
  deckId: number
  deckTitle: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const share = ref<ShareLinkInfo | null>(null)
const expiresInDays = ref<number | null>(7)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)
let loadToken = 0

const shareUrl = computed(() => (share.value ? `${window.location.origin}${share.value.path}` : ''))
const isActive = computed(() => share.value?.status === 'active')
const statusLabel = computed(() => {
  if (!share.value) return '尚未创建'
  if (share.value.status === 'revoked') return '已撤销'
  if (share.value.status === 'expired') return '已过期'
  return share.value.expiresAt
    ? `有效至 ${new Date(share.value.expiresAt).toLocaleString()}`
    : '长期有效'
})

async function load(): Promise<void> {
  const token = ++loadToken
  loading.value = true
  error.value = null
  share.value = null
  try {
    const result = await getDeckShare(props.deckId)
    if (token === loadToken) share.value = result
  } catch (cause) {
    if (token === loadToken)
      error.value = cause instanceof Error ? cause.message : '分享状态加载失败'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function createOrRotate(): Promise<void> {
  if (saving.value) return
  if (isActive.value && !window.confirm('重新生成后，旧分享链接会立即失效。确定继续吗？')) return
  saving.value = true
  error.value = null
  copied.value = false
  try {
    share.value = await createDeckShare(props.deckId, expiresInDays.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '分享链接创建失败'
  } finally {
    saving.value = false
  }
}

async function revoke(): Promise<void> {
  if (!isActive.value || saving.value) return
  if (!window.confirm('撤销后，正在访问这个链接的访客也将无法继续加载。确定撤销吗？')) return
  saving.value = true
  error.value = null
  try {
    await revokeDeckShare(props.deckId)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '分享链接撤销失败'
  } finally {
    saving.value = false
  }
}

async function copyLink(): Promise<void> {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
  } catch {
    const input = document.createElement('textarea')
    input.value = shareUrl.value
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1800)
}

watch(
  [() => props.open, () => props.deckId],
  ([open]) => {
    if (open) {
      void load()
    } else {
      loadToken++
      share.value = null
      loading.value = false
      error.value = null
      copied.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" role="presentation">
      <section
        class="share-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`静态分享 ${deckTitle}`"
      >
        <header class="modal-header">
          <div>
            <h2>静态分享</h2>
            <p>{{ deckTitle }}</p>
          </div>
          <button
            type="button"
            class="icon-btn"
            title="关闭"
            aria-label="关闭"
            @click="emit('update:open', false)"
          >
            <X :size="19" />
          </button>
        </header>

        <div class="modal-body">
          <div class="status-row">
            <span class="status-dot" :class="share?.status ?? 'none'" />
            <span>{{ loading ? '加载中...' : statusLabel }}</span>
            <span v-if="share" class="access-count">访问 {{ share.accessCount }} 次</span>
          </div>

          <div v-if="isActive" class="link-row">
            <input :value="shareUrl" readonly aria-label="分享链接" />
            <button
              type="button"
              class="icon-btn bordered"
              :title="copied ? '已复制' : '复制链接'"
              :aria-label="copied ? '已复制' : '复制链接'"
              @click="copyLink"
            >
              <Check v-if="copied" :size="17" />
              <Copy v-else :size="17" />
            </button>
          </div>

          <label class="expiry-field">
            <span>链接有效期</span>
            <select v-model="expiresInDays" :disabled="saving">
              <option :value="1">1 天</option>
              <option :value="7">7 天</option>
              <option :value="30">30 天</option>
              <option :value="90">90 天</option>
              <option :value="null">长期有效</option>
            </select>
          </label>

          <p v-if="error" class="error-message" role="alert">{{ error }}</p>
        </div>

        <footer class="modal-footer">
          <button
            v-if="isActive"
            type="button"
            class="btn danger"
            :disabled="saving"
            @click="revoke"
          >
            <Link2Off :size="16" />
            撤销
          </button>
          <span class="footer-spacer" />
          <button type="button" class="btn secondary" @click="emit('update:open', false)">
            关闭
          </button>
          <button
            type="button"
            class="btn primary"
            :disabled="loading || saving"
            @click="createOrRotate"
          >
            <RefreshCw v-if="isActive" :size="16" />
            <Link2 v-else :size="16" />
            {{ isActive ? '重新生成' : '创建链接' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(20, 19, 17, 0.46);
}

.share-modal {
  width: min(520px, 100%);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: var(--color-bg-surface);
  box-shadow: 0 18px 48px rgba(20, 19, 17, 0.24);
  color: var(--color-fg-primary);
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
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-header h2,
.modal-header p {
  margin: 0;
}

.modal-header h2 {
  font-size: 17px;
}

.modal-header p {
  margin-top: 3px;
  color: var(--color-fg-muted);
  font-size: 12px;
}

.modal-body {
  display: grid;
  gap: 16px;
  padding: 20px 18px;
}

.status-row,
.link-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.status-row {
  font-size: 13px;
  color: var(--color-fg-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-fg-muted);
}

.status-dot.active {
  background: #4f8a56;
}

.status-dot.expired,
.status-dot.revoked {
  background: #b4472c;
}

.access-count {
  margin-left: auto;
  color: var(--color-fg-muted);
}

.link-row input {
  min-width: 0;
  flex: 1;
  height: 36px;
  padding: 0 11px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  background: var(--color-bg-subtle);
  color: var(--color-fg-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.expiry-field {
  display: grid;
  gap: 7px;
  color: var(--color-fg-secondary);
  font-size: 13px;
}

.expiry-field select {
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-fg-primary);
}

.error-message {
  margin: 0;
  color: #b4472c;
  font-size: 13px;
}

.modal-footer {
  border-top: 1px solid var(--color-border-subtle);
}

.footer-spacer {
  flex: 1;
}

.icon-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--color-fg-secondary);
  cursor: pointer;
}

.icon-btn:hover,
.icon-btn.bordered:hover {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.icon-btn.bordered {
  border: 1px solid var(--color-border-subtle);
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
  border: 1px solid var(--color-accent);
  background: var(--color-accent);
  color: var(--color-accent-fg);
}

.btn.secondary {
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-fg-secondary);
}

.btn.danger {
  border: 1px solid rgba(180, 71, 44, 0.35);
  background: transparent;
  color: #b4472c;
}
</style>
