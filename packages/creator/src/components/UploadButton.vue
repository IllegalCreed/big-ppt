<script setup lang="ts">
/** Phase 13 Task F:ChatPanel sender 区 paperclip 按钮 + 隐藏 file input + 拖拽 zone。 */
import { ref } from 'vue'
import { Paperclip } from 'lucide-vue-next'
import { useUploads, type QuotaInfo } from '../composables/useUploads'

const emit = defineEmits<{
  uploaded: [asset: { id: string; filename: string; sizeBytes: number }]
  error: [message: string]
  'quota-update': [quota: QuotaInfo]
}>()

const { uploadFile, uploading } = useUploads()
const inputRef = ref<HTMLInputElement | null>(null)

async function handleFiles(fileList: FileList | File[]) {
  for (const file of Array.from(fileList)) {
    try {
      const { asset, quota } = await uploadFile(file)
      emit('uploaded', { id: asset.id, filename: asset.filename, sizeBytes: asset.sizeBytes })
      emit('quota-update', quota)
    } catch (e) {
      emit('error', (e as Error).message)
    }
  }
}

function onPick() {
  inputRef.value?.click()
}

function onChange(e: Event) {
  const t = e.target as HTMLInputElement
  if (t.files && t.files.length > 0) void handleFiles(t.files)
  // 允许用户连续选同一文件:reset input value
  if (t) t.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    void handleFiles(e.dataTransfer.files)
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}
</script>

<template>
  <button
    type="button"
    class="upload-button"
    :disabled="uploading"
    :title="uploading ? '上传中...' : '上传文件'"
    aria-label="上传文件"
    @click="onPick"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <Paperclip :size="18" :stroke-width="1.8" />
    <input
      ref="inputRef"
      type="file"
      multiple
      hidden
      accept=".pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/gif,text/markdown,text/plain,text/csv"
      data-testid="upload-button-input"
      @change="onChange"
    />
  </button>
</template>

<style scoped>
.upload-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-fg-tertiary);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.upload-button:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-bg-subtle);
}
.upload-button:disabled {
  opacity: 0.5;
  cursor: wait;
}
</style>
