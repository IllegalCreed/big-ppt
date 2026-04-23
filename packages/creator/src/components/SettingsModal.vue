<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'
import { Check, Copy, Eye, EyeOff, X } from 'lucide-vue-next'
import { useMCP } from '../composables/useMCP'
import { useAuth } from '../composables/useAuth'
import { invalidateLlmSettingsCache } from '../composables/useAIChat'
import { api, ApiError } from '../api/client'
import MCPCatalogItem from './MCPCatalogItem.vue'
import MCPCustomServer from './MCPCustomServer.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

interface ProviderMeta {
  key: LLMSettings['provider']
  name: string
  avatar: string
  defaultModel: string
}

const PROVIDERS: ProviderMeta[] = [
  { key: 'zhipu', name: '智谱 GLM', avatar: '智', defaultModel: 'GLM-5.1' },
  { key: 'deepseek', name: 'DeepSeek', avatar: 'D', defaultModel: 'deepseek-chat' },
  { key: 'openai', name: 'OpenAI', avatar: 'O', defaultModel: 'gpt-4o' },
  { key: 'moonshot', name: 'Kimi', avatar: 'K', defaultModel: 'moonshot-v1-8k' },
  { key: 'qwen', name: '千问 Qwen', avatar: '千', defaultModel: 'qwen-plus' },
  { key: 'custom', name: '自定义', avatar: '+', defaultModel: '' },
]

const DEFAULT_SETTINGS: LLMSettings = { provider: 'zhipu', apiKey: '', model: 'GLM-5.1' }

const activeTab = ref<'llm' | 'mcp'>('llm')
const settings = ref<LLMSettings>({ ...DEFAULT_SETTINGS })
const hasStoredApiKey = ref(false)
const showApiKey = ref(false)
const copiedKey = ref(false)
const saving = ref(false)
const saveError = ref('')
const { servers, refresh, create, update, remove } = useMCP()
const { saveLlmSettings } = useAuth()

const presetServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => s.preset))
const customServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => !s.preset))
const enabledMcpCount = computed(() => servers.value.filter((s) => s.enabled).length)
const currentProviderHint = computed(() => {
  const p = PROVIDERS.find((x) => x.key === settings.value.provider)
  return p?.defaultModel ? `默认：${p.defaultModel}` : ''
})

async function loadSettings() {
  try {
    const data = await api.get<{
      provider: string | null
      model: string | null
      baseUrl: string | null
      hasApiKey: boolean
    }>('/api/auth/llm-settings')
    settings.value = {
      provider: (data.provider as LLMSettings['provider']) ?? DEFAULT_SETTINGS.provider,
      apiKey: '', // 从不回传，留空让用户选择是否覆盖
      model: data.model ?? DEFAULT_SETTINGS.model,
    }
    hasStoredApiKey.value = !!data.hasApiKey
  } catch (err) {
    // 未登录或网络错误：用默认值，不弹错
    if (!(err instanceof ApiError && err.status === 401)) {
      saveError.value = `加载设置失败：${(err as Error).message}`
    }
    settings.value = { ...DEFAULT_SETTINGS }
    hasStoredApiKey.value = false
  }
}

function selectProvider(p: ProviderMeta) {
  settings.value.provider = p.key
  if (p.defaultModel) settings.value.model = p.defaultModel
}

async function saveLlm() {
  if (saving.value) return
  saveError.value = ''
  if (!settings.value.apiKey && !hasStoredApiKey.value) {
    saveError.value = '请填写 API Key'
    return
  }
  saving.value = true
  try {
    await saveLlmSettings({
      provider: settings.value.provider,
      apiKey: settings.value.apiKey, // 空串 → 后端保留原 key
      model: settings.value.model,
    })
    invalidateLlmSettingsCache()
    hasStoredApiKey.value = true
    settings.value.apiKey = ''
    emit('update:open', false)
  } catch (err) {
    saveError.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    saving.value = false
  }
}

