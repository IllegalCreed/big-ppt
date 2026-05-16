<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { Bubble, Sender, Suggestion } from '@antdv-next/x'
import type { SenderRef } from '@antdv-next/x'
import { useAIChat } from '../composables/useAIChat'
import { useSlashCommands } from '../composables/useSlashCommands'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolExecutionBlock from './ToolExecutionBlock.vue'

const {
  chatMessages,
  streamingContent,
  thinkingContent,
  currentToolExecutions,
  status,
  statusText,
  isGenerating,
  sendMessage,
  cancel,
  clearHistory,
  appendLocalMessage,
  retryLastUserMessage,
} = useAIChat()

const senderRef = ref<SenderRef | null>(null)

// 斜杠指令（/clear / /retry / /undo / /redo / /log / /help）
const slash = useSlashCommands({ clearHistory, appendLocalMessage, retryLastUserMessage })

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
  senderRef.value?.clear()
  // 斜杠指令：直接输完按 enter 没走候选列表的情况，由 composable 处理
  if (slash.handleSlashSubmit(trimmed)) return
  void sendMessage(trimmed)
}

function handleCancel() {
  cancel()
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
        @click="retryLastUserMessage"
      >重试</button>
    </div>

    <!-- 消息列表 -->
    <div class="message-list">
      <Bubble.List :items="bubbleItems" :role="roles" :auto-scroll="true" />
    </div>

    <!-- 输入框（包 Suggestion 做斜杠指令自动补全） -->
    <div class="sender-area">
      <Suggestion :items="slash.slashItems" :block="true" @select="handleSlashSelect">
        <template #default="{ onTrigger, onKeyDown }">
          <Sender
            ref="senderRef"
            :loading="isGenerating"
            placeholder="描述你想要的幻灯片，或输入 / 查看指令..."
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

.tool-exec-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>
