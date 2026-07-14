<script setup lang="ts">
import { computed, h, inject, onUnmounted, ref } from 'vue'
import { Bubble, Sender, Suggestion } from '@antdv-next/x'
import type { SenderRef } from '@antdv-next/x'
import { DECK_CHAT_CONTEXT, useAIChat } from '../composables/useAIChat'
import { useImageStyleLibrary } from '../composables/useImageStyleLibrary'
import { useSlashCommands } from '../composables/useSlashCommands'
import { useUploads } from '../composables/useUploads'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolExecutionBlock from './ToolExecutionBlock.vue'
import ImageJobsPanel from './ImageJobsPanel.vue'
import UploadButton from './UploadButton.vue'
import UploadProgress from './UploadProgress.vue'

const {
  chatMessages,
  streamingContent,
  thinkingContent,
  currentToolExecutions,
  imageJobs,
  status,
  statusText,
  isGenerating,
  sendMessage,
  cancel,
  clearHistory,
  dispose,
  appendLocalMessage,
  retryLastUserMessage,
  dismissImageJob,
} = useAIChat()

onUnmounted(dispose)

const senderRef = ref<SenderRef | null>(null)

// 只有首次风格决策会锁输入；普通浏览风格库和后台 AI 探索不影响聊天。
const imageStyleLibrary = useImageStyleLibrary()
const inputDisabled = computed(() => imageStyleLibrary.decisionPending.value)
const inputPlaceholder = computed(() =>
  imageStyleLibrary.decisionPending.value
    ? '请先选定配图风格（或暂不指定）再继续 →'
    : '描述你想要的幻灯片，或输入 / 查看指令...',
)

// 斜杠指令（/clear / /retry / /undo / /redo / /log / /help）
const deckContext = inject(DECK_CHAT_CONTEXT)
if (!deckContext) throw new Error('ChatPanel 必须挂载在 DeckEditorCanvas 内')
const slash = useSlashCommands({
  deckId: deckContext.deckId,
  clearHistory,
  appendLocalMessage,
  retryLastUserMessage,
})

function handleSlashSelect(value: string) {
  senderRef.value?.clear()
  slash.handleSlashSelect(value)
}

// --- Bubble 列表 ---
//
// Phase 12.7：删除了「每个历史 bubble 上挂 toolSteps」的 inline 渲染——
// chatMessages 来自 backend refresh 的 deck_chats（仅 user/assistant text）。
// 当前轮的工具执行进度走 `currentToolExecutions` Map，作为独立 live bubble 显示。

interface BubbleItem {
  key: string
  // 'ai-tools' 是 Phase 12.7 新增：当前轮在跑的 tool_execution 列表
  role: 'user' | 'ai' | 'ai-thinking' | 'ai-tools'
  content: unknown
  loading?: boolean
}

const bubbleItems = computed(() => {
  const items: BubbleItem[] = []

  for (const [i, msg] of chatMessages.value.entries()) {
    if (msg.role === 'user') {
      items.push({ key: `u-${i}`, role: 'user', content: msg.content })
      continue
    }
    if (msg.content) {
      items.push({ key: `a-${i}`, role: 'ai', content: msg.content })
    }
  }

  // 当前轮的 thinking 实时缓冲
  if (thinkingContent.value) {
    items.push({
      key: 'live-thinking',
      role: 'ai-thinking',
      content: h(ThinkingBlock, { text: thinkingContent.value }),
    })
  }

  // 当前轮的 tool 执行列表（每个 toolCallId 一个 ToolExecutionBlock）
  if (currentToolExecutions.value.size > 0) {
    const toolNodes = [...currentToolExecutions.value.entries()].map(([id, st]) =>
      h(ToolExecutionBlock, {
        key: id,
        toolName: st.toolName,
        state: st.state,
        argsPreview: st.argsPreview,
        resultPreview: st.resultPreview,
      }),
    )
    items.push({
      key: 'live-tools',
      role: 'ai-tools',
      content: h('div', { class: 'tool-exec-stack' }, toolNodes),
    })
  }

  // 当前轮的 assistant 文字（streaming 缓冲）
  if (streamingContent.value) {
    items.push({ key: 'live-text', role: 'ai', content: streamingContent.value })
  } else if (status.value === 'sending') {
    items.push({ key: 'live-think', role: 'ai', content: '', loading: true })
  }

  return items
})

