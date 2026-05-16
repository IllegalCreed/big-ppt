<script setup lang="ts">
/**
 * Phase 12 Task J:Settings UI 多 provider 重构。
 *
 * 此前 UI 是「单 active provider 平铺表单」(provider 下拉 + apiKey + model + baseUrl)。
 * Phase 12 起 backend `users.llm_settings` 改成新 shape(activeProvider + providers map +
 * advanced),前端 UI 同步:
 *
 * - **顶部 active provider 下拉**:7 选 1,只能选已配 apiKey 的 provider。
 * - **7 个 provider 卡片**:每张卡渲染一个 provider(无论是否配置),含 family 徽章 +
 *   apiKey(password)+ model + baseUrl(openai-compatible 默认必填,anthropic/gemini 可选)。
 *   未配 apiKey 的卡片显示"未配置"灰色徽章;active 卡高亮(border + bg)。
 * - **Advanced 折叠区**:default 折叠,展开后:
 *   - common 子区:temperature slider / maxTokens input / topP slider
 *   - common 子区:含「Thinking 级别(全局默认)」(6 档下拉,active 不论谁都生效)
 *   - 当 active 是 anthropic:promptCaching toggle / Thinking 级别(anthropic 专有,6 档) / thinkingBudgetTokens
 *   - 当 active 是 gemini:jsonMode toggle / longContextStrategy(truncate / segment) / Thinking 级别(gemini 专有,6 档)
 *
 * Phase 12.7 Task E:thinkingEnabled(boolean)替换成 thinkingLevel(6 档 enum:
 * off / minimal / low / medium / high / xhigh)对齐 pi-agent-core 的 thinkingLevel 概念;
 * spec §6 要求 anthropic / gemini / common 三域 UI 都可调,各域独立 v-model 字段。
 *
 * 协议:GET / PUT 都用新 shape(backend Task J 同步改);apiKey 空串=保留旧值。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type {
  ImageLlmSettings,
  LLMSettings,
  McpServerWithStatus,
  UpdateMcpServerRequest,
  ProviderId,
} from '@big-ppt/shared'
import { PROVIDER_CATALOG, getProviderEntry } from '@big-ppt/shared'
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, X } from 'lucide-vue-next'
import { useMCP } from '../composables/useMCP'
import { useAuth } from '../composables/useAuth'
import { api, ApiError } from '../api/client'
import { fetchModels, type ModelInfo } from '../api/llm-models'
import MCPCatalogItem from './MCPCatalogItem.vue'
import MCPCustomServer from './MCPCustomServer.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

// === 表单状态 ===

/**
 * 每个 provider 一份本地配置 ref。`apiKey` 始终初始化为空串(意味着"保留旧值");
 * `hasApiKey` 反映 backend GET 返的 hasApiKey 标志(用户已配过 key)。
 */
interface ProviderFormEntry {
  apiKey: string
  model: string
  baseUrl: string
  hasApiKey: boolean
  showApiKey: boolean
}

function emptyEntry(): ProviderFormEntry {
  return { apiKey: '', model: '', baseUrl: '', hasApiKey: false, showApiKey: false }
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Phase 12.7 Task E (review fix):thinkingLevel 三域独立(anthropic/gemini/common),
 * spec §6 要求三域 UI 都可调。schema + migration 早已三域;UI 之前只落 anthropic,
 * 此处补 gemini + common。`thinkingLevelCommon` 是「全局默认」语义,active provider
 * 没单独配 thinkingLevel 时由 createAgent 回落到 common(已在 Task C resolveThinkingLevel
 * 实现:advanced.<provider>.thinkingLevel → advanced.common.thinkingLevel → 'off')。
 */
interface AdvancedForm {
  temperature: number | null
  maxTokens: number | null
  topP: number | null
  promptCaching: boolean
  thinkingLevelAnthropic: ThinkingLevel
  thinkingLevelGemini: ThinkingLevel
  thinkingLevelCommon: ThinkingLevel
  thinkingBudgetTokens: number | null
  jsonMode: boolean
  longContextStrategy: 'truncate' | 'segment'
}

function emptyAdvanced(): AdvancedForm {
  return {
    temperature: null,
    maxTokens: null,
    topP: null,
    promptCaching: false,
    thinkingLevelAnthropic: 'off',
    thinkingLevelGemini: 'off',
    thinkingLevelCommon: 'off',
    thinkingBudgetTokens: 5000,
    jsonMode: false,
    longContextStrategy: 'truncate',
  }
}

const activeTab = ref<'llm' | 'mcp' | 'image'>('llm')
const activeProvider = ref<ProviderId>('zhipu')
const providerForms = ref<Record<ProviderId, ProviderFormEntry>>({
  openai: emptyEntry(),
  anthropic: emptyEntry(),
  gemini: emptyEntry(),
  zhipu: emptyEntry(),
  deepseek: emptyEntry(),
  moonshot: emptyEntry(),
  qwen: emptyEntry(),
  // Phase 12.5 新增 5 个 provider
  mistral: emptyEntry(),
  groq: emptyEntry(),
  xai: emptyEntry(),
  openrouter: emptyEntry(),
  cerebras: emptyEntry(),
})
const advanced = ref<AdvancedForm>(emptyAdvanced())
const advancedExpanded = ref(false)
const saving = ref(false)
const saveError = ref('')

/**
 * Phase 12.5 Task D：每个 provider 的 model dropdown 数据源（懒加载，focus 时拉一次）。
 *
 * 用 `<datalist>` + `<input list="...">` 实现 combobox 行为：
 * - 下拉显示候选 model id（来自 pi-ai getModels 接口）
 * - 同时允许用户自由输入 dropdown 外的 model id（中转 / 自部署 baseUrl 常见场景）
 *
 * 走原生 HTML datalist 而非 antdv-next a-auto-complete：保持跟 SettingsModal 其他
 * 字段（plain `<input>` / `<select>`）样式一致，零额外依赖；测试也只需 query input
 * 元素就够，不用处理 Teleport 弹层。
 */
const modelOptions = reactive<Record<string, ModelInfo[]>>({})
const modelOptionsLoading = reactive<Record<string, boolean>>({})

async function loadModelsIfNeeded(providerId: string): Promise<void> {
  if (modelOptions[providerId] || modelOptionsLoading[providerId]) return
  modelOptionsLoading[providerId] = true
  try {
    modelOptions[providerId] = await fetchModels(providerId)
  } finally {
    modelOptionsLoading[providerId] = false
  }
}

// === image LLM (独立于主 LLM,Phase 11.5 保留不动)===
const DEFAULT_IMAGE_SETTINGS: ImageLlmSettings = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
}
const imageSettings = ref<ImageLlmSettings>({ ...DEFAULT_IMAGE_SETTINGS })
const hasStoredImageApiKey = ref(false)
const showImageApiKey = ref(false)
const savingImage = ref(false)
const imageSaveError = ref('')

