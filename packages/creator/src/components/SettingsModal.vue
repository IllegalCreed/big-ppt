<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'
import { useMCP } from '../composables/useMCP'
import MCPCatalogItem from './MCPCatalogItem.vue'
import MCPCustomServer from './MCPCustomServer.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const PROVIDERS = [
  { key: 'zhipu', name: '智谱 (GLM)', defaultModel: 'GLM-5.1' },
  { key: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat' },
  { key: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o' },
  { key: 'moonshot', name: 'Moonshot (Kimi)', defaultModel: 'moonshot-v1-8k' },
  { key: 'qwen', name: '千问 (Qwen)', defaultModel: 'qwen-plus' },
  { key: 'custom', name: '自定义', defaultModel: '' },
]

const activeTab = ref<'llm' | 'mcp'>('llm')
const settings = ref<LLMSettings>(loadSettings())
const { servers, refresh, create, update, remove } = useMCP()

const presetServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => s.preset))
const customServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => !s.preset))

function loadSettings(): LLMSettings {
  const raw = localStorage.getItem('llm-settings')
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {}
  }
  return { provider: 'zhipu', apiKey: '', model: 'GLM-5.1' }
}

function onProviderChange() {
  const p = PROVIDERS.find((p) => p.key === settings.value.provider)
  if (p && p.defaultModel) settings.value.model = p.defaultModel
}

function saveLlm() {
  localStorage.setItem('llm-settings', JSON.stringify(settings.value))
  emit('update:open', false)
}

function close() {
  emit('update:open', false)
}

async function handleUpdate(id: string, patch: UpdateMcpServerRequest) {
  try {
    await update(id, patch)
  } catch (err) {
    alert(`MCP 更新失败:${(err as Error).message}`)
  }
}

async function handleCreate(req: Parameters<typeof create>[0]) {
  try {
    await create(req)
  } catch (err) {
    alert(`创建失败:${(err as Error).message}`)
  }
}

async function handleRemove(id: string) {
  if (!confirm('确认删除此自定义 MCP?')) return
  try {
    await remove(id)
  } catch (err) {
    alert(`删除失败:${(err as Error).message}`)
  }
}

watch(
  () => props.open,
  async (val) => {
    if (val) {
      settings.value = loadSettings()
      await refresh()
    }
  },
)

onMounted(() => {
  void refresh()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h3>设置</h3>
          <button class="close-btn" @click="close">&times;</button>
        </div>

        <div class="modal-tabs">
          <button :class="{ active: activeTab === 'llm' }" @click="activeTab = 'llm'">LLM</button>
          <button :class="{ active: activeTab === 'mcp' }" @click="activeTab = 'mcp'">
            MCP Servers
            <span v-if="servers.filter((s) => s.enabled).length > 0" class="mcp-count">
              {{ servers.filter((s) => s.enabled).length }}
            </span>
          </button>
        </div>

        <div v-if="activeTab === 'llm'" class="modal-body">
          <div class="form-group">
            <label>API 提供商</label>
            <select v-model="settings.provider" @change="onProviderChange">
              <option v-for="p in PROVIDERS" :key="p.key" :value="p.key">{{ p.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>API Key</label>
            <input v-model="settings.apiKey" type="password" placeholder="输入你的 API Key" />
          </div>
          <div class="form-group">
            <label>模型</label>
            <input v-model="settings.model" type="text" placeholder="模型名称" />
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">取消</button>
            <button class="btn-primary" @click="saveLlm">保存</button>
          </div>
        </div>

        <div v-else class="modal-body">
          <MCPCatalogItem
            v-for="srv in presetServers"
            :key="srv.id"
            :server="srv"
            :llm="settings"
            @update="handleUpdate(srv.id, $event)"
          />
          <MCPCustomServer
            :custom-servers="customServers"
            @create="handleCreate"
            @remove="handleRemove"
          />
          <div class="modal-footer">
            <button class="btn-secondary" @click="close">关闭</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(70, 54, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  width: 560px;
  max-width: 92vw;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
  letter-spacing: 0.02em;
}

.close-btn {
  border: none;
  background: none;
  font-size: var(--fs-xl);
  cursor: pointer;
  color: var(--color-fg-muted);
  padding: 0 var(--space-1);
  line-height: var(--lh-tight);
  font-family: inherit;
  transition: color var(--dur-fast) var(--ease-out);
}

.close-btn:hover {
  color: var(--color-fg-primary);
}

.modal-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border-subtle);
}

.modal-tabs button {
  flex: 1;
  padding: var(--space-3);
  border: none;
  background: none;
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--color-fg-tertiary);
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border-bottom: 2px solid transparent;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-bottom-color var(--dur-fast) var(--ease-out);
}

.modal-tabs button:hover {
  color: var(--color-fg-secondary);
}

.modal-tabs button.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.mcp-count {
  font-size: var(--fs-xs);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
}

.modal-body {
  padding: var(--space-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  overflow-y: auto;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-group label {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--color-fg-secondary);
}

.form-group input,
.form-group select {
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

.form-group input:focus,
.form-group select:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border-subtle);
  margin-top: auto;
}

.btn-secondary {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-fg-secondary);
  cursor: pointer;
  font-size: var(--fs-md);
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.btn-secondary:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-primary {
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-accent-fg);
  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  font-family: inherit;
  transition: background var(--dur-fast) var(--ease-out);
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}
</style>
