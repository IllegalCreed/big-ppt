<script setup lang="ts">
import { ref, watch } from 'vue'
import { BookmarkPlus, Check, ImageOff, Pencil, Trash2, X } from 'lucide-vue-next'
import type { ImageStyleSource } from '../api/image-styles'

export type ImageStyleCardItem = {
  id: string
  source: ImageStyleSource
  name: string
  description?: string
  previewUrl: string
  width?: number
  height?: number
}

const props = withDefaults(
  defineProps<{
    item: ImageStyleCardItem
    selected?: boolean
    disabled?: boolean
    disabledReason?: string
    applying?: boolean
    saving?: boolean
    renaming?: boolean
    deleting?: boolean
    canSave?: boolean
    canManage?: boolean
    saved?: boolean
    eager?: boolean
  }>(),
  {
    selected: false,
    disabled: false,
    disabledReason: '',
    applying: false,
    saving: false,
    renaming: false,
    deleting: false,
    canSave: false,
    canManage: false,
    saved: false,
    eager: false,
  },
)

const emit = defineEmits<{
  apply: []
  save: []
  rename: [name: string]
  delete: []
}>()

const imageFailed = ref(false)
const editing = ref(false)
const confirmingDelete = ref(false)
const nameDraft = ref(props.item.name)

watch(
  () => props.item.previewUrl,
  () => {
    imageFailed.value = false
  },
)

watch(
  () => props.item.name,
  (name) => {
    if (!editing.value) nameDraft.value = name
  },
)

function startRename(): void {
  nameDraft.value = props.item.name
  confirmingDelete.value = false
  editing.value = true
}

function cancelRename(): void {
  editing.value = false
  nameDraft.value = props.item.name
}

function submitRename(): void {
  const name = nameDraft.value.trim()
  if (!name || name === props.item.name) {
    cancelRename()
    return
  }
  emit('rename', name)
  editing.value = false
}
</script>

<template>
  <article class="style-card" :class="{ 'is-selected': selected, 'is-disabled': disabled }">
    <button
      type="button"
      class="style-card__apply"
      :aria-label="`应用${item.name}风格`"
      :aria-pressed="selected"
      :aria-busy="applying"
      :disabled="disabled || applying || deleting"
      :title="disabled ? disabledReason || undefined : undefined"
      :data-style-source="item.source"
      :data-style-id="item.id"
      @click="emit('apply')"
    >
      <span class="style-card__preview">
        <img
          v-if="!imageFailed"
          :src="item.previewUrl"
          :alt="`${item.name}风格预览`"
          :width="item.width || 1280"
          :height="item.height || 624"
          :loading="eager ? 'eager' : 'lazy'"
          :fetchpriority="eager ? 'high' : 'auto'"
          decoding="async"
          @error="imageFailed = true"
        />
        <span v-else class="style-card__image-fallback" role="img" aria-label="预览图加载失败">
          <ImageOff :size="24" :stroke-width="1.5" aria-hidden="true" />
        </span>
        <span v-if="selected && !applying" class="style-card__selected-badge">
          <Check :size="14" :stroke-width="2.4" aria-hidden="true" />
          已应用
        </span>
        <span v-if="applying" class="style-card__busy">应用中…</span>
      </span>
      <span class="style-card__meta">
        <span class="style-card__name">{{ item.name }}</span>
        <span v-if="item.description" class="style-card__description">
          {{ item.description }}
        </span>
      </span>
    </button>

    <div v-if="saved || canSave || canManage" class="style-card__actions">
      <span v-if="saved" class="saved-label"> <Check :size="13" aria-hidden="true" />已保存 </span>
      <button
        v-else-if="canSave"
        type="button"
        class="card-action"
        :disabled="saving"
        :aria-label="`保存${item.name}到我的风格`"
        @click="emit('save')"
      >
        <BookmarkPlus :size="14" :stroke-width="1.8" aria-hidden="true" />
        {{ saving ? '保存中…' : '保存' }}
      </button>

      <template v-if="canManage">
        <form v-if="editing" class="rename-form" @submit.prevent="submitRename">
          <input
            v-model="nameDraft"
            class="rename-input"
            type="text"
            name="style-name"
            aria-label="风格名称"
            maxlength="80"
            autocomplete="off"
          />
          <button type="submit" class="icon-action" :disabled="renaming" aria-label="保存名称">
            <Check :size="14" aria-hidden="true" />
          </button>
          <button type="button" class="icon-action" aria-label="取消重命名" @click="cancelRename">
            <X :size="14" aria-hidden="true" />
          </button>
        </form>
        <div v-else-if="confirmingDelete" class="delete-confirm" role="alert">
          <span>确定删除？</span>
          <button type="button" class="text-danger" :disabled="deleting" @click="emit('delete')">
            {{ deleting ? '删除中…' : '删除' }}
          </button>
          <button type="button" class="text-action" @click="confirmingDelete = false">取消</button>
        </div>
        <div v-else class="manage-actions">
          <button type="button" class="icon-action" aria-label="重命名风格" @click="startRename">
            <Pencil :size="14" :stroke-width="1.8" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-action icon-action--danger"
            aria-label="删除风格"
            @click="confirmingDelete = true"
          >
            <Trash2 :size="14" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </div>
      </template>
    </div>
  </article>
</template>

<style scoped>
.style-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.style-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-xs);
  transform: translateY(-1px);
}

.style-card.is-selected {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.1);
}

.style-card.is-disabled {
  opacity: 0.55;
}

.style-card__apply {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  touch-action: manipulation;
}

.style-card__apply:disabled {
  cursor: wait;
}

.style-card__apply:focus-visible,
.card-action:focus-visible,
.icon-action:focus-visible,
.text-action:focus-visible,
.text-danger:focus-visible,
.rename-input:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.style-card__preview {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1280 / 624;
  overflow: hidden;
  background: var(--color-bg-surface-2);
}

.style-card__preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.style-card__image-fallback {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--color-fg-muted);
  background: linear-gradient(135deg, var(--color-bg-surface-2), var(--color-bg-subtle));
}

.style-card__selected-badge,
.style-card__busy {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  color: var(--color-accent-fg);
  background: var(--color-accent);
  box-shadow: var(--shadow-sm);
}

.style-card__busy {
  color: var(--color-fg-secondary);
  background: var(--color-bg-elevated);
}

.style-card__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
}

.style-card__name {
  overflow: hidden;
  color: var(--color-fg-primary);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.style-card__description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-fg-tertiary);
  font-size: var(--fs-sm);
  line-height: var(--lh-normal);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.style-card__actions {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--space-3) var(--space-3);
}

.saved-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: auto;
  color: var(--color-success);
  font-size: var(--fs-sm);
}

.card-action,
.icon-action,
.text-action,
.text-danger {
  border: 0;
  background: transparent;
  color: var(--color-fg-tertiary);
  cursor: pointer;
  font-family: inherit;
}

.card-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}

.card-action:hover,
.icon-action:hover,
.text-action:hover {
  color: var(--color-accent-hover);
  background: var(--color-bg-subtle);
}

.manage-actions,
.rename-form,
.delete-confirm {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
}

.icon-action {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
}

.icon-action--danger:hover,
.text-danger {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.rename-input {
  min-width: 0;
  flex: 1;
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-fg-secondary);
  background: var(--color-bg-elevated);
  font: inherit;
}

.delete-confirm {
  color: var(--color-fg-tertiary);
  font-size: var(--fs-sm);
}

.text-action,
.text-danger {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
}

@media (prefers-reduced-motion: reduce) {
  .style-card {
    transition: none;
  }

  .style-card:hover {
    transform: none;
  }
}
</style>