const IMAGE_MODEL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: '', label: '默认（gpt-5.5 主 + gpt-image-2 兜底）', hint: 'Responses API 带 reasoning 自动改写 prompt' },
  { value: 'gpt-5.5', label: 'gpt-5.5（路 A）', hint: 'Responses API + image_generation tool' },
  { value: 'gpt-image-2', label: 'gpt-image-2（路 B）', hint: '直接 /v1/images/generations,无 reasoning' },
  { value: 'gpt-image-1.5', label: 'gpt-image-1.5（路 B 旧）', hint: '兜底降级用,仅在 image-2 不可用时考虑' },
]

const { servers, refresh, create, update, remove } = useMCP()
const { saveImageLlmSettings } = useAuth()

const presetServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => s.preset))
const customServers = computed<McpServerWithStatus[]>(() => servers.value.filter((s) => !s.preset))
const enabledMcpCount = computed(() => servers.value.filter((s) => s.enabled).length)

/** 已配 apiKey 的 provider id 列表(active 下拉允许的选项)。 */
const configuredProviderIds = computed<ProviderId[]>(() => {
  const ids: ProviderId[] = []
  for (const meta of PROVIDER_CATALOG) {
    const entry = providerForms.value[meta.id]
    if (entry.hasApiKey || entry.apiKey.trim()) ids.push(meta.id)
  }
  return ids
})

/** 当前 active provider 的元信息(从 catalog 查)。 */
const activeMeta = computed(() => getProviderEntry(activeProvider.value))

/**
 * 渐进披露三层分组：active / 其他已配置 / 未配置。
 *
 * 此前 UI 平铺 12 张完整卡片(每张 API Key+Model+Base URL+advanced),用户反馈
 * "enterprise admin panel" 感太重——实际只用 1-2 个 provider。改成:
 *
 * 1. **活跃 provider 完整卡片**(顶部置顶,永展开,含 advanced 子区)
 * 2. **其他已配置**(默认展开 details,紧凑卡片去掉 advanced,「设为活跃」按钮在右下)
 * 3. **未配置**(默认折叠 details,列表行 + 「配置」按钮,点击展开紧凑 form)
 *
 * 已配置 = `hasApiKey`(后端存了)或 `apiKey.trim()`(用户刚填还没保存)。
 */
const otherConfiguredProviders = computed(() =>
  PROVIDER_CATALOG.filter(
    (m) => m.id !== activeProvider.value && configuredProviderIds.value.includes(m.id),
  ),
)

const unconfiguredProviders = computed(() =>
  PROVIDER_CATALOG.filter(
    (m) => m.id !== activeProvider.value && !configuredProviderIds.value.includes(m.id),
  ),
)

/** 未配置区:点击「配置」按钮内嵌展开紧凑 form 的 provider id。 */
const expandedUnconfigured = ref<ProviderId | null>(null)

function toggleUnconfigured(id: ProviderId): void {
  expandedUnconfigured.value = expandedUnconfigured.value === id ? null : id
}

/** 给 MCPCatalogItem 用的兼容 LLMSettings shape:active provider 的配置摊平。 */
const activeProviderLegacyShape = computed<LLMSettings>(() => {
  const entry = providerForms.value[activeProvider.value]
  return {
    provider: activeProvider.value,
    apiKey: '', // MCPCatalogItem 只关心 hasLlmKey 布尔,不用真 apiKey
    model: entry.model || activeMeta.value?.defaultModel || '',
    baseUrl: entry.baseUrl || undefined,
  }
})

const activeProviderHasLlmKey = computed(() => {
  const entry = providerForms.value[activeProvider.value]
  return entry.hasApiKey || !!entry.apiKey.trim()
})

// === backend 协议层 ===

interface GetLlmSettingsResponse {
  activeProvider: ProviderId | null
  providers: Record<string, { hasApiKey: boolean; model?: string; baseUrl?: string }>
  advanced?: {
    common?: {
      temperature?: number
      maxTokens?: number
      topP?: number
      stopSequences?: string[]
      thinkingLevel?: ThinkingLevel
      // Phase 12.7 Task E 兼容期:GET 仍可能回老 boolean 字段(后端 migration 跑前)
      thinkingEnabled?: boolean
    }
    anthropic?: {
      promptCaching?: boolean
      thinkingLevel?: ThinkingLevel
      thinkingEnabled?: boolean
      thinkingBudgetTokens?: number
    }
    gemini?: {
      jsonMode?: boolean
      longContextStrategy?: 'truncate' | 'segment'
      thinkingLevel?: ThinkingLevel
      thinkingEnabled?: boolean
    }
  }
}

/**
 * Phase 12.7 Task E 兼容:把 GET response 里残留的老 `thinkingEnabled` boolean
 * 转回新 `thinkingLevel` 枚举。三域(anthropic/gemini/common)共用同套规则:
 * - `thinkingEnabled === true` → `'medium'`
 * - `thinkingEnabled === false` → `'off'`
 * - 已是 `thinkingLevel` enum → 优先用
 * - 都没 → `'off'` 默认
 */
