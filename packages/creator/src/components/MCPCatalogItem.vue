<!-- packages/creator/src/components/MCPCatalogItem.vue -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'
import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-vue-next'

const props = defineProps<{ server: McpServerWithStatus; llm: LLMSettings }>()
const emit = defineEmits<{ update: [patch: UpdateMcpServerRequest] }>()

const REDACTED_VALUE = '***'

/**
 * 后端 GET /mcp/servers 会把 headers 的 value 脱敏为 `***`（Authorization 值变
 * `Bearer ***`），避免明文暴露。前端语义：
 * - input 初始化为空串 + 占位符提示"已设置（留空保留原值）"
 * - hasExistingKey = 后端告知当前已有非空 key
 * - applyKey() 发送时：若用户没填且 hasExistingKey，就发 `Bearer ***` → 后端
 *   识别为"保留旧值"；否则发新值
 */
const authHeaderValue = computed(() => props.server.headers.Authorization ?? '')
const hasExistingKey = computed(() => authHeaderValue.value !== '')

const apiKey = ref('') // 用户当前在 input 里打的新值；空 = 不改
const reuseLlmKey = ref(false) // 脱敏后无法再自动判断是否等于 LLM key
const showKey = ref(false)
const copied = ref(false)
const expanded = ref(false)

watch(
  () => props.server.headers.Authorization,
  () => {
    // 后端刷新（例如保存后重新拉列表），清空本地输入让占位符重新显示
    apiKey.value = ''
  },
)

const canReuse = computed(
  () =>
    props.server.id.startsWith('zhipu-') && props.llm.provider === 'zhipu' && !!props.llm.apiKey,
)

/**
 * 返回要发给后端的 Authorization header 值：
 * - 勾了"复用 LLM Key" → 直接用 LLM 明文（`Bearer xxx`）
 * - 用户在 input 里填了新值 → 新值（`Bearer xxx`）
 * - input 空且后端已有 key → 返回 `***`（整个 value，和后端 GET 脱敏值一致）
 *   后端识别 value === '***' 且 key 在旧 headers 里 → 保留原值
 * - input 空且后端没 key → 空串（清空 header）
 */
function buildAuthValue(): string {
  if (reuseLlmKey.value && canReuse.value && props.llm.apiKey) {
    return `Bearer ${props.llm.apiKey}`
  }
  if (apiKey.value !== '') return `Bearer ${apiKey.value}`
  if (hasExistingKey.value) return REDACTED_VALUE
  return ''
}

/** 是否有可用的 key（真的或保留的）供启用按钮判断 */
const hasUsableKey = computed(() => {
  if (reuseLlmKey.value && canReuse.value) return !!props.llm.apiKey
  return apiKey.value !== '' || hasExistingKey.value
})

const avatarChar = computed(() => {
  const src = props.server.displayName || props.server.id
  // 中文字符直接取第一个；英文取首字母大写
  const c = src.charAt(0)
  return /[a-zA-Z]/.test(c) ? c.toUpperCase() : c
})

const statusDotColor = computed(() => {
  switch (props.server.status.state) {
    case 'ok':
      return 'var(--color-success)'
    case 'connecting':
      return 'var(--color-warning)'
    case 'error':
      return 'var(--color-danger)'
    default:
      return 'var(--color-fg-muted)'
  }
})

const statusText = computed(() => {
  switch (props.server.status.state) {
    case 'ok':
      return `已连接 · ${props.server.status.toolCount ?? 0} 个工具`
    case 'connecting':
      return '连接中…'
    case 'error':
      return `错误 · ${props.server.status.error ?? '未知'}`
    case 'disabled':
    default:
      return '未启用'
  }
})

function applyKey() {
  const auth = buildAuthValue()
  emit('update', {
    headers: auth ? { Authorization: auth } : {},
  })
}

function toggleEnabled(v: boolean) {
  if (v && !hasUsableKey.value) {
    expanded.value = true
    alert('请先填入 API Key 或勾选"复用 LLM Key"')
    return
  }
  const auth = buildAuthValue()
  emit('update', {
    enabled: v,
    headers: auth ? { Authorization: auth } : {},
  })
}