const roles = computed(() => ({
  user: {
    placement: 'end' as const,
    variant: 'filled' as const,
    shape: 'round' as const,
  },
  ai: {
    placement: 'start' as const,
    variant: 'outlined' as const,
    shape: 'round' as const,
  },
  'ai-thinking': {
    placement: 'start' as const,
    variant: 'borderless' as const,
  },
  'ai-tools': {
    placement: 'start' as const,
    variant: 'borderless' as const,
  },
}))

// --- 提交 ---

function handleSubmit(message: string) {
  const trimmed = message.trim()
  if (!trimmed) return
  // 首次决策时 Sender 已 disabled,但防御性短路防键盘 enter
  // 提交穿透(Sender 内部 submit 事件可能不严格遵守 disabled)
  if (inputDisabled.value) return
  senderRef.value?.clear()
  // 斜杠指令：直接输完按 enter 没走候选列表的情况，由 composable 处理
  if (slash.handleSlashSubmit(trimmed)) return
  void sendMessage(trimmed)
}

function handleCancel() {
  cancel()
}

function handleRetry() {
  if (inputDisabled.value) return
  retryLastUserMessage()
}

// --- Phase 13 Task F:文件上传 chip 列表(显示最近 8 次状态,2s 后 done chip 自动消失) ---
interface UploadChip {
  key: string
  filename: string
  sizeBytes: number
  status: 'uploading' | 'done' | 'error'
  errorMsg?: string
}

const uploadChips = ref<UploadChip[]>([])
let chipKeySeq = 0

function pushChip(chip: Omit<UploadChip, 'key'>): string {
  const key = `up-${++chipKeySeq}`
  uploadChips.value = [...uploadChips.value, { key, ...chip }].slice(-8)
  return key
}

function onUploadUploaded(asset: { id: string; filename: string; sizeBytes: number }) {
  const key = pushChip({ filename: asset.filename, sizeBytes: asset.sizeBytes, status: 'done' })
  // 2s 后自动从列表移除已成功的 chip
  setTimeout(() => {
    uploadChips.value = uploadChips.value.filter((c) => c.key !== key)
  }, 2500)
}

function onUploadError(msg: string) {
  pushChip({ filename: '上传失败', sizeBytes: 0, status: 'error', errorMsg: msg })
}

// 拖拽到 sender-area 任意位置
function onSenderDragOver(e: DragEvent) {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault()
  }
}

const { uploadFile } = useUploads()

async function onSenderDrop(e: DragEvent) {
  e.preventDefault()
  if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return
  for (const file of Array.from(e.dataTransfer.files)) {
    const chipKey = pushChip({
      filename: file.name,
      sizeBytes: file.size,
      status: 'uploading',
    })
    try {
      await uploadFile(file)
      uploadChips.value = uploadChips.value.map((c) =>
        c.key === chipKey ? { ...c, status: 'done' as const } : c,
      )
      setTimeout(() => {
        uploadChips.value = uploadChips.value.filter((c) => c.key !== chipKey)
      }, 2500)
    } catch (err) {
      uploadChips.value = uploadChips.value.map((c) =>
        c.key === chipKey
          ? { ...c, status: 'error' as const, errorMsg: (err as Error).message }
          : c,
      )
    }
  }
}
</script>

