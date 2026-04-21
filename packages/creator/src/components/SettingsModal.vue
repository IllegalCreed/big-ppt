<script setup lang="ts">
import { ref, watch } from 'vue'
import type { LLMSettings } from '../composables/useAIChat'

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

const settings = ref<LLMSettings>(loadSettings())

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
  if (p && p.defaultModel) {
    settings.value.model = p.defaultModel
  }
}

function save() {
  localStorage.setItem('llm-settings', JSON.stringify(settings.value))
  emit('update:open', false)
}

function close() {
  emit('update:open', false)
}

watch(
  () => props.open,
  (val) => {
    if (val) settings.value = loadSettings()
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h3>API 设置</h3>
          <button class="close-btn" @click="close">&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>API 提供商</label>
            <select v-model="settings.provider" @change="onProviderChange">
              <option v-for="p in PROVIDERS" :key="p.key" :value="p.key">
                {{ p.name }}
              </option>
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
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="close">取消</button>
          <button class="btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #fff;
  border-radius: 12px;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.close-btn {
  border: none;
  background: none;
  font-size: 20px;
  cursor: pointer;
  color: #999;
  padding: 0 4px;
}

.close-btn:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.form-group input,
.form-group select {
  padding: 8px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.form-group input:focus,
.form-group select:focus {
  border-color: #1677ff;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #f0f0f0;
}

.btn-secondary {
  padding: 6px 16px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary:hover {
  background: #4096ff;
}
</style>