function resolveLegacyThinkingLevel(
  sub: { thinkingLevel?: ThinkingLevel; thinkingEnabled?: boolean } | undefined,
): ThinkingLevel {
  if (!sub) return 'off'
  if (sub.thinkingLevel) return sub.thinkingLevel
  if (sub.thinkingEnabled === true) return 'medium'
  return 'off'
}

async function loadSettings() {
  try {
    const data = await api.get<GetLlmSettingsResponse>('/api/auth/llm-settings')
    // 修 race(2026-05-16 dogfood):用户在 modal 打开但 GET 未返时已经开始打字,
    // 下面的 reset 会把这些输入擦掉。snapshot 已敲的明文 apiKey,inject 之后
    // restore 覆盖 server 永远返"" 的占位(server 不回明文)。
    const pendingApiKeys: Partial<Record<ProviderId, string>> = {}
    for (const meta of PROVIDER_CATALOG) {
      const cur = providerForms.value[meta.id]
      if (cur?.apiKey && cur.apiKey.trim()) pendingApiKeys[meta.id] = cur.apiKey
    }
    // 重置表单
    for (const meta of PROVIDER_CATALOG) {
      providerForms.value[meta.id] = emptyEntry()
    }
    advanced.value = emptyAdvanced()
    // 注入 provider entries
    for (const [pid, view] of Object.entries(data.providers ?? {})) {
      const id = pid as ProviderId
      if (!providerForms.value[id]) continue
      providerForms.value[id] = {
        apiKey: pendingApiKeys[id] ?? '',
        model: view.model ?? '',
        baseUrl: view.baseUrl ?? '',
        hasApiKey: !!view.hasApiKey,
        showApiKey: false,
      }
    }
    // 恢复未在 server 数据里的 provider(老用户首次激活某 provider 还没保存 → server
    // 不返该 provider 但用户已经在前端 form 里填了 apiKey)
    for (const [id, key] of Object.entries(pendingApiKeys)) {
      const entry = providerForms.value[id as ProviderId]
      if (entry && !entry.apiKey) entry.apiKey = key
    }
    // 注入 advanced
    if (data.advanced) {
      const cmn = data.advanced.common ?? {}
      const ant = data.advanced.anthropic ?? {}
      const gem = data.advanced.gemini ?? {}
      advanced.value = {
        temperature: cmn.temperature ?? null,
        maxTokens: cmn.maxTokens ?? null,
        topP: cmn.topP ?? null,
        promptCaching: !!ant.promptCaching,
        // Phase 12.7 Task E 三域 thinkingLevel,各域走同套 legacy 兼容
        thinkingLevelAnthropic: resolveLegacyThinkingLevel(ant),
        thinkingLevelGemini: resolveLegacyThinkingLevel(gem),
        thinkingLevelCommon: resolveLegacyThinkingLevel(cmn),
        thinkingBudgetTokens: ant.thinkingBudgetTokens ?? 5000,
        jsonMode: !!gem.jsonMode,
        longContextStrategy: gem.longContextStrategy ?? 'truncate',
      }
    }
    // 设置 active provider:用 backend 给的,否则保留默认 zhipu
    if (data.activeProvider && providerForms.value[data.activeProvider]) {
      activeProvider.value = data.activeProvider
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      saveError.value = `加载设置失败:${(err as Error).message}`
    }
  }
}

async function loadImageSettings() {
  try {
    const data = await api.get<{
      provider: 'openai' | null
      baseUrl: string | null
      model: string | null
      hasApiKey: boolean
    }>('/api/image-llm-settings')
    imageSettings.value = {
      provider: data.provider ?? 'openai',
      apiKey: '',
      baseUrl: data.baseUrl ?? '',
      model: data.model ?? '',
    }
    hasStoredImageApiKey.value = !!data.hasApiKey
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) {
      imageSaveError.value = `加载生图模型设置失败:${(err as Error).message}`
    }
    imageSettings.value = { ...DEFAULT_IMAGE_SETTINGS }
    hasStoredImageApiKey.value = false
  }
}

function selectActiveProvider(pid: ProviderId) {
  activeProvider.value = pid
  // 切到的 provider 可能此前被展开在"未配置"区(刚 inline 填完 key);切完自动收起,
  // 避免下一次打开未配置 details 时残留旧 expanded 状态。
  if (expandedUnconfigured.value === pid) {
    expandedUnconfigured.value = null
  }
}

function toggleAdvanced() {
  advancedExpanded.value = !advancedExpanded.value
}

function buildPayload() {
  // 构造新 shape body 发 PUT
  const providers: Record<string, { apiKey: string; model?: string; baseUrl?: string }> = {}
  for (const meta of PROVIDER_CATALOG) {
    const entry = providerForms.value[meta.id]
    const hasNewKey = !!entry.apiKey.trim()
    const hasOldKey = entry.hasApiKey
    // 没填新 key 也没旧 key → 跳过(未配置 provider 不入 payload)
    if (!hasNewKey && !hasOldKey) continue
    const item: { apiKey: string; model?: string; baseUrl?: string } = {
      // 空串表示"保留旧 apiKey"(backend Task J 处理逻辑)
      apiKey: entry.apiKey.trim(),
    }
    const trimmedModel = entry.model.trim()
    if (trimmedModel) item.model = trimmedModel
    const trimmedBase = entry.baseUrl.trim()
    if (trimmedBase) item.baseUrl = trimmedBase
    providers[meta.id] = item
  }
  // 组装 advanced(只在用户改过的字段才发,空对象不发)
  // Phase 12.7 Task E:三域 thinkingLevel != 'off' 才发(跳过 default off);
  // anthropic / gemini 子区受 activeProvider 闸门(跟 promptCaching / jsonMode 一致),
  // common 子区是「全局默认」始终允许发(active 不论谁,common.thinkingLevel 都生效)。
  const adv: NonNullable<GetLlmSettingsResponse['advanced']> = {}
  const common: NonNullable<NonNullable<GetLlmSettingsResponse['advanced']>['common']> = {}
  if (advanced.value.temperature !== null) common.temperature = advanced.value.temperature
  if (advanced.value.maxTokens !== null) common.maxTokens = advanced.value.maxTokens
  if (advanced.value.topP !== null) common.topP = advanced.value.topP
  if (advanced.value.thinkingLevelCommon !== 'off') {
    common.thinkingLevel = advanced.value.thinkingLevelCommon
  }
  if (Object.keys(common).length > 0) adv.common = common

  if (activeProvider.value === 'anthropic') {
    const ant: NonNullable<NonNullable<GetLlmSettingsResponse['advanced']>['anthropic']> = {}
    if (advanced.value.promptCaching) ant.promptCaching = true
    if (advanced.value.thinkingLevelAnthropic !== 'off') {
      ant.thinkingLevel = advanced.value.thinkingLevelAnthropic
      if (advanced.value.thinkingBudgetTokens != null && advanced.value.thinkingBudgetTokens > 0) {
        ant.thinkingBudgetTokens = advanced.value.thinkingBudgetTokens
      }
    }
    if (Object.keys(ant).length > 0) adv.anthropic = ant
  }
  if (activeProvider.value === 'gemini') {
    const gem: NonNullable<NonNullable<GetLlmSettingsResponse['advanced']>['gemini']> = {}
    if (advanced.value.jsonMode) gem.jsonMode = true
    if (advanced.value.longContextStrategy !== 'truncate') {
      gem.longContextStrategy = advanced.value.longContextStrategy
    }
    if (advanced.value.thinkingLevelGemini !== 'off') {
      gem.thinkingLevel = advanced.value.thinkingLevelGemini
    }
    if (Object.keys(gem).length > 0) adv.gemini = gem
  }

  return {
    activeProvider: activeProvider.value,
    providers,
    ...(Object.keys(adv).length > 0 ? { advanced: adv } : {}),
  }
}

