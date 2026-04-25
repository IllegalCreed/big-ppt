<script setup lang="ts">
import { onUnmounted, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  templateName: string
  snapshotVersionId: number | null
  /** 测试用：禁用 Teleport（与 TemplatePickerModal 保持一致） */
  disableTeleport?: boolean
}>()

const emit = defineEmits<{
  close: []
  undo: [snapshotVersionId: number]
}>()

let timer: ReturnType<typeof setTimeout> | null = null

function armAutoClose() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => emit('close'), 6000)
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) armAutoClose()
    else clearTimer()
  },
  { immediate: true },
)

onUnmounted(() => {
  clearTimer()
})

function onUndoClick(e: Event) {
  e.preventDefault()
  if (props.snapshotVersionId !== null) emit('undo', props.snapshotVersionId)
}

function onClose() {
  emit('close')
}
</script>

<template>
  <Teleport to="body" :disabled="disableTeleport">
    <Transition name="toast">
      <div v-if="visible" class="undo-toast" role="status">
        <span class="undo-toast__text">
          ✓ 已切换到「{{ templateName }}」 · 不满意？
          <a
            href="#"
            class="undo-toast__link"
            data-undo-link
            @click="onUndoClick"
          >/undo 回退</a>
        </span>
        <button
          type="button"
          class="undo-toast__close"
          aria-label="关闭"
          data-close
          @click="onClose"
        >×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.undo-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-fg-primary);
  color: var(--color-bg-elevated);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-lg);
  font-size: var(--fs-sm);
  font-family: var(--font-sans);
  max-width: 600px;
}
.undo-toast__link {
  color: var(--color-accent-fg);
  text-decoration: underline;
  font-weight: var(--fw-medium);
}
.undo-toast__close {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
}
.undo-toast__close:hover {
  opacity: 1;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
