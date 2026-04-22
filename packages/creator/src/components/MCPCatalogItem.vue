<!-- packages/creator/src/components/MCPCatalogItem.vue -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'

const props = defineProps<{ server: McpServerWithStatus; llm: LLMSettings }>()
const emit = defineEmits<{ update: [patch: UpdateMcpServerRequest] }>()

const bearerFromAuth = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7) : (h ?? ''))
const apiKey = ref(bearerFromAuth(props.server.headers.Authorization))
const reuseLlmKey = ref(
  apiKey.value !== '' && apiKey.value === props.llm.apiKey && props.server.id.startsWith('zhipu-'),
)

watch(
  () => props.server.headers.Authorization,
  (v) => (apiKey.value = bearerFromAuth(v)),
)

const canReuse = computed(
  () => props.server.id.startsWith('zhipu-') && props.llm.provider === 'zhipu' && !!props.llm.apiKey,
)
const effectiveKey = computed(() => (reuseLlmKey.value && canReuse.value ? props.llm.apiKey : apiKey.value))

function applyKey() {
  emit('update', {
    headers: effectiveKey.value ? { Authorization: `Bearer ${effectiveKey.value}` } : {},
  })
}

function toggleEnabled(v: boolean) {
  if (v && !effectiveKey.value) {
    alert('请先填入 API Key 或勾选"复用 LLM Key"')
    return
  }
  emit('update', {
    enabled: v,
    headers: effectiveKey.value ? { Authorization: `Bearer ${effectiveKey.value}` } : {},
  })
}

const statusText = computed(() => {
  switch (props.server.status.state) {
    case 'ok':
      return `已连接(${props.server.status.toolCount ?? 0} 个工具)`
    case 'connecting':
      return '连接中...'
    case 'error':
      return `错误:${props.server.status.error ?? ''}`
    case 'disabled':
    default:
      return '未启用'
  }
})
</script>

<template>
  <div class="mcp-card" :class="`mcp-card--${server.status.state}`">
    <div class="mcp-card__head">
      <div class="mcp-card__title">
        <span>{{ server.displayName }}</span>
        <span v-if="server.badge" class="mcp-badge">{{ server.badge }}</span>
      </div>
      <label class="mcp-switch">
        <input
          type="checkbox"
          :checked="server.enabled"
          @change="toggleEnabled(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ server.enabled ? '已启用' : '未启用' }}</span>
      </label>
    </div>

    <p class="mcp-card__desc">{{ server.description }}</p>

    <div class="mcp-card__form">
      <label v-if="canReuse" class="mcp-reuse">
        <input v-model="reuseLlmKey" type="checkbox" @change="applyKey" />
        复用 LLM API Key(智谱)
      </label>
      <input
        v-if="!reuseLlmKey"
        v-model="apiKey"
        type="password"
        placeholder="输入此 MCP 的 API Key"
        @blur="applyKey"
      />
    </div>

    <div class="mcp-card__status">{{ statusText }}</div>
  </div>
</template>

<style scoped>
.mcp-card { border: 1px solid #eee; border-radius: 8px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.mcp-card--ok { border-color: #52c41a; }
.mcp-card--error { border-color: #ff4d4f; }
.mcp-card__head { display: flex; justify-content: space-between; align-items: center; }
.mcp-card__title { font-weight: 600; display: flex; gap: 8px; align-items: center; }
.mcp-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #f0f5ff; color: #1677ff; }
.mcp-card__desc { font-size: 12px; color: #666; margin: 0; }
.mcp-card__form input[type='password'] { width: 100%; padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.mcp-reuse { display: flex; gap: 6px; font-size: 12px; color: #333; }
.mcp-switch { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #333; }
.mcp-card__status { font-size: 11px; color: #999; }
.mcp-card--error .mcp-card__status { color: #ff4d4f; }
.mcp-card--ok .mcp-card__status { color: #52c41a; }
</style>