async function copyKey() {
  // 用户刚填的新值可复制；后端已存的脱敏值不能复制
  if (!apiKey.value) return
  try {
    await navigator.clipboard.writeText(apiKey.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // ignore
  }
}
</script>

<template>
  <div class="mcp-card" :class="[`mcp-card--${server.status.state}`, { expanded }]">
    <div class="mcp-card__head">
      <div class="mcp-card__avatar" aria-hidden="true">{{ avatarChar }}</div>
      <div class="mcp-card__headings">
        <div class="mcp-card__title-row">
          <span class="mcp-card__title">{{ server.displayName }}</span>
          <span v-if="server.badge" class="mcp-card__badge">{{ server.badge }}</span>
        </div>
        <p class="mcp-card__desc">{{ server.description }}</p>
      </div>
      <label class="mcp-toggle" :title="server.enabled ? '点击关闭' : '点击启用'">
        <input
          type="checkbox"
          :checked="server.enabled"
          @change="toggleEnabled(($event.target as HTMLInputElement).checked)"
        />
        <span class="mcp-toggle__track">
          <span class="mcp-toggle__thumb" />
        </span>
      </label>
    </div>

    <div class="mcp-card__meta">
      <span class="mcp-card__status">
        <span class="mcp-card__status-dot" :style="{ background: statusDotColor }" />
        {{ statusText }}
      </span>
      <button
        type="button"
        class="mcp-card__config"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        配置
        <ChevronDown
          :size="14"
          :stroke-width="1.8"
          class="mcp-card__config-chevron"
          :class="{ rotated: expanded }"
        />
      </button>
    </div>

    <div v-if="expanded" class="mcp-card__config-body">
      <label v-if="canReuse" class="mcp-card__reuse">
        <input v-model="reuseLlmKey" type="checkbox" @change="applyKey" />
        <span>复用 LLM API Key（智谱）</span>
      </label>

      <div v-if="!reuseLlmKey" class="mcp-card__key-group">
        <input
          v-model="apiKey"
          :type="showKey ? 'text' : 'password'"
          :placeholder="hasExistingKey ? '已设置 · 留空保留原值' : '粘贴此 MCP 的 API Key'"
          class="mcp-card__key-input"
          @blur="applyKey"
        />
        <button
          type="button"
          class="mcp-card__key-action"
          :title="showKey ? '隐藏' : '显示'"
          @click="showKey = !showKey"
        >
          <EyeOff v-if="showKey" :size="14" :stroke-width="1.8" />
          <Eye v-else :size="14" :stroke-width="1.8" />
        </button>
        <button
          type="button"
          class="mcp-card__key-action"
          :title="copied ? '已复制' : '复制'"
          :disabled="!apiKey"
          @click="copyKey"
        >
          <Check v-if="copied" :size="14" :stroke-width="2" />
          <Copy v-else :size="14" :stroke-width="1.8" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-card {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  transition:
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.mcp-card:hover {
  box-shadow: var(--shadow-xs);
}

.mcp-card.expanded {
  border-color: var(--color-border-strong);
}

/* ---- Head ---- */
.mcp-card__head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.mcp-card__avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-accent-soft);
  color: var(--color-accent-hover);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--fw-semibold);
  font-size: var(--fs-md);
  font-family: var(--font-serif);
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(193, 95, 60, 0.1);
}

.mcp-card__headings {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mcp-card__title-row {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.mcp-card__title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  line-height: var(--lh-tight);
}

.mcp-card__badge {
  font-size: var(--fs-xs);
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-accent-soft);
  color: var(--color-accent-hover);
  font-weight: var(--fw-medium);
  line-height: var(--lh-tight);
  letter-spacing: 0.02em;
}

.mcp-card__desc {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
  line-height: var(--lh-normal);
}

/* ---- iOS-style Toggle ---- */
.mcp-toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 2px;
}

.mcp-toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mcp-toggle__track {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: var(--radius-pill);
  background: var(--color-border-strong);
  transition: background var(--dur-base) var(--ease-out);
}

.mcp-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(70, 54, 30, 0.25);
  transition: transform var(--dur-base) var(--ease-out);
}

.mcp-toggle input:checked ~ .mcp-toggle__track {
  background: var(--color-accent);
}

.mcp-toggle input:checked ~ .mcp-toggle__track .mcp-toggle__thumb {
  transform: translateX(16px);
}

.mcp-toggle:hover .mcp-toggle__track {
  opacity: 0.92;
}

.mcp-toggle input:focus-visible ~ .mcp-toggle__track {
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

/* ---- Meta Row ---- */
.mcp-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--color-border-subtle);
}

.mcp-card__status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--color-fg-tertiary);
}

.mcp-card__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
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

.mcp-card__config {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--color-fg-tertiary);
  font-size: var(--fs-sm);
  font-family: inherit;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mcp-card__config:hover {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.mcp-card__config-chevron {
  transition: transform var(--dur-base) var(--ease-out);
}

.mcp-card__config-chevron.rotated {
  transform: rotate(180deg);
}

/* ---- Config Body ---- */
.mcp-card__config-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-2);
}

.mcp-card__reuse {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  cursor: pointer;
  user-select: none;
}

.mcp-card__reuse input[type='checkbox'] {
  accent-color: var(--color-accent);
}

.mcp-card__key-group {
  display: flex;
  align-items: stretch;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.mcp-card__key-group:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.mcp-card__key-input {
  flex: 1;
  padding: var(--space-2) var(--space-3);
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-fg-primary);
  font-size: var(--fs-sm);
  font-family: var(--font-mono);
  letter-spacing: 0.02em;
}

.mcp-card__key-action {
  width: 32px;
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

.mcp-card__key-action:hover:not(:disabled) {
  background: var(--color-bg-subtle);
  color: var(--color-accent);
}

.mcp-card__key-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---- Status indicator stripe (inset shadow) ---- */
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
</style>
