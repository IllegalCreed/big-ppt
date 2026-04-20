<script setup lang="ts">
import { computed } from 'vue'
import { Bubble, Sender } from '@antdv-next/x'
import { useAIChat } from '../composables/useAIChat'

const {
  chatMessages,
  streamingContent,
  status,
  statusText,
  isGenerating,
  sendMessage,
  cancel,
} = useAIChat()

const bubbleItems = computed(() => {
  const items: any[] = chatMessages.value.map((msg, i) => ({
    key: `msg-${i}`,
    role: msg.role === 'user' ? 'user' : 'ai',
    content: msg.content,
  }))

  // 流式输出时追加一个正在生成的气泡
  if (streamingContent.value) {
    items.push({
      key: 'streaming',
      role: 'ai',
      content: streamingContent.value,
      streaming: true,
    })
  }

  return items
})

const roles = {
  user: {
    placement: 'end' as const,
    variant: 'filled' as const,
    shape: 'round' as const,
  },
  ai: {
    placement: 'start' as const,
    variant: 'outlined' as const,
    shape: 'round' as const,
    loading: status.value === 'thinking',
  },
}

function handleSubmit(message: string) {
  if (!message.trim()) return
  sendMessage(message.trim())
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
      <Bubble.List
        :items="bubbleItems"
        :roles="roles"
        :auto-scroll="true"
      />
    </div>

    <!-- 输入框 -->
    <div class="sender-area">
      <Sender
        :loading="isGenerating"
        placeholder="描述你想要的幻灯片..."
        :submit-type="'enter'"
        @submit="handleSubmit"
        @cancel="handleCancel"
      />
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
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
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
