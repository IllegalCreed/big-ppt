<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { Bubble, Sender, Suggestion, ThoughtChain } from '@antdv-next/x'
import type { SenderRef } from '@antdv-next/x'
import type { ToolStep } from '../composables/useAIChat'
import { useAIChat } from '../composables/useAIChat'
import { useSlashCommands } from '../composables/useSlashCommands'

const {
  chatMessages,
  streamingContent,
  toolSteps,
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

function renderToolChain(steps: ToolStep[]) {
  return h(ThoughtChain, {
    items: steps.map((s) => ({
      key: s.key,
      title: s.label,
      description: s.argsPreview || undefined,
      content: s.error
        ? h(
            'div',
            {
              style: 'color: var(--color-danger); font-size: var(--fs-sm);',
            },
            s.error,
          )
        : undefined,
      status: s.status,
      collapsible: !!s.error,
    })),
  })
}

interface BubbleItem {
  key: string
  role: 'user' | 'ai' | 'ai-chain'
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
    if (msg.toolSteps?.length) {
      items.push({
        key: `a-${i}-chain`,
        role: 'ai-chain',
        content: renderToolChain(msg.toolSteps),
      })
    }
    if (msg.content) {
      items.push({ key: `a-${i}`, role: 'ai', content: msg.content })
    }
  }

  if (toolSteps.value.length > 0) {
    items.push({
      key: 'live-chain',
      role: 'ai-chain',
      content: renderToolChain(toolSteps.value),
    })
  }

  if (streamingContent.value) {
    items.push({ key: 'live-text', role: 'ai', content: streamingContent.value })
  } else if (status.value === 'thinking') {
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
  'ai-chain': {
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
  sendMessage(trimmed)
}

function handleCancel() {
  cancel()
}
</script>

<template>
  <div class="chat-panel">
    <!-- 状态栏 -->
    <div v-if="isGenerating" class="status-bar">
      <span class="status-dot"></span>
      <span class="status-text">{{ statusText }}</span>
      <button class="cancel-btn" @click="handleCancel">取消</button>
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
</style>