async function copyKey() {
  if (!settings.value.apiKey) return
  try {
    await navigator.clipboard.writeText(settings.value.apiKey)
    copiedKey.value = true
    setTimeout(() => {
      copiedKey.value = false
    }, 1500)
  } catch {
    // ignore
  }
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
      await loadSettings()
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
          <button type="button" class="close-btn" aria-label="关闭" @click="close">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-tabs-wrap">
          <div class="seg-tabs" role="tablist">
            <div class="seg-indicator" :class="{ 'seg-indicator--right': activeTab === 'mcp' }" />
            <button
              type="button"
              class="seg-tab"
              :class="{ active: activeTab === 'llm' }"
              role="tab"
              :aria-selected="activeTab === 'llm'"
              @click="activeTab = 'llm'"
            >
              LLM
            </button>
            <button
              type="button"
              class="seg-tab"
              :class="{ active: activeTab === 'mcp' }"
              role="tab"
              :aria-selected="activeTab === 'mcp'"
              @click="activeTab = 'mcp'"
            >
              MCP Servers
              <span v-if="enabledMcpCount > 0" class="seg-count">{{ enabledMcpCount }}</span>
            </button>
          </div>
        </div>

        <div v-if="activeTab === 'llm'" class="modal-body">
          <section class="form-section">
            <header class="section-header">
              <span class="section-title">API 提供商</span>
              <span class="section-hint">选择内置供应商或自定义接入</span>
            </header>
            <div class="provider-grid">
              <button
                v-for="p in PROVIDERS"
                :key="p.key"
                type="button"
                class="provider-card"
                :class="{ active: settings.provider === p.key }"
                @click="selectProvider(p)"
              >
                <span class="provider-avatar">{{ p.avatar }}</span>
                <span class="provider-name">{{ p.name }}</span>
                <span v-if="settings.provider === p.key" class="provider-check">
                  <Check :size="14" :stroke-width="2.4" />
                </span>
              </button>
            </div>
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">API Key</span>
              <span class="section-hint">
                {{ hasStoredApiKey ? '已保存（服务端加密）。如需更换请重新输入' : '服务端 AES-256-GCM 加密存储，不回传' }}
              </span>
            </header>
            <div class="input-group">
              <input
                v-model="settings.apiKey"
                :type="showApiKey ? 'text' : 'password'"
                :placeholder="hasStoredApiKey ? '留空表示不修改' : 'sk-...'"
                autocomplete="off"
                class="input-group__input"
              />
              <button
                type="button"
                class="input-group__action"
                :title="showApiKey ? '隐藏' : '显示'"
                :aria-label="showApiKey ? '隐藏' : '显示'"
                @click="showApiKey = !showApiKey"
              >
                <EyeOff v-if="showApiKey" :size="16" :stroke-width="1.8" />
                <Eye v-else :size="16" :stroke-width="1.8" />
              </button>
              <button
                type="button"
                class="input-group__action"
                :title="copiedKey ? '已复制' : '复制'"
                :aria-label="copiedKey ? '已复制' : '复制'"
                :disabled="!settings.apiKey"
                @click="copyKey"
              >
                <Check v-if="copiedKey" :size="16" :stroke-width="2" />
                <Copy v-else :size="16" :stroke-width="1.8" />
              </button>
            </div>
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">模型名称</span>
              <span v-if="currentProviderHint" class="section-hint">{{ currentProviderHint }}</span>
            </header>
            <input v-model="settings.model" type="text" placeholder="模型名称" class="input-bare" />
          </section>

          <p v-if="saveError" class="form-error">{{ saveError }}</p>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" :disabled="saving" @click="close">取消</button>
            <button type="button" class="btn-primary" :disabled="saving" @click="saveLlm">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>

        <div v-else class="modal-body">
          <section class="form-section">
            <header class="section-header">
              <span class="section-title">预置服务</span>
              <span class="section-hint">开关启用，勾选复用 LLM Key</span>
            </header>
            <div class="mcp-list">
              <MCPCatalogItem
                v-for="srv in presetServers"
                :key="srv.id"
                :server="srv"
                :llm="settings"
                @update="handleUpdate(srv.id, $event)"
              />
            </div>
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">自定义 MCP</span>
              <span class="section-hint">进阶：手动接入 StreamableHTTP MCP Server</span>
            </header>
            <MCPCustomServer
              :custom-servers="customServers"
              @create="handleCreate"
              @remove="handleRemove"
            />
          </section>

          <div class="modal-footer">
            <button type="button" class="btn-secondary" @click="close">关闭</button>
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
  padding: var(--space-6);
}