/**
 * 用户反馈:三个 tab 一气配完时,旧版「保存」会关弹窗,得重开三次。
 * 加 keepOpen 参数:「应用」(保存当前 tab + 不关) / 「保存」(保存 + 关)。
 * apply 后短暂闪「已应用」提示让用户知道保存成功。
 */
const llmApplied = ref(false)
const imageApplied = ref(false)
let llmAppliedTimer: ReturnType<typeof setTimeout> | null = null
let imageAppliedTimer: ReturnType<typeof setTimeout> | null = null

function flashApplied(target: 'llm' | 'image') {
  if (target === 'llm') {
    llmApplied.value = true
    if (llmAppliedTimer) clearTimeout(llmAppliedTimer)
    llmAppliedTimer = setTimeout(() => { llmApplied.value = false }, 2000)
  } else {
    imageApplied.value = true
    if (imageAppliedTimer) clearTimeout(imageAppliedTimer)
    imageAppliedTimer = setTimeout(() => { imageApplied.value = false }, 2000)
  }
}

async function saveLlm(keepOpen = false): Promise<void> {
  if (saving.value) return
  saveError.value = ''
  // 校验:active provider 必须已配 apiKey(新填的或已存的)
  const entry = providerForms.value[activeProvider.value]
  if (!entry.apiKey.trim() && !entry.hasApiKey) {
    saveError.value = `请先为 ${activeMeta.value?.name ?? activeProvider.value} 填写 API Key`
    return
  }
  saving.value = true
  try {
    await api.put('/api/auth/llm-settings', buildPayload())
    // Phase 12.7：useAIChat 不再缓存 llm-settings（后端 agent loop 自维护），保存后无需 invalidate
    // 保存成功后:把所有刚填入的 apiKey 转成 hasApiKey=true,清空 input
    for (const meta of PROVIDER_CATALOG) {
      const e = providerForms.value[meta.id]
      if (e.apiKey.trim()) {
        e.hasApiKey = true
        e.apiKey = ''
      }
    }
    if (keepOpen) flashApplied('llm')
    else emit('update:open', false)
  } catch (err) {
    saveError.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    saving.value = false
  }
}

async function saveImage(keepOpen = false): Promise<void> {
  if (savingImage.value) return
  imageSaveError.value = ''
  if (!imageSettings.value.apiKey && !hasStoredImageApiKey.value) {
    imageSaveError.value = '请填写 OpenAI API Key'
    return
  }
  savingImage.value = true
  try {
    await saveImageLlmSettings({
      provider: imageSettings.value.provider,
      apiKey: imageSettings.value.apiKey,
      baseUrl: imageSettings.value.baseUrl?.trim() || undefined,
      model: imageSettings.value.model?.trim() || undefined,
    })
    hasStoredImageApiKey.value = true
    imageSettings.value.apiKey = ''
    if (keepOpen) flashApplied('image')
    else emit('update:open', false)
  } catch (err) {
    imageSaveError.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    savingImage.value = false
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
      await Promise.all([loadSettings(), loadImageSettings(), refresh()])
    }
  },
  { immediate: true },
)

onMounted(() => {
  void refresh()
})
</script>

