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
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal-content { background: #fff; border-radius: 12px; width: 520px; max-width: 92vw; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 6px 24px rgba(0,0,0,0.15); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid #f0f0f0; }
.modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
.close-btn { border: none; background: none; font-size: 20px; cursor: pointer; color: #999; }
.close-btn:hover { color: #333; }
.modal-tabs { display: flex; border-bottom: 1px solid #f0f0f0; }
.modal-tabs button { flex: 1; padding: 10px; border: none; background: none; cursor: pointer; font-size: 13px; color: #666; display: flex; align-items: center; justify-content: center; gap: 6px; }
.modal-tabs button.active { color: #1677ff; border-bottom: 2px solid #1677ff; }
.mcp-count { font-size: 11px; background: #1677ff; color: #fff; padding: 1px 6px; border-radius: 8px; }
.modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { font-size: 13px; font-weight: 500; color: #333; }
.form-group input, .form-group select { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 14px; outline: none; }
.form-group input:focus, .form-group select:focus { border-color: #1677ff; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding-top: 10px; border-top: 1px solid #f0f0f0; margin-top: auto; }
.btn-secondary { padding: 6px 16px; border: 1px solid #d9d9d9; border-radius: 6px; background: #fff; cursor: pointer; font-size: 14px; }
.btn-primary { padding: 6px 16px; border: none; border-radius: 6px; background: #1677ff; color: #fff; cursor: pointer; font-size: 14px; }
.btn-primary:hover { background: #4096ff; }
</style>
