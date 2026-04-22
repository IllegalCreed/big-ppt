<!-- packages/creator/src/components/MCPCustomServer.vue -->
<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { CreateMcpServerRequest, McpServerWithStatus } from '@big-ppt/shared'
import { ChevronDown, Link2, Plus, Trash2 } from 'lucide-vue-next'

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

function removeHeader(k: string) {
  const next = { ...(form.headers ?? {}) }
  delete next[k]
  form.headers = next
}

function submit() {
  if (!form.id || !form.displayName || !form.url) {
    alert('id / 名称 / URL 三项必填')
    return
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(form.id)) {
    alert('id 只能包含字母、数字、- 和 _')
    return
  }
  pendingId.value = form.id
  emit('create', { ...form })
}

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
      expanded.value = false
    }
  },
)
</script>

<template>
  <div class="mcp-custom">
    <ul v-if="customServers.length > 0" class="mcp-custom__list">
      <li v-for="srv in customServers" :key="srv.id" class="mcp-custom__row">
        <div class="mcp-custom__row-info">
          <span class="mcp-custom__row-name">{{ srv.displayName }}</span>
          <span class="mcp-custom__row-url">
            <Link2 :size="12" :stroke-width="1.8" />
            {{ srv.url }}
          </span>
        </div>
        <button
          type="button"
          class="mcp-custom__row-remove"
          :title="`删除 ${srv.displayName}`"
          :aria-label="`删除 ${srv.displayName}`"
          @click="emit('remove', srv.id)"
        >
          <Trash2 :size="14" :stroke-width="1.8" />
        </button>
      </li>
    </ul>

    <button
      type="button"
      class="mcp-custom__toggle"
      :class="{ 'mcp-custom__toggle--open': expanded }"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="mcp-custom__toggle-icon">
        <Plus v-if="!expanded" :size="14" :stroke-width="2" />
        <ChevronDown v-else :size="14" :stroke-width="2" />
      </span>
      {{ expanded ? '收起表单' : '添加自定义 MCP' }}
    </button>

    <div v-if="expanded" class="mcp-custom__form">
      <div class="mcp-custom__field">
        <label class="mcp-custom__label">ID</label>
        <input v-model="form.id" class="mcp-custom__input" placeholder="my-mcp（字母/数字/-/_）" />
      </div>
      <div class="mcp-custom__field">
        <label class="mcp-custom__label">显示名</label>
        <input v-model="form.displayName" class="mcp-custom__input" placeholder="我的 MCP 服务" />
      </div>
      <div class="mcp-custom__field">
        <label class="mcp-custom__label">Endpoint URL</label>
        <input
          v-model="form.url"
          class="mcp-custom__input"
          placeholder="https://your-mcp/endpoint/mcp"
        />
      </div>
      <div class="mcp-custom__field">
        <label class="mcp-custom__label">说明（可选）</label>
        <input
          v-model="form.description"
          class="mcp-custom__input"
          placeholder="一句话描述这个 MCP"
        />
      </div>

      <div class="mcp-custom__field">
        <label class="mcp-custom__label">Headers（可选）</label>
        <ul v-if="Object.keys(form.headers ?? {}).length > 0" class="mcp-custom__header-list">
          <li v-for="(v, k) in form.headers" :key="k" class="mcp-custom__header-item">
            <code>{{ k }}: {{ v }}</code>
            <button type="button" class="mcp-custom__header-remove" @click="removeHeader(k)">
              <Trash2 :size="12" :stroke-width="1.8" />
            </button>
          </li>
        </ul>
        <div class="mcp-custom__header-add">
          <input v-model="headerKey" class="mcp-custom__input" placeholder="Header 名" />
          <input v-model="headerValue" class="mcp-custom__input" placeholder="Header 值" />
          <button type="button" class="mcp-custom__header-add-btn" @click="addHeader">
            <Plus :size="14" :stroke-width="2" />
          </button>
        </div>
      </div>

      <button type="button" class="mcp-custom__submit" @click="submit">创建</button>
    </div>
  </div>
</template>

<style scoped>
.mcp-custom {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* ---- List of existing custom ---- */
.mcp-custom__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.mcp-custom__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mcp-custom__row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mcp-custom__row-name {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--color-fg-primary);
}

.mcp-custom__row-url {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
  font-family: var(--font-mono);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-custom__row-remove {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--color-fg-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mcp-custom__row-remove:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

/* ---- Toggle button ---- */
.mcp-custom__toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-fg-tertiary);
  font-size: var(--fs-base);
  font-family: inherit;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.mcp-custom__toggle:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.mcp-custom__toggle--open {
  border-style: solid;
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.mcp-custom__toggle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* ---- Form ---- */
.mcp-custom__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.mcp-custom__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.mcp-custom__label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--color-fg-secondary);
}

.mcp-custom__input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-fg-primary);
  font-size: var(--fs-sm);
  font-family: var(--font-sans);
  outline: none;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.mcp-custom__input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

/* ---- Headers ---- */
.mcp-custom__header-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0 0 var(--space-2);
  padding: 0;
  list-style: none;
}

.mcp-custom__header-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-sm);
}

.mcp-custom__header-item code {
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  color: var(--color-fg-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-custom__header-remove {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--color-fg-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.mcp-custom__header-remove:hover {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

.mcp-custom__header-add {
  display: grid;
  grid-template-columns: 1fr 1fr 32px;
  gap: var(--space-2);
}

.mcp-custom__header-add-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg-surface);
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.mcp-custom__header-add-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* ---- Submit ---- */
.mcp-custom__submit {
  align-self: flex-start;
  padding: var(--space-2) var(--space-5);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.mcp-custom__submit:hover {
  background: var(--color-accent-hover);
}
</style>