<template>
  <Teleport to="body">
    <!-- 不挂 @click.self:用户反馈点击遮罩误关频繁,只允许 X 按钮 / 取消按钮显式关闭 -->
    <div v-if="open" class="modal-overlay">
      <div class="modal-content">
        <div class="modal-header">
          <h3>设置</h3>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-tabs-wrap">
          <div class="seg-tabs seg-tabs--three" role="tablist">
            <div
              class="seg-indicator seg-indicator--three"
              :class="{
                'seg-indicator--mid': activeTab === 'mcp',
                'seg-indicator--right': activeTab === 'image',
              }"
            />
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
            <button
              type="button"
              class="seg-tab"
              :class="{ active: activeTab === 'image' }"
              role="tab"
              :aria-selected="activeTab === 'image'"
              @click="activeTab = 'image'"
            >
              生图模型
            </button>
          </div>
        </div>

        <div v-if="activeTab === 'llm'" class="modal-body">
          <section class="form-section">
            <header class="section-header">
              <span class="section-title">活跃 Provider</span>
              <span class="section-hint">主 LLM 走哪家;切换前先保证该 provider 已配 API Key</span>
            </header>
            <select v-model="activeProvider" class="input-bare active-provider-select">
              <option
                v-for="meta in PROVIDER_CATALOG"
                :key="meta.id"
                :value="meta.id"
                :disabled="!configuredProviderIds.includes(meta.id)"
              >
                {{ meta.name }}
                <template v-if="!configuredProviderIds.includes(meta.id)">（未配置）</template>
              </option>
            </select>
          </section>

          <!--
            Provider 配置三层渐进披露(取代此前的 12 卡片平铺):
            1) 活跃 provider 完整卡片(置顶,永展开)
            2) 其他已配置(default 展开 details,紧凑卡)
            3) 未配置(default 折叠 details,列表行 + 「配置」展开紧凑 form)

            一张卡片三种渲染分支(complete / compact / unconfigured-row),共享同
            一个 data-provider-id="id" 锚点 + 同一份 apikey-/model-/baseurl- data-
            test 命名,保证测试 / 选择器在三层间任找一份都能 query 到该 provider。

            没拆 ProviderCard 子组件——遵循 Phase 12 Task J 的"保持单文件"决策
            (per-template scoped style + 内嵌 v-if 分支足够,避免 component file
            爆炸)。
          -->
          <section class="form-section">
            <header class="section-header">
              <span class="section-title">活跃 Provider 配置</span>
              <span class="section-hint">主 LLM 走哪家;留空 API Key 表示保留旧值</span>
            </header>
            <article
              v-if="activeMeta"
              class="provider-config-card active"
              :data-provider-id="activeProvider"
            >
              <header class="provider-config-head">
                <span class="provider-config-name">{{ activeMeta.name }}</span>
                <span class="provider-family-badge">{{ activeMeta.family }}</span>
                <span
                  v-if="providerForms[activeProvider].hasApiKey || providerForms[activeProvider].apiKey.trim()"
                  class="provider-config-state state-ok"
                >
                  <Check :size="12" :stroke-width="2.4" />已配置
                </span>
                <span v-else class="provider-config-state state-empty">未配置</span>
              </header>
              <div class="provider-config-fields">
                <label class="field-row">
                  <span class="field-label">API Key</span>
                  <div class="input-group">
                    <input
                      v-model="providerForms[activeProvider].apiKey"
                      :type="providerForms[activeProvider].showApiKey ? 'text' : 'password'"
                      :placeholder="
                        providerForms[activeProvider].hasApiKey
                          ? '留空表示不修改'
                          : activeMeta.family === 'anthropic'
                            ? 'sk-ant-...'
                            : 'sk-...'
                      "
                      autocomplete="off"
                      class="input-group__input"
                      :data-test="`apikey-${activeProvider}`"
                    />
                    <button
                      type="button"
                      class="input-group__action"
                      :title="providerForms[activeProvider].showApiKey ? '隐藏' : '显示'"
                      :aria-label="providerForms[activeProvider].showApiKey ? '隐藏' : '显示'"
                      @click="providerForms[activeProvider].showApiKey = !providerForms[activeProvider].showApiKey"
                    >
                      <EyeOff v-if="providerForms[activeProvider].showApiKey" :size="14" :stroke-width="1.8" />
                      <Eye v-else :size="14" :stroke-width="1.8" />
                    </button>
                  </div>
                </label>
                <label class="field-row">
                  <span class="field-label">Model</span>
                  <input
                    v-model="providerForms[activeProvider].model"
                    type="text"
                    :placeholder="`默认:${activeMeta.defaultModel}`"
                    autocomplete="off"
                    class="input-bare"
                    :list="`model-options-${activeProvider}`"
                    :data-test="`model-${activeProvider}`"
                    @focus="loadModelsIfNeeded(activeProvider)"
                  />
                  <datalist :id="`model-options-${activeProvider}`">
                    <option
                      v-for="opt in modelOptions[activeProvider] ?? []"
                      :key="opt.id"
                      :value="opt.id"
                    >
                      {{ opt.name }}
                    </option>
                  </datalist>
                </label>
                <label class="field-row">
                  <span class="field-label">
                    Base URL
                    <span v-if="activeMeta.family !== 'openai-compatible'" class="field-label-hint">（可选）</span>
                  </span>
                  <input
                    v-model="providerForms[activeProvider].baseUrl"
                    type="text"
                    :placeholder="
                      'defaultBaseUrl' in activeMeta
                        ? `默认:${(activeMeta as { defaultBaseUrl: string }).defaultBaseUrl}`
                        : '中转 / 自部署的 base URL'
                    "
                    autocomplete="off"
                    class="input-bare"
                    :data-test="`baseurl-${activeProvider}`"
                  />
                </label>
              </div>
            </article>
          </section>

          <!-- 其他已配置:default 展开(已配说明用户关心) -->
          <section v-if="otherConfiguredProviders.length > 0" class="form-section">
            <details class="provider-group" open data-test="other-configured-group">
              <summary class="provider-group-summary">
                <ChevronRight :size="14" :stroke-width="1.8" class="provider-group-chevron" />
                <span class="section-title">其他已配置</span>
                <span class="provider-group-count">{{ otherConfiguredProviders.length }}</span>
              </summary>
              <div class="provider-list">
                <article
                  v-for="meta in otherConfiguredProviders"
                  :key="meta.id"
                  class="provider-config-card compact"
                  :data-provider-id="meta.id"
                >
                  <header class="provider-config-head">
                    <span class="provider-config-name">{{ meta.name }}</span>
                    <span class="provider-family-badge">{{ meta.family }}</span>
                    <span class="provider-config-state state-ok">
                      <Check :size="12" :stroke-width="2.4" />已配置
                    </span>
                  </header>
                  <div class="provider-config-fields">
                    <label class="field-row">
                      <span class="field-label">API Key</span>
                      <div class="input-group">
                        <input
                          v-model="providerForms[meta.id].apiKey"
                          :type="providerForms[meta.id].showApiKey ? 'text' : 'password'"
                          :placeholder="
                            providerForms[meta.id].hasApiKey
                              ? '留空表示不修改'
                              : meta.family === 'anthropic'
                                ? 'sk-ant-...'
                                : 'sk-...'
                          "
                          autocomplete="off"
                          class="input-group__input"
                          :data-test="`apikey-${meta.id}`"
                        />
                        <button
                          type="button"
                          class="input-group__action"
                          :title="providerForms[meta.id].showApiKey ? '隐藏' : '显示'"
                          :aria-label="providerForms[meta.id].showApiKey ? '隐藏' : '显示'"
                          @click="providerForms[meta.id].showApiKey = !providerForms[meta.id].showApiKey"
                        >
                          <EyeOff v-if="providerForms[meta.id].showApiKey" :size="14" :stroke-width="1.8" />
                          <Eye v-else :size="14" :stroke-width="1.8" />
                        </button>
                      </div>
                    </label>
                    <label class="field-row">
                      <span class="field-label">Model</span>
                      <input
                        v-model="providerForms[meta.id].model"
                        type="text"
                        :placeholder="`默认:${meta.defaultModel}`"
                        autocomplete="off"
                        class="input-bare"
                        :list="`model-options-${meta.id}`"
                        :data-test="`model-${meta.id}`"
                        @focus="loadModelsIfNeeded(meta.id)"
                      />
                      <datalist :id="`model-options-${meta.id}`">
                        <option
                          v-for="opt in modelOptions[meta.id] ?? []"
                          :key="opt.id"
                          :value="opt.id"
                        >
                          {{ opt.name }}
                        </option>
                      </datalist>
                    </label>
                    <label class="field-row">
                      <span class="field-label">
                        Base URL
                        <span v-if="meta.family !== 'openai-compatible'" class="field-label-hint">（可选）</span>
                      </span>
                      <input
                        v-model="providerForms[meta.id].baseUrl"
                        type="text"
                        :placeholder="
                          'defaultBaseUrl' in meta
                            ? `默认:${(meta as { defaultBaseUrl: string }).defaultBaseUrl}`
                            : '中转 / 自部署的 base URL'
                        "
                        autocomplete="off"
                        class="input-bare"
                        :data-test="`baseurl-${meta.id}`"
                      />
                    </label>
                  </div>
                  <footer class="provider-config-footer">
                    <button
                      type="button"
                      class="provider-config-activate"
                      :data-test="`set-active-${meta.id}`"
                      @click="selectActiveProvider(meta.id)"
                    >
                      设为活跃
                    </button>
                  </footer>
                </article>
              </div>
            </details>
          </section>

          <!-- 未配置:default 折叠(默认看到的卡片数 12 → 1) -->
          <section v-if="unconfiguredProviders.length > 0" class="form-section">
            <details class="provider-group" data-test="unconfigured-group">
              <summary class="provider-group-summary">
                <ChevronRight :size="14" :stroke-width="1.8" class="provider-group-chevron" />
                <span class="section-title">未配置</span>
                <span class="provider-group-count">{{ unconfiguredProviders.length }}</span>
              </summary>
              <div class="provider-unconfigured-list">
                <div
                  v-for="meta in unconfiguredProviders"
                  :key="meta.id"
                  class="provider-unconfigured-item"
                  :data-provider-id="meta.id"
                >
                  <div class="provider-unconfigured-row">
                    <span class="provider-config-name">{{ meta.name }}</span>
                    <span class="provider-family-badge">{{ meta.family }}</span>
                    <span class="provider-config-state state-empty">未配置</span>
                    <button
                      type="button"
                      class="provider-config-activate"
                      :data-test="`configure-${meta.id}`"
                      @click="toggleUnconfigured(meta.id)"
                    >
                      {{ expandedUnconfigured === meta.id ? '收起' : '配置' }}
                    </button>
                  </div>
                  <div
                    v-if="expandedUnconfigured === meta.id"
                    class="provider-config-fields provider-unconfigured-fields"
                  >
                    <label class="field-row">
                      <span class="field-label">API Key</span>
                      <div class="input-group">
                        <input
                          v-model="providerForms[meta.id].apiKey"
                          :type="providerForms[meta.id].showApiKey ? 'text' : 'password'"
                          :placeholder="meta.family === 'anthropic' ? 'sk-ant-...' : 'sk-...'"
                          autocomplete="off"
                          class="input-group__input"
                          :data-test="`apikey-${meta.id}`"
                        />
                        <button
                          type="button"
                          class="input-group__action"
                          :title="providerForms[meta.id].showApiKey ? '隐藏' : '显示'"
                          :aria-label="providerForms[meta.id].showApiKey ? '隐藏' : '显示'"
                          @click="providerForms[meta.id].showApiKey = !providerForms[meta.id].showApiKey"
                        >
                          <EyeOff v-if="providerForms[meta.id].showApiKey" :size="14" :stroke-width="1.8" />
                          <Eye v-else :size="14" :stroke-width="1.8" />
                        </button>
                      </div>
                    </label>
                    <label class="field-row">
                      <span class="field-label">Model</span>
                      <input
                        v-model="providerForms[meta.id].model"
                        type="text"
                        :placeholder="`默认:${meta.defaultModel}`"
                        autocomplete="off"
                        class="input-bare"
                        :list="`model-options-${meta.id}`"
                        :data-test="`model-${meta.id}`"
                        @focus="loadModelsIfNeeded(meta.id)"
                      />
                      <datalist :id="`model-options-${meta.id}`">
                        <option
                          v-for="opt in modelOptions[meta.id] ?? []"
                          :key="opt.id"
                          :value="opt.id"
                        >
                          {{ opt.name }}
                        </option>
                      </datalist>
                    </label>
                    <label class="field-row">
                      <span class="field-label">
                        Base URL
                        <span v-if="meta.family !== 'openai-compatible'" class="field-label-hint">（可选）</span>
                      </span>
                      <input
                        v-model="providerForms[meta.id].baseUrl"
                        type="text"
                        :placeholder="
                          'defaultBaseUrl' in meta
                            ? `默认:${(meta as { defaultBaseUrl: string }).defaultBaseUrl}`
                            : '中转 / 自部署的 base URL'
                        "
                        autocomplete="off"
                        class="input-bare"
                        :data-test="`baseurl-${meta.id}`"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </details>
          </section>

          <section class="form-section">
            <button
              type="button"
              class="advanced-toggle"
              :class="{ expanded: advancedExpanded }"
              :aria-expanded="advancedExpanded"
              @click="toggleAdvanced"
            >
              <ChevronDown :size="14" :stroke-width="1.8" />
              <span class="section-title">Advanced</span>
              <span class="section-hint">采样参数 + provider 特有配置</span>
            </button>
            <div v-if="advancedExpanded" class="advanced-panel" data-test="advanced-panel">
              <div class="advanced-subblock">
                <header class="subblock-title">通用</header>
                <label class="field-row">
                  <span class="field-label">Temperature ({{ advanced.temperature ?? '默认' }})</span>
                  <input
                    v-model.number="advanced.temperature"
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    class="input-slider"
                    data-test="adv-temperature"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">Max Tokens</span>
                  <input
                    v-model.number="advanced.maxTokens"
                    type="number"
                    min="1"
                    placeholder="留空走 provider 默认"
                    class="input-bare"
                    data-test="adv-max-tokens"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">Top P ({{ advanced.topP ?? '默认' }})</span>
                  <input
                    v-model.number="advanced.topP"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    class="input-slider"
                    data-test="adv-top-p"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">Thinking 级别（全局默认）</span>
                  <select
                    v-model="advanced.thinkingLevelCommon"
                    class="input-bare"
                    data-test="adv-common-thinking-level"
                  >
                    <option value="off">关闭</option>
                    <option value="minimal">最少</option>
                    <option value="low">低</option>
                    <option value="medium">中等</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                  </select>
                </label>
              </div>

              <div v-if="activeProvider === 'anthropic'" class="advanced-subblock" data-test="anthropic-advanced">
                <header class="subblock-title">Anthropic 专有</header>
                <label class="field-row toggle-row">
                  <span class="field-label">Prompt Caching</span>
                  <input
                    v-model="advanced.promptCaching"
                    type="checkbox"
                    class="input-toggle"
                    data-test="adv-prompt-caching"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">Thinking 级别</span>
                  <select
                    v-model="advanced.thinkingLevelAnthropic"
                    class="input-bare"
                    data-test="adv-thinking-level"
                  >
                    <option value="off">关闭</option>
                    <option value="minimal">最少</option>
                    <option value="low">低</option>
                    <option value="medium">中等</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                  </select>
                </label>
                <label class="field-row">
                  <span class="field-label">Thinking Budget (tokens)</span>
                  <input
                    v-model.number="advanced.thinkingBudgetTokens"
                    type="number"
                    min="0"
                    :disabled="advanced.thinkingLevelAnthropic === 'off'"
                    class="input-bare"
                    data-test="adv-thinking-budget"
                  />
                </label>
              </div>

              <div v-if="activeProvider === 'gemini'" class="advanced-subblock" data-test="gemini-advanced">
                <header class="subblock-title">Gemini 专有</header>
                <label class="field-row toggle-row">
                  <span class="field-label">JSON Mode</span>
                  <input
                    v-model="advanced.jsonMode"
                    type="checkbox"
                    class="input-toggle"
                    data-test="adv-json-mode"
                  />
                </label>
                <label class="field-row">
                  <span class="field-label">Long Context Strategy</span>
                  <select v-model="advanced.longContextStrategy" class="input-bare" data-test="adv-long-ctx">
                    <option value="truncate">truncate（截断旧消息）</option>
                    <option value="segment">segment（分段总结）</option>
                  </select>
                </label>
                <label class="field-row">
                  <span class="field-label">Thinking 级别</span>
                  <select
                    v-model="advanced.thinkingLevelGemini"
                    class="input-bare"
                    data-test="adv-gemini-thinking-level"
                  >
                    <option value="off">关闭</option>
                    <option value="minimal">最少</option>
                    <option value="low">低</option>
                    <option value="medium">中等</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          <p v-if="saveError" class="form-error" data-test="save-error">{{ saveError }}</p>

          <div class="modal-footer">
            <span v-if="llmApplied" class="applied-flash" role="status" aria-live="polite">✓ 已应用</span>
            <button type="button" class="btn-secondary" :disabled="saving" @click="close">取消</button>
            <button
              type="button"
              class="btn-secondary"
              :disabled="saving"
              data-test="apply-button"
              @click="saveLlm(true)"
            >
              {{ saving ? '保存中...' : '应用' }}
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="saving"
              data-test="save-button"
              @click="saveLlm(false)"
            >
              {{ saving ? '保存中...' : '保存并关闭' }}
            </button>
          </div>
        </div>

        <div v-else-if="activeTab === 'mcp'" class="modal-body">
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
                :llm="activeProviderLegacyShape"
                :has-llm-key="activeProviderHasLlmKey"
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

        <div v-else class="modal-body">
          <section class="form-section">
            <p class="image-intro">
              生图能力独立于主 LLM。当你在 Chat 里明确要求"生成图片 / 画一张..."时，
              工具会调 OpenAI 的 image_generation 能力出图并放入对应 slide。
              <strong>仅支持 OpenAI 付费账号（任意 Tier 1+）</strong>，未配置时该工具不可用。
            </p>
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">Provider</span>
              <span class="section-hint">v1 仅支持 OpenAI；后续会加 Midjourney / Flux</span>
            </header>
            <select v-model="imageSettings.provider" class="input-bare" disabled>
              <option value="openai">OpenAI</option>
            </select>
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">OpenAI API Key</span>
              <span class="section-hint">
                {{
                  hasStoredImageApiKey
                    ? '已保存（服务端加密）。如需更换请重新输入'
                    : '服务端 AES-256-GCM 加密存储，不回传'
                }}
              </span>
            </header>
            <div class="input-group">
              <input
                v-model="imageSettings.apiKey"
                :type="showImageApiKey ? 'text' : 'password'"
                :placeholder="hasStoredImageApiKey ? '留空表示不修改' : 'sk-...'"
                autocomplete="off"
                class="input-group__input"
              />
              <button
                type="button"
                class="input-group__action"
                :title="showImageApiKey ? '隐藏' : '显示'"
                :aria-label="showImageApiKey ? '隐藏' : '显示'"
                @click="showImageApiKey = !showImageApiKey"
              >
                <EyeOff v-if="showImageApiKey" :size="16" :stroke-width="1.8" />
                <Eye v-else :size="16" :stroke-width="1.8" />
              </button>
            </div>
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">接口地址（可选）</span>
              <span class="section-hint">中转 / 自部署的 base URL；留空走 https://api.openai.com/v1</span>
            </header>
            <input
              v-model="imageSettings.baseUrl"
              type="text"
              placeholder="https://api.openai.com/v1"
              autocomplete="off"
              class="input-bare"
            />
          </section>

          <section class="form-section">
            <header class="section-header">
              <span class="section-title">模型</span>
              <span class="section-hint">默认自动 fallback，特殊情况可锁定模型</span>
            </header>
            <select v-model="imageSettings.model" class="input-bare">
              <option v-for="m in IMAGE_MODEL_OPTIONS" :key="m.value" :value="m.value">
                {{ m.label }}
              </option>
            </select>
          </section>

          <p v-if="imageSaveError" class="form-error">{{ imageSaveError }}</p>

          <div class="modal-footer">
            <span v-if="imageApplied" class="applied-flash" role="status" aria-live="polite">✓ 已应用</span>
            <button type="button" class="btn-secondary" :disabled="savingImage" @click="close">
              取消
            </button>
            <button
              type="button"
              class="btn-secondary"
              :disabled="savingImage"
              @click="saveImage(true)"
            >
              {{ savingImage ? '保存中...' : '应用' }}
            </button>
            <button type="button" class="btn-primary" :disabled="savingImage" @click="saveImage(false)">
              {{ savingImage ? '保存中...' : '保存并关闭' }}
            </button>
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
  width: 720px;
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

