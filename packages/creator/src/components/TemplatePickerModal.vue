<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import type { TemplateManifest } from '@big-ppt/shared'
import { api, ApiError } from '../api/client'
import { useDecks, type Deck } from '../composables/useDecks'
import TemplateCard from './TemplateCard.vue'
import TemplatePreviewPane from './TemplatePreviewPane.vue'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'switch'
  /** switch 模式下当前 deck 的 templateId，用于默认选中 + 禁选同一个 */
  currentTemplateId?: string
  /** switch 模式下的 deckId */
  deckId?: number
  /** 测试用：禁用 Teleport，让 modal 在父 wrapper 内渲染（VTU 2 不跨 Teleport 边界 query） */
  disableTeleport?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [deck: Deck]
}>()

const { createDeck } = useDecks()

const manifests = ref<TemplateManifest[]>([])
const loading = ref(false)
const selectedId = ref<string | null>(null)
const title = ref('未命名幻灯片')
const submitting = ref(false)
const submitError = ref<string | null>(null)

const selected = computed(() =>
  manifests.value.find((m) => m.id === selectedId.value) ?? null,
)

const canSubmit = computed(() => {
  if (!selected.value) return false
  if (submitting.value) return false
  if (props.mode === 'create') return title.value.trim().length > 0
  return selected.value.id !== props.currentTemplateId
})

const primaryLabel = computed(() => {
  if (submitting.value) return props.mode === 'create' ? '创建中…' : '切换中…'
  return props.mode === 'create' ? '创建' : '切换（AI 重写）'
})

async function loadManifests() {
  loading.value = true
  try {
    const res = await api.get<{ manifests: TemplateManifest[] }>('/list-templates')
    manifests.value = res.manifests
    const defaultId =
      props.mode === 'switch' && props.currentTemplateId
        ? manifests.value.find((m) => m.id !== props.currentTemplateId)?.id ?? null
        : manifests.value[0]?.id ?? null
    selectedId.value = defaultId
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      title.value = '未命名幻灯片'
      submitError.value = null
      submitting.value = false
      void loadManifests()
    }
  },
  { immediate: true },
)

async function onPrimary() {
  if (!canSubmit.value || !selected.value) return
  submitError.value = null
  submitting.value = true
  try {
    if (props.mode === 'create') {
      const deck = await createDeck({
        title: title.value.trim(),
        templateId: selected.value.id,
      })
      emit('created', deck)
      close()
    } else {
      // switch mode 在 Task 7C-5/6 内实现
      throw new Error('switch mode not wired yet')
    }
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    submitting.value = false
  }
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body" :disabled="disableTeleport">
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ mode === 'create' ? '新建 Deck' : '切换模板' }}</h3>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-body">
          <div v-if="mode === 'create'" class="field">
            <label for="tpl-modal-title">标题</label>
            <input
              id="tpl-modal-title"
              v-model="title"
              type="text"
              data-title-input
              class="input-bare"
              placeholder="未命名幻灯片"
            />
          </div>

          <div class="picker">
            <div v-if="loading" class="picker__loading">加载模板清单…</div>
            <template v-else>
              <div class="picker__list">
                <TemplateCard
                  v-for="m in manifests"
                  :key="m.id"
                  :manifest="m"
                  :active="selectedId === m.id"
                  @select="selectedId = m.id"
                />
              </div>
              <div class="picker__preview">
                <TemplatePreviewPane
                  v-if="selected"
                  :manifest="selected"
                  :show-switch-warning="mode === 'switch'"
                />
              </div>
            </template>
          </div>

          <p v-if="submitError" class="form-error">{{ submitError }}</p>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-secondary" :disabled="submitting" @click="close">
            取消
          </button>
          <button
            type="button"
            :class="mode === 'switch' ? 'btn-danger' : 'btn-primary'"
            :disabled="!canSubmit"
            data-primary-action
            @click="onPrimary"
          >
            {{ primaryLabel }}
          </button>
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
  width: 800px;
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
}
.modal-header h3 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
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
}
.close-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-fg-primary);
}
.modal-body {
  padding: 0 var(--space-6) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow-y: auto;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.field label {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
}
.input-bare {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-fg-primary);
  font-size: var(--fs-md);
  font-family: inherit;
  outline: none;
}
.input-bare:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.picker {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--space-4);
  min-height: 320px;
}
.picker__loading {
  grid-column: 1 / -1;
  padding: var(--space-8);
  text-align: center;
  color: var(--color-fg-muted);
}
.picker__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  padding-right: var(--space-1);
}
.picker__preview {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  overflow: hidden;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-border-subtle);
}
.btn-secondary {
  padding: var(--space-2) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-fg-secondary);
  cursor: pointer;
  font-size: var(--fs-md);
  font-family: inherit;
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.btn-primary,
.btn-danger {
  padding: var(--space-2) var(--space-5);
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-accent-fg);
  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  font-family: inherit;
}
.btn-primary {
  background: var(--color-accent);
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
.btn-danger {
  background: #b4472c;
}
.btn-danger:hover:not(:disabled) {
  background: #9e3d26;
}
.btn-primary:disabled,
.btn-danger:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.form-error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: rgba(180, 71, 44, 0.08);
  border: 1px solid rgba(180, 71, 44, 0.25);
  border-radius: var(--radius-md);
  color: #b4472c;
  font-size: var(--fs-sm);
}
</style>
