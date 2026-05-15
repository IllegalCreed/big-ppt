<!-- packages/creator/src/components/MCPCatalogItem.vue -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LLMSettings, McpServerWithStatus, UpdateMcpServerRequest } from '@big-ppt/shared'
import { Check, ChevronDown, Copy, Eye, EyeOff } from 'lucide-vue-next'

const props = defineProps<{
  server: McpServerWithStatus
  llm: LLMSettings
  /**
   * 后端 GET /api/auth/llm-settings 返回的 hasApiKey（用户已保存了 LLM apiKey）。
   * 因为出于安全，LLM apiKey 明文从不回传前端，要判断"能否复用"必须靠这个布尔位。
   */
  hasLlmKey: boolean
}>()
const emit = defineEmits<{ update: [patch: UpdateMcpServerRequest] }>()

const REDACTED_VALUE = '***'
/**
 * 复用 LLM Key sentinel：勾选"复用 LLM Key"时，前端在 Authorization 里发
 * `Bearer $LLM_KEY`，后端 mcp.ts 识别后从 users.llmSettings 解密取 apiKey 替换。
 * 必须和 packages/agent/src/routes/mcp.ts 的 LLM_KEY_SENTINEL 保持一致。
 */
const LLM_KEY_SENTINEL = '$LLM_KEY'

/**
 * 后端 GET /mcp/servers 会把 headers 的 value 脱敏为 `***`（Authorization 值变
 * `Bearer ***`），避免明文暴露。前端语义：
 * - input 初始化为空串 + 占位符提示"已设置（留空保留原值）"
 * - hasExistingKey = 后端告知当前已有非空 key 且**不是 sentinel**(sentinel 不算真 key)
 * - applyKey() 发送时：若用户没填且 hasExistingKey，就发 `Bearer ***` → 后端
 *   识别为"保留旧值"；否则发新值
 */
const authHeaderValue = computed(() => props.server.headers.Authorization ?? '')
// reuseLlmKey 模式下,headers 里是 sentinel(GET 也被脱敏成 ***),不算用户填的真 key
const hasExistingKey = computed(() => authHeaderValue.value !== '' && !props.server.reuseLlmKey)

const apiKey = ref('') // 用户当前在 input 里打的新值；空 = 不改
const reuseLlmKey = ref(props.server.reuseLlmKey)
const showKey = ref(false)
const copied = ref(false)
const expanded = ref(false)

// 后端 reuseLlmKey 状态变化（refresh 后）→ 同步本地 ref，让复选框反映持久化语义
watch(
  () => props.server.reuseLlmKey,
  (v) => {
    reuseLlmKey.value = v
  },
)

watch(
  () => props.server.headers.Authorization,
  () => {
    // 后端刷新（例如保存后重新拉列表），清空本地输入让占位符重新显示
    apiKey.value = ''
  },
)

/**
 * 仅 zhipu-* 预置 + LLM provider=zhipu + 用户已保存 LLM apiKey 时显示复用复选框。
 * 用 hasLlmKey（后端的 hasApiKey 布尔位）判断，因 LLM apiKey 明文从不回传 →
 * props.llm.apiKey 永远是空串，不能拿来判断。
 */
const canReuse = computed(
  () =>
    props.server.id.startsWith('zhipu-') &&
    props.llm.provider === 'zhipu' &&
    props.hasLlmKey,
)

/**
 * 返回要发给后端的 Authorization header 值：
 * - 勾了"复用 LLM Key" → 发 sentinel `Bearer $LLM_KEY`，后端解密 LLM key 注入
 * - 用户在 input 里填了新值 → 新值（`Bearer xxx`）
 * - input 空且后端已有 key → 返回 `***`（整个 value，和后端 GET 脱敏值一致）
 *   后端识别 value === '***' 且 key 在旧 headers 里 → 保留原值
 * - input 空且后端没 key → 空串（清空 header）
 */
function buildAuthValue(): string {
  if (reuseLlmKey.value && canReuse.value) {
    return `Bearer ${LLM_KEY_SENTINEL}`
  }
  if (apiKey.value !== '') return `Bearer ${apiKey.value}`
  if (hasExistingKey.value) return REDACTED_VALUE
  return ''
}