/* Phase 11.5：3-tab 变体（生图模型 tab 加入后）。
   关键:用 grid 强制三 tab 等宽,否则文字长的 tab 会被自然撑开 →
   indicator 按"三等分"算的位置跟实际 tab 起止边对不上,视觉错位。 */
.seg-tabs--three {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  min-width: 360px;
}

.seg-indicator--three {
  width: calc((100% - 8px) / 3);
}

.seg-indicator--three.seg-indicator--mid {
  transform: translateX(100%);
}

.seg-indicator--three.seg-indicator--right {
  transform: translateX(200%);
}

.seg-tabs--three .seg-tab {
  min-width: 0;
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

/* ---- Active Provider Select ---- */
.active-provider-select {
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
}

/* ---- Provider Config Card list ---- */
.provider-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.provider-config-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  padding: var(--space-3) var(--space-4);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.provider-config-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.08);
}

.provider-config-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.provider-config-name {
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-size: var(--fs-md);
}

.provider-family-badge {
  font-size: 11px;
  font-weight: var(--fw-medium);
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-subtle);
  color: var(--color-fg-tertiary);
  font-family: var(--font-mono);
}

.provider-config-state {
  font-size: var(--fs-sm);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.state-ok {
  color: var(--color-accent);
}

.state-empty {
  color: var(--color-fg-muted);
}

.provider-config-activate {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-fg-secondary);
  cursor: pointer;
  font-size: var(--fs-sm);
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.provider-config-activate:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.provider-config-activate:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.provider-config-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.provider-config-card.compact {
  background: var(--color-bg-surface);
  padding: var(--space-3);
}

.provider-config-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-3);
}