<template>
  <div class="chat-panel">
    <!-- 状态栏 -->
    <div
      v-if="isGenerating || status === 'error'"
      class="status-bar"
      :class="{ 'status-bar-error': status === 'error' }"
    >
      <span class="status-dot"></span>
      <span class="status-text">{{ statusText }}</span>
      <button v-if="isGenerating" class="cancel-btn" @click="handleCancel">取消</button>
      <button
        v-else-if="status === 'error'"
        class="cancel-btn"
        :disabled="inputDisabled"
        @click="handleRetry"
      >
        重试
      </button>
    </div>

    <!-- 消息列表 -->
    <div class="message-list">
      <Bubble.List :items="bubbleItems" :role="roles" :auto-scroll="true" />
    </div>

    <!-- Phase 12.7 dogfood:image-gen 实时进度面板,sticky 在 sender 上方,
         跨 turn / 跨 bubble 汇总所有图片任务,4 状态 chip + 进度条。 -->
    <ImageJobsPanel :jobs="imageJobs" @dismiss="dismissImageJob" />

    <!-- 输入框（包 Suggestion 做斜杠指令自动补全）+ Phase 13 文件上传 chip + paperclip -->
    <div class="sender-area" @dragover="onSenderDragOver" @drop="onSenderDrop">
      <div v-if="uploadChips.length > 0" class="upload-chip-row">
        <UploadProgress
          v-for="chip in uploadChips"
          :key="chip.key"
          :filename="chip.filename"
          :size-bytes="chip.sizeBytes"
          :status="chip.status"
          :error-msg="chip.errorMsg"
        />
      </div>
      <div class="sender-row">
        <UploadButton
          class="sender-upload-btn"
          @uploaded="onUploadUploaded"
          @error="onUploadError"
        />
        <div class="sender-input-wrap">
          <Suggestion :items="slash.slashItems" :block="true" @select="handleSlashSelect">
            <template #default="{ onTrigger, onKeyDown }">
              <Sender
                ref="senderRef"
                :loading="isGenerating"
                :disabled="inputDisabled"
                :placeholder="inputPlaceholder"
                :submit-type="'enter'"
                :on-key-down="onKeyDown"
                @change="(val: string) => slash.handleSenderChange(val, onTrigger)"
                @submit="handleSubmit"
                @cancel="handleCancel"
              />
            </template>
          </Suggestion>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-surface);
}

.status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent-soft);
  border-bottom: 1px solid var(--color-accent);
  font-size: var(--fs-base);
  color: var(--color-accent-hover);
}

.status-bar-error {
  background: var(--color-danger-soft, #fee);
  border-bottom-color: var(--color-danger, #c33);
  color: var(--color-danger, #c33);
}

.status-bar-error .status-dot {
  background: var(--color-danger, #c33);
  animation: none;
}

.status-bar-error .cancel-btn {
  border-color: var(--color-danger, #c33);
  color: var(--color-danger, #c33);
}

.status-bar-error .cancel-btn:hover {
  background: var(--color-danger, #c33);
  color: var(--color-bg-surface, #fff);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.status-text {
  flex: 1;
}

.cancel-btn {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-accent-hover);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.cancel-btn:hover {
  background: var(--color-accent);
  color: var(--color-accent-fg);
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
}

.sender-area {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--color-border-subtle);
}

.upload-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.sender-row {
  display: flex;
  gap: var(--space-2);
  align-items: flex-end;
}

.sender-upload-btn {
  flex-shrink: 0;
  /* 跟 Sender 内置的 send 按钮(antd-x .ant-btn-primary,位于输入框右下角)底边对齐。
     Sender 内部有 padding,文本框底边比 send 按钮底边低 9px(2026-05-18 实测);
     这里让 paperclip 向上挪让两侧 32×32 圆按钮 baseline 一致,视觉上左右对称呼应。*/
  align-self: flex-end;
  margin-bottom: 13px;
}

.sender-input-wrap {
  flex: 1;
  min-width: 0;
}

.tool-exec-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
