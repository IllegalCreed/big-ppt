<script setup lang="ts">
/** Phase 13 Task F:「我的素材」抽屉 modal,容量条 + asset 列表 + 删除按钮 + 空状态。 */
import { computed, ref, watch } from 'vue'
import { FileText, Image, FileSpreadsheet, FileType, Trash2, X, Upload } from 'lucide-vue-next'
import {
  useUploads,
  type UploadedAsset,
  type QuotaInfo,
  QUOTA_LIMIT_DEFAULT,
} from '../composables/useUploads'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { uploadFile, listAssets, deleteAsset, uploading } = useUploads()

const assets = ref<UploadedAsset[]>([])
const quota = ref<QuotaInfo>({ usedBytes: 0, limitBytes: QUOTA_LIMIT_DEFAULT })
const loading = ref(false)
const errorMsg = ref('')
const deletingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const usedPct = computed(() => {
  if (quota.value.limitBytes <= 0) return 0
  return Math.min(100, (quota.value.usedBytes / quota.value.limitBytes) * 100)
})

const isQuotaWarning = computed(() => usedPct.value > 90)

function close() {
  emit('update:open', false)
}

async function refresh() {
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await listAssets()
    assets.value = data.assets
    quota.value = data.quota
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function onPickUpload() {
  fileInputRef.value?.click()
}

async function onFilesPicked(e: Event) {
  const t = e.target as HTMLInputElement
  if (!t.files || t.files.length === 0) return
  errorMsg.value = ''
  for (const file of Array.from(t.files)) {
    try {
      const { asset, quota: q } = await uploadFile(file)
      // 新上传放最前,沿用 backend 返的 uploadedAt 排序
      assets.value = [asset, ...assets.value]
      quota.value = q
    } catch (err) {
      errorMsg.value = (err as Error).message
    }
  }
  t.value = ''
}

function askDelete(id: string) {
  confirmDeleteId.value = id
}

function cancelDelete() {
  confirmDeleteId.value = null
}

async function confirmDelete(id: string) {
  deletingId.value = id
  errorMsg.value = ''
  try {
    const q = await deleteAsset(id)
    assets.value = assets.value.filter((a) => a.id !== id)
    quota.value = q
    confirmDeleteId.value = null
  } catch (e) {
    errorMsg.value = (e as Error).message
  } finally {
    deletingId.value = null
  }
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

function mimeIcon(mime: string) {
  if (mime.startsWith('image/')) return Image
  if (mime.includes('spreadsheet') || mime === 'text/csv') return FileSpreadsheet
  if (mime === 'application/pdf' || mime === 'text/markdown' || mime === 'text/plain')
    return FileText
  return FileType
}

function statusLabel(s: UploadedAsset['extractStatus']): string {
  switch (s) {
    case 'pending':
      return '排队中'
    case 'running':
      return '解析中'
    case 'done':
      return '已解析'
    case 'failed':
      return '解析失败'
    case 'skipped':
      return '图片(直读)'
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) void refresh()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <h3>我的素材</h3>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-body">
          <!-- 容量条 -->
          <section class="quota-section" :class="{ 'quota-warning': isQuotaWarning }">
            <div class="quota-row">
              <span class="quota-label">
                已用 {{ fmtSize(quota.usedBytes) }} / {{ fmtSize(quota.limitBytes) }}
              </span>
              <span class="quota-pct">{{ usedPct.toFixed(1) }}%</span>
            </div>
            <div class="quota-bar">
              <div
                class="quota-bar-fill"
                :class="{ 'fill-warning': isQuotaWarning }"
                :style="{ width: `${usedPct}%` }"
                data-testid="quota-bar-fill"
              />
            </div>
            <p v-if="isQuotaWarning" class="quota-warning-text">
              容量即将用尽,请删除不再需要的素材
            </p>
          </section>

          <!-- 顶部上传 + 错误 -->
          <div class="actions-row">
            <button
              type="button"
              class="primary-btn"
              :disabled="uploading"
              @click="onPickUpload"
            >
              <Upload :size="14" :stroke-width="1.8" />
              {{ uploading ? '上传中…' : '上传素材' }}
            </button>
            <input
              ref="fileInputRef"
              type="file"
              multiple
              hidden
              accept=".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.md,.txt"
              data-testid="asset-panel-input"
              @change="onFilesPicked"
            />
          </div>
          <p v-if="errorMsg" class="error-banner" role="alert">{{ errorMsg }}</p>

          <!-- 列表 -->
          <div v-if="loading" class="state-info">加载中…</div>
          <div v-else-if="assets.length === 0" class="empty-state">
            <p>还没上传任何素材</p>
            <button type="button" class="ghost-btn" @click="onPickUpload">立即上传</button>
          </div>
          <ul v-else class="asset-list">
            <li v-for="a in assets" :key="a.id" class="asset-row" :data-asset-id="a.id">
              <div class="asset-icon" aria-hidden="true">
                <component :is="mimeIcon(a.mime)" :size="20" :stroke-width="1.6" />
              </div>
              <div class="asset-meta">
                <div class="asset-name" :title="a.filename">{{ a.filename }}</div>
                <div class="asset-sub">
                  <span class="asset-size">{{ fmtSize(a.sizeBytes) }}</span>
                  <span class="dot">·</span>
                  <span class="asset-date">{{ fmtDate(a.uploadedAt) }}</span>
                  <span
                    class="asset-status"
                    :class="`status-${a.extractStatus}`"
                    :data-testid="`status-${a.extractStatus}`"
                  >{{ statusLabel(a.extractStatus) }}</span>
                </div>
              </div>
              <div class="asset-actions">
                <template v-if="confirmDeleteId === a.id">
                  <button
                    type="button"
                    class="danger-btn"
                    :disabled="deletingId === a.id"
                    @click="confirmDelete(a.id)"
                  >
                    {{ deletingId === a.id ? '删除中…' : '确认删除' }}
                  </button>
                  <button
                    type="button"
                    class="ghost-btn"
                    :disabled="deletingId === a.id"
                    @click="cancelDelete"
                  >
                    取消
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  class="icon-action"
                  :aria-label="`删除 ${a.filename}`"
                  :title="`删除 ${a.filename}`"
                  @click="askDelete(a.id)"
                >
                  <Trash2 :size="16" :stroke-width="1.8" />
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(70, 54, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-6);
}

.modal-content {
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  width: 640px;
  max-width: 100%;
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
  letter-spacing: 0.01em;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.close-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-fg-primary);
}

.modal-body {
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* ---- Quota ---- */
.quota-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.quota-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
}

.quota-pct {
  font-family: var(--font-mono);
}

.quota-bar {
  width: 100%;
  height: 6px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-pill);
  overflow: hidden;
}