/* ---- Provider Group (details / summary 折叠) ---- */
.provider-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.provider-group-summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
  list-style: none;
  user-select: none;
  padding: var(--space-1) 0;
  color: var(--color-fg-secondary);
}

.provider-group-summary::-webkit-details-marker {
  display: none;
}

.provider-group-chevron {
  transition: transform var(--dur-fast) var(--ease-out);
  color: var(--color-fg-tertiary);
}

.provider-group[open] .provider-group-chevron {
  transform: rotate(90deg);
}

.provider-group-count {
  font-size: 11px;
  font-weight: var(--fw-medium);
  line-height: 1;
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--color-bg-subtle);
  color: var(--color-fg-tertiary);
}

/* ---- Unconfigured list (单行 + on-demand 展开内嵌 form) ---- */
.provider-unconfigured-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.provider-unconfigured-item {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  padding: var(--space-2) var(--space-3);
}

.provider-unconfigured-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.provider-unconfigured-row .provider-config-state {
  margin-left: auto;
}

.provider-unconfigured-fields {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--color-border-subtle);
}

.field-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: var(--space-3);
}

.field-label {
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
}

.field-label-hint {
  color: var(--color-fg-muted);
  font-size: 11px;
}

.toggle-row .input-toggle {
  justify-self: start;
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.input-slider {
  width: 100%;
}

/* ---- Advanced Toggle / Panel ---- */
.advanced-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  color: var(--color-fg-secondary);
  text-align: left;
}

.advanced-toggle svg {
  transition: transform var(--dur-fast) var(--ease-out);
}

.advanced-toggle.expanded svg {
  transform: rotate(180deg);
}

.advanced-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
}

.advanced-subblock {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.subblock-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  margin-bottom: var(--space-1);
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

.input-bare:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ---- Image LLM intro ---- */
.image-intro {
  margin: 0;
  padding: var(--space-3);
  background: var(--color-bg-subtle);
  border-radius: var(--radius-md);
  color: var(--color-fg-secondary);
  font-size: var(--fs-sm);
  line-height: 1.6;
}

.image-intro strong {
  color: var(--color-accent);
  font-weight: var(--fw-semibold);
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
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--color-border-subtle);
  margin-top: var(--space-2);
}

.applied-flash {
  margin-right: auto;
  color: var(--color-success, #2a8a3f);
  font-size: var(--fs-sm);
  font-weight: 500;
  animation: applied-fade 2s ease-out;
}

@keyframes applied-fade {
  0%, 80% { opacity: 1; }
  100% { opacity: 0; }
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
