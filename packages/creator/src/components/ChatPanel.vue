<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { Bubble, Sender, Suggestion, ThoughtChain } from '@antdv-next/x'
import type { SenderRef } from '@antdv-next/x'
import type { ToolStep } from '../composables/useAIChat'
import { useAIChat } from '../composables/useAIChat'

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

// --- 斜杠指令 ---

interface SlashCommand {
  value: string
  label: string
  description: string
  run: () => void | Promise<void>
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    value: 'clear',
    label: '/clear',
    description: '清空当前对话记录',
    run: () => {
      clearHistory()
      appendLocalMessage('对话已清空。')
    },
  },
  {
    value: 'retry',
    label: '/retry',
    description: '重试上一条用户消息',
    run: () => retryLastUserMessage(),
  },
  {
    value: 'undo',
    label: '/undo',
    description: '恢复到上一次修改前的 slides.md',
    run: async () => {
      try {
        const res = await fetch('/api/restore-slides', { method: 'POST' })
        const data = await res.json()
        appendLocalMessage(data.success ? `✅ ${data.message}` : `❌ ${data.error}`)
      } catch (err: any) {
        appendLocalMessage(`❌ 恢复失败：${err.message}`)
      }
    },
  },
  {
    value: 'log',
    label: '/log',
    description: '查看最近一次会话的日志摘要',
    run: async () => {
      try {
        const res = await fetch('/api/log/latest')
        const data = await res.json()
        if (!data.success) {
          appendLocalMessage(`❌ ${data.error}`)
          return
        }
        const events = data.events as any[]
        if (events.length === 0) {
          appendLocalMessage('还没有会话日志。')
          return
        }
        const lines = [`**会话 \`${data.session.slice(0, 8)}\` 共 ${events.length} 个事件：**`, '']
        for (const e of events) {
          const ts = new Date(e.ts).toLocaleTimeString()
          if (e.kind === 'user_message') lines.push(`[${ts}] 👤 ${e.text}`)
          else if (e.kind === 'llm_request')
            lines.push(
              `[${ts}] 🧠 LLM 请求（${e.messages_count} 条上下文 / ${e.tools_count} 个工具）`,
            )
          else if (e.kind === 'llm_response')
            lines.push(
              `[${ts}] 💬 LLM 响应（${e.duration_ms}ms，${e.tool_calls_count} 个 tool call）`,
            )
          else if (e.kind === 'tool_call')
            lines.push(`[${ts}] 🔧 调用 \`${e.tool}\` ${e.args || ''}`)
          else if (e.kind === 'tool_result')
            lines.push(
              `[${ts}] ${e.success ? '✓' : '✗'} \`${e.tool}\` ${e.duration_ms}ms${e.error ? ' · ' + e.error : ''}`,
            )
          else if (e.kind === 'session_end')
            lines.push(`[${ts}] 🏁 结束（${e.reason}，总耗时 ${e.duration_ms}ms）`)
        }
        appendLocalMessage(lines.join('\n'))
      } catch (err: any) {
        appendLocalMessage(`❌ 读取日志失败：${err.message}`)
      }
    },
  },
  {
    value: 'help',
    label: '/help',
    description: '列出所有可用指令',
    run: () => {
      const lines = ['**可用斜杠指令：**', '']
      for (const c of SLASH_COMMANDS) {
        lines.push(`- \`${c.label}\` — ${c.description}`)
      }
      appendLocalMessage(lines.join('\n'))
    },
  },
]

const slashItems = (info?: { query?: string }) => {
  const q = (info?.query ?? '').toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.value.startsWith(q)).map((c) => ({
    value: c.value,
    label: h(
      'div',
      {
        style:
          'display: flex; gap: 12px; align-items: center; font-family: -apple-system, sans-serif;',
      },
      [
        h('span', { style: 'color: #1677ff; font-weight: 600;' }, c.label),
        h('span', { style: 'color: #999; font-size: 12px;' }, c.description),
      ],
    ),
  }))
}

function handleSlashSelect(value: string) {
  const cmd = SLASH_COMMANDS.find((c) => c.value === value)
  senderRef.value?.clear()
  if (cmd) cmd.run()
}

function handleSenderChange(value: string, onTrigger: (info: any) => void) {
  if (value === '') {
    onTrigger(false)
    return
  }
  if (value.startsWith('/')) {
    onTrigger({ query: value.slice(1).toLowerCase() })
  } else {
    onTrigger(false)
  }
}

// --- Bubble 列表 ---

function renderToolChain(steps: ToolStep[]) {
  return h(ThoughtChain, {
    items: steps.map((s) => ({
      key: s.key,
      title: s.label,
      description: s.argsPreview || undefined,
      content: s.error
        ? h('div', { style: 'color: #ff4d4f; font-size: 12px;' }, s.error)
        : undefined,
      status: s.status,
      collapsible: !!s.error,
    })),
  })
}

const bubbleItems = computed(() => {
  const items: any[] = []

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

  // 如果刚好完整匹配某条指令（用户直接输完按 enter，没走候选列表）
  if (trimmed.startsWith('/')) {
    const name = trimmed.slice(1).split(/\s+/)[0]
    const cmd = SLASH_COMMANDS.find((c) => c.value === name)
    if (cmd) {
      cmd.run()
      return
    }
    appendLocalMessage(`未知指令 \`${trimmed}\`。输入 \`/help\` 查看全部指令。`)
    return
  }

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
      <Suggestion :items="slashItems" :block="true" @select="handleSlashSelect">
        <template #default="{ onTrigger, onKeyDown }">
          <Sender
            ref="senderRef"
            :loading="isGenerating"
            placeholder="描述你想要的幻灯片，或输入 / 查看指令..."
            :submit-type="'enter'"
            :on-key-down="onKeyDown"
            @change="(val: string) => handleSenderChange(val, onTrigger)"
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
  background: #fff;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #e6f4ff;
  border-bottom: 1px solid #91caff;
  font-size: 13px;
  color: #1677ff;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #1677ff;
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
  padding: 2px 8px;
  border: 1px solid #1677ff;
  border-radius: 4px;
  background: transparent;
  color: #1677ff;
  font-size: 12px;
  cursor: pointer;
}

.cancel-btn:hover {
  background: #1677ff;
  color: #fff;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.sender-area {
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