.modal-content {
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  width: 600px;
  max-width: 100%;
  max-height: 92vh;
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
  padding: var(--space-5) var(--space-6);
}

.modal-header h3 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
  letter-spacing: 0.01em;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.close-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-fg-primary);
}

/* ---- Segmented Pill Tabs ---- */
.modal-tabs-wrap {
  display: flex;
  justify-content: center;
  padding: 0 var(--space-6) var(--space-4);
}

.seg-tabs {
  position: relative;
  display: inline-flex;
  padding: 4px;
  background: var(--color-bg-subtle);
  border-radius: var(--radius-pill);
}

.seg-indicator {
  position: absolute;
  top: 4px;
  left: 4px;
  width: calc(50% - 4px);
  height: calc(100% - 8px);
  background: var(--color-bg-elevated);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-xs);
  transition: transform 260ms var(--ease-out);
}

.seg-indicator--right {
  transform: translateX(100%);
}

.seg-tab {
  position: relative;
  z-index: 1;
  min-width: 128px;
  padding: 8px var(--space-4);
  border: none;
  background: transparent;
  color: var(--color-fg-tertiary);
  font-size: var(--fs-md);
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  transition: color var(--dur-fast) var(--ease-out);
}

.seg-tab.active {
  color: var(--color-fg-primary);
  font-weight: var(--fw-medium);
}

.seg-count {
  font-size: 11px;
  font-weight: var(--fw-medium);
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: var(--color-accent-fg);
}

/* ---- Body & Sections ---- */
.modal-body {
  padding: 0 var(--space-6) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  overflow-y: auto;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.form-error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: rgba(180, 71, 44, 0.08);
  border: 1px solid rgba(180, 71, 44, 0.25);
  border-radius: var(--radius-md);
  color: #B4472C;
  font-size: var(--fs-sm);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
}

.section-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}

.section-hint {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
}

/* ---- Provider Grid ---- */
.provider-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}

.provider-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.provider-card:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-subtle);
}

.provider-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.08);
}

.provider-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent-hover);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-sm);
  flex-shrink: 0;
}

.provider-card.active .provider-avatar {
  background: var(--color-accent);
  color: var(--color-accent-fg);
}

.provider-name {
  flex: 1;
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  color: var(--color-fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-check {
  color: var(--color-accent);
  display: inline-flex;
  flex-shrink: 0;
}

/* ---- Input Group (API Key) ---- */
.input-group {
  display: flex;
  align-items: stretch;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.input-group:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.input-group__input {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-fg-primary);
  font-size: var(--fs-md);
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}

.input-group__action {
  width: 34px;
  border: none;
  background: transparent;
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--color-border-subtle);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.input-group__action:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.input-group__action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---- Bare Input ---- */
.input-bare {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-fg-primary);
  font-size: var(--fs-md);
  font-family: inherit;
  outline: none;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.input-bare:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

/* ---- MCP List ---- */
.mcp-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* ---- Footer Buttons ---- */
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
  margin-top: var(--space-2);
}

.btn-secondary {
  padding: var(--space-2) var(--space-5);
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
  padding: var(--space-2) var(--space-5);
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