.quota-bar-fill {
  height: 100%;
  background: var(--color-accent);
  transition: width var(--dur-base) var(--ease-out);
}

.quota-bar-fill.fill-warning {
  background: var(--color-danger);
}

.quota-warning-text {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--color-danger);
}

/* ---- Actions ---- */
.actions-row {
  display: flex;
  justify-content: flex-end;
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  font-size: var(--fs-base);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.primary-btn:hover:not(:disabled) {
  background: var(--color-accent-hover);
  border-color: var(--color-accent-hover);
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.error-banner {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}

/* ---- States ---- */
.state-info {
  padding: var(--space-6);
  text-align: center;
  color: var(--color-fg-tertiary);
  font-size: var(--fs-base);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-4);
  color: var(--color-fg-tertiary);
}

.empty-state p {
  margin: 0;
  font-size: var(--fs-base);
}

/* ---- List ---- */
.asset-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.asset-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
}

.asset-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-fg-tertiary);
}

.asset-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.asset-name {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--color-fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-sub {
  display: flex;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--color-fg-tertiary);
  align-items: center;
}

.asset-size,
.asset-date {
  font-family: var(--font-mono);
}

.dot {
  opacity: 0.4;
}

.asset-status {
  margin-left: auto;
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  background: var(--color-bg-subtle);
}

.asset-status.status-done {
  color: var(--color-success);
  background: var(--color-success-soft);
}
.asset-status.status-failed {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}
.asset-status.status-running,
.asset-status.status-pending {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}

/* ---- Asset actions ---- */
.asset-actions {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
}

.icon-action {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.icon-action:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.danger-btn {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  background: var(--color-danger);
  color: var(--color-accent-fg);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.danger-btn:hover:not(:disabled) {
  opacity: 0.92;
}

.danger-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.ghost-btn {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-fg-secondary);
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.ghost-btn:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  border-color: var(--color-border-strong);
}
</style>
