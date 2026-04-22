<!-- packages/creator/src/components/MCPCatalogItem.vue -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'

const props = defineProps<{ server: McpServerWithStatus; llm: LLMSettings }>()
const emit = defineEmits<{ update: [patch: UpdateMcpServerRequest] }>()

const bearerFromAuth = (h: string | undefined) =>
  h?.startsWith('Bearer ') ? h.slice(7) : (h ?? '')
const apiKey = ref(bearerFromAuth(props.server.headers.Authorization))
const reuseLlmKey = ref(
  apiKey.value !== '' && apiKey.value === props.llm.apiKey && props.server.id.startsWith('zhipu-'),
)

watch(
  () => props.server.headers.Authorization,
  (v) => (apiKey.value = bearerFromAuth(v)),
)

const canReuse = computed(
  () =>
    props.server.id.startsWith('zhipu-') && props.llm.provider === 'zhipu' && !!props.llm.apiKey,
)
const effectiveKey = computed(() =>
  reuseLlmKey.value && canReuse.value ? props.llm.apiKey : apiKey.value,
)

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
.mcp-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  background: var(--color-bg-surface);
  transition:
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.mcp-card:hover {
  box-shadow: var(--shadow-xs);
}

/* 状态态用左侧 3px 内阴影条，避免整圈染色让卡片"看起来坏了" */
.mcp-card--ok {
  box-shadow: inset 3px 0 0 var(--color-success);
}

.mcp-card--error {
  box-shadow: inset 3px 0 0 var(--color-danger);
}

.mcp-card--connecting {
  box-shadow: inset 3px 0 0 var(--color-warning);
}

.mcp-card--ok:hover {
  box-shadow:
    inset 3px 0 0 var(--color-success),
    var(--shadow-xs);
}

.mcp-card--error:hover {
  box-shadow:
    inset 3px 0 0 var(--color-danger),
    var(--shadow-xs);
}

.mcp-card--connecting:hover {
  box-shadow:
    inset 3px 0 0 var(--color-warning),
    var(--shadow-xs);
}

.mcp-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
}

.mcp-card__title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.mcp-badge {
  font-size: var(--fs-sm);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-accent-soft);
  color: var(--color-accent-hover);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
}

.mcp-card__desc {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  line-height: var(--lh-normal);
  margin: 0;
}

.mcp-card__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mcp-card__form input[type='password'] {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  color: var(--color-fg-primary);
  background: var(--color-bg-elevated);
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.mcp-card__form input[type='password']:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.mcp-reuse {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  cursor: pointer;
}

.mcp-switch {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.mcp-card__status {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  line-height: var(--lh-tight);
}

.mcp-card--ok .mcp-card__status {
  color: var(--color-success);
}

.mcp-card--error .mcp-card__status {
  color: var(--color-danger);
}

.mcp-card--connecting .mcp-card__status {
  color: var(--color-warning);
}
</style>
