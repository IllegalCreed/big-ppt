<!-- packages/creator/src/components/MCPCustomServer.vue -->
<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { CreateMcpServerRequest, McpServerWithStatus } from '@big-ppt/shared'

const props = defineProps<{ customServers: McpServerWithStatus[] }>()
const emit = defineEmits<{
  create: [req: CreateMcpServerRequest]
  remove: [id: string]
}>()

const expanded = ref(false)
const form = reactive<CreateMcpServerRequest>({
  id: '',
  displayName: '',
  description: '',
  url: '',
  headers: {},
})
const headerKey = ref('')
const headerValue = ref('')
const pendingId = ref<string | null>(null)

function addHeader() {
  if (!headerKey.value) return
  form.headers = { ...(form.headers ?? {}), [headerKey.value]: headerValue.value }
  headerKey.value = ''
  headerValue.value = ''
}

function submit() {
  if (!form.id || !form.displayName || !form.url) {
    alert('id / 名称 / URL 三项必填')
    return
  }
  // 客户端同步 id 格式校验,与 agent 的 /^[a-zA-Z0-9_-]+$/ 一致
  if (!/^[a-zA-Z0-9_-]+$/.test(form.id)) {
    alert('id 只能包含字母、数字、- 和 _')
    return
  }
  pendingId.value = form.id
  emit('create', { ...form })
}

// 监听 customServers 变化,只有当 pending 的 id 出现时才清空表单
watch(
  () => props.customServers.map((s) => s.id).join(','),
  () => {
    if (pendingId.value && props.customServers.some((s) => s.id === pendingId.value)) {
      form.id = ''
      form.displayName = ''
      form.description = ''
      form.url = ''
      form.headers = {}
      pendingId.value = null
    }
  },
)
</script>

<template>
  <div class="mcp-custom">
    <button class="mcp-custom__toggle" @click="expanded = !expanded">
      {{ expanded ? '▼' : '▶' }} 自定义 MCP Server(进阶)
    </button>
    <div v-if="expanded" class="mcp-custom__body">
      <div class="mcp-custom__list">
        <div v-for="srv in customServers" :key="srv.id" class="mcp-custom__row">
          <span>{{ srv.displayName }}</span>
          <code>{{ srv.url }}</code>
          <button @click="emit('remove', srv.id)">删除</button>
        </div>
        <div v-if="customServers.length === 0" class="mcp-custom__empty">尚未添加自定义 MCP</div>
      </div>

      <div class="mcp-custom__form">
        <input v-model="form.id" placeholder="id(字母/数字/-/_)" />
        <input v-model="form.displayName" placeholder="显示名" />
        <input v-model="form.url" placeholder="https://your-mcp/endpoint/mcp" />
        <input v-model="form.description" placeholder="说明(可选)" />
        <div class="mcp-custom__headers">
          <input v-model="headerKey" placeholder="Header Name" />
          <input v-model="headerValue" placeholder="Header Value" />
          <button @click="addHeader">+ 添加 Header</button>
        </div>
        <div v-for="(v, k) in form.headers" :key="k" class="mcp-custom__header-row">
          <span>{{ k }}:{{ v }}</span>
        </div>
        <button class="mcp-custom__submit" @click="submit">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-custom {
  border-top: 1px dashed var(--color-border);
  padding-top: var(--space-4);
}

.mcp-custom__toggle {
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--color-fg-tertiary);
  padding: 0;
  font-family: inherit;
  transition: color var(--dur-fast) var(--ease-out);
}

.mcp-custom__toggle:hover {
  color: var(--color-accent);
}

.mcp-custom__body {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mcp-custom__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mcp-custom__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
}

.mcp-custom__row code {
  color: var(--color-fg-tertiary);
  font-family: var(--font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mcp-custom__row button {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-surface);
  color: var(--color-fg-tertiary);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mcp-custom__row button:hover {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.mcp-custom__empty {
  color: var(--color-fg-muted);
  font-size: var(--fs-sm);
}

.mcp-custom__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mcp-custom__form input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--fs-md);
  color: var(--color-fg-primary);
  background: var(--color-bg-elevated);
  font-family: inherit;
  outline: none;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.mcp-custom__form input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.mcp-custom__headers {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: var(--space-2);
}

.mcp-custom__headers button {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-fg-secondary);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mcp-custom__headers button:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.mcp-custom__header-row {
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  font-family: var(--font-mono);
}

.mcp-custom__submit {
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  font-family: inherit;
  align-self: flex-start;
  transition: background var(--dur-fast) var(--ease-out);
}

.mcp-custom__submit:hover {
  background: var(--color-accent-hover);
}
</style>