/** 是否有可用的 key（真的或保留的）供启用按钮判断 */
const hasUsableKey = computed(() => {
  if (reuseLlmKey.value && canReuse.value) return true
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
      // 错误详情走专门的 error-pane(友好 message + 折叠 raw),状态行只标 "连接失败"
      return '连接失败'
    case 'disabled':
    default:
      return '未启用'
  }
})

/**
 * activate 失败时后端把 raw error message 写到 server.status.error。
 * 这里识别 4 类常见错并显示友好 message,raw 收进折叠区。
 * 触发场景:
 * - 智谱 API auth 错(code 1001 / "Header中未收到Authorization" / unrecognized_keys 含 success):
 *   智谱端点要 Authorization: Bearer <key>,preset headers 缺 sentinel 或用户没把智谱设活跃且没填 key
 * - MCP JSON-RPC zod 校验错(path:["jsonrpc"] / Invalid input: expected "2.0"):
 *   端点返非 JSON-RPC 响应(常见是 auth fail 后返业务 JSON 而非 JSON-RPC envelope)
 * - 网络错(fetch failed / ECONNREFUSED / timeout):URL 错或网络不通
 * - 其他:截断 raw 前 200 字符 + 折叠完整
 */
const rawError = computed(() => props.server.status.error ?? '')
const friendlyErrorMessage = computed(() => {
  const raw = rawError.value
  if (!raw) return ''
  // 智谱 API auth 错(优先匹配,因 zod 错里也可能嵌套这串)
  if (
    raw.includes('"code":1001') ||
    raw.includes('Header中未收到Authorization') ||
    (raw.includes('unrecognized_keys') && raw.includes('"success"'))
  ) {
    return '智谱 MCP 需要 Authorization。请先在 LLM 标签页配置智谱 API Key 并设为活跃 provider,或在本卡片"配置"里手动填入 Authorization header。'
  }
  // MCP JSON-RPC 协议错
  if (
    raw.includes('"path":["jsonrpc"]') ||
    raw.includes('"path": ["jsonrpc"]') ||
    raw.includes('expected "2.0"') ||
    raw.includes("expected '2.0'")
  ) {
    return 'MCP 服务器返回的不是合法 JSON-RPC 响应(常见原因:鉴权失败、URL 错误、或端点不是 MCP 协议)。'
  }
  // 网络错
  if (
    /fetch failed/i.test(raw) ||
    /ECONNREFUSED/.test(raw) ||
    /ENOTFOUND/.test(raw) ||
    /timeout/i.test(raw) ||
    /Network request failed/i.test(raw)
  ) {
    return '无法连接 MCP 服务器,请检查网络或 URL 配置。'
  }
  // 其他:截前 200 字符
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
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
          @click.prevent="toggleEnabled(!server.enabled)"
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

    <div v-if="server.status.state === 'error' && rawError" class="mcp-card__error-pane">
      <div class="mcp-card__error-summary">⚠️ {{ friendlyErrorMessage }}</div>
      <details class="mcp-card__error-details">
        <summary>查看技术细节</summary>
        <pre class="mcp-card__error-raw">{{ rawError }}</pre>
      </details>
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

/* ---- Error pane (friendly + collapsible raw) ---- */
.mcp-card__error-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-danger) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent);
}

.mcp-card__error-summary {
  font-size: var(--fs-sm);
  color: var(--color-fg-primary);
  line-height: var(--lh-normal);
}

.mcp-card__error-details {
  font-size: var(--fs-xs);
  color: var(--color-fg-tertiary);
}

.mcp-card__error-details summary {
  cursor: pointer;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 0;
  color: var(--color-fg-tertiary);
  transition: color var(--dur-fast) var(--ease-out);
}

.mcp-card__error-details summary:hover {
  color: var(--color-fg-secondary);
}

.mcp-card__error-raw {
  margin: var(--space-2) 0 0;
  padding: var(--space-2);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  color: var(--color-fg-secondary);
  line-height: var(--lh-tight);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
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
