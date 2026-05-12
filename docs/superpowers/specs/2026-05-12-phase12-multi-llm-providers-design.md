# Phase 12 Spec — 多 LLM Provider 原生接口（Anthropic Claude + Google Gemini）

> 状态：Design 已对齐（2026-05-12），待用户审阅本 spec → 进入 writing-plans。
> 关联 roadmap：[`docs/requirements/roadmap.md` Phase 12](../../requirements/roadmap.md)
> 依赖：Phase 10.5 ✅（Phase 11 已废弃合并进 Phase 16）

## 1. 目标（用户视角）

把 LLM 调用从「OpenAI 兼容代理 only」升级到**三协议原生**：

- **OpenAI 兼容**（沿用）：openai / 智谱 GLM / DeepSeek / Moonshot / Qwen 共 5 个 provider 走同一份 OpenAI SDK
- **Anthropic Claude 原生**：通过 `@anthropic-ai/sdk` 直接调 `/v1/messages`，拿到 prompt caching + extended thinking blocks + 原生 tool_use 块顺序
- **Google Gemini 原生**：通过 `@google/genai` 直接调 `generateContent`，拿到 long context 策略 + structured output (response schema) + Gemini parts 原生 streaming

用户能在前端 Settings 里自由切换 active provider，每个 provider 独立配置 API key + model + 可选 baseUrl + 可选 advanced 参数；切换不影响业务代码，老 LLM 配置自动迁移到新 schema。

## 2. 不做什么

- ❌ 同时启用多个主 LLM（无意义；单 active provider，用户可切换）
- ❌ Fine-tuning / 自托管模型（Ollama / vLLM）—— 留 Phase 17+
- ❌ Provider 价格估算 / 用量统计页 —— 留 Phase 17+
- ❌ 自动按任务类型路由 provider（手动选）
- ❌ 多人协同 / 共享 provider 配置 —— per-user 独立
- ❌ image generation 工具的 provider 抽象 —— `generate_slide_image` 仍走当前 `openai-image.ts` 独立路径，本 Phase 范围只覆盖 chat LLM
- ❌ 引入 Vercel AI SDK 或类似第三方统一抽象 —— 跟我们要建的 LLMProvider 接口冲突（双层抽象 + 原生特性滞后）

## 3. 验收条件

- [ ] 三家 provider（OpenAI 兼容族 / Anthropic / Gemini）任一都能完整跑通：
  - 单轮对话 + 流式输出 + 取消
  - 多轮 tool 调用（含 MCP 工具，命名规范 `mcp__<serverId>__<toolName>` 不变）
  - 8 页 deck 完整生成场景
- [ ] 切换 active provider 不需改业务代码（创建 deck / 切模板 / 编辑迭代等所有 LLM 入口零感知）
- [ ] 用户在前端 Settings 自由切换 provider，per-provider API key 独立加密存储（AES-256-GCM，沿用 `APIKEY_MASTER_KEY`）
- [ ] 老用户的单 provider `llm_settings` 自动迁移到新 schema，无丢失（迁移脚本一次性跑）
- [ ] **Anthropic prompt caching 可观测**：cache hit / cost token 数透传到前端 UI（每轮对话气泡下显示「本轮命中缓存 N tokens」）
- [ ] **Claude extended thinking** 可观测：thinking block 内容流式渲染到前端独立 UI 区（折叠可展开），跟 assistant text 视觉区隔
- [ ] 多模态 image input（user message 含图片）三家 provider 都能跑通
- [ ] Mock 单测覆盖率：LLM 抽象层 lines 90 / branches 85（per-file）
- [ ] Smoke test：每家 provider ≥ 1 个真 API 测试（warn-not-fail，key 不稳时 skip 不阻塞）
- [ ] 部署到 lumideck.illegalscreed.cn 至少跑通一次「用 Claude 生成 deck + 切到 Gemini 继续编辑」端到端场景

## 4. 架构总览

新增 `packages/agent/src/llm/` 作为 LLM 抽象层全部代码归属。

```
packages/agent/src/llm/
├── types.ts                          # canonical 类型（Message / Block / Event / ProviderConfig）
├── provider.ts                       # LLMProvider interface + ProviderRegistry
├── adapters/
│   ├── openai-compatible.ts          # 5 个 OpenAI-兼容 provider 共享
│   ├── anthropic.ts                  # @anthropic-ai/sdk
│   └── gemini.ts                     # @google/genai
├── canonical-sse.ts                  # 8 类 event 的 wire encoder / decoder
├── translate/
│   ├── to-openai.ts                  # CanonicalMessage[] → OpenAI 入参
│   ├── to-anthropic.ts               # CanonicalMessage[] → Anthropic 入参
│   ├── to-gemini.ts                  # CanonicalMessage[] → Gemini 入参
│   ├── from-openai-stream.ts         # OpenAI chunk → canonical Event 流
│   ├── from-anthropic-stream.ts      # Anthropic event → canonical Event 流
│   └── from-gemini-stream.ts         # Gemini chunk → canonical Event 流
├── errors.ts                         # 统一错误类型 (RateLimit / Auth / Network / InvalidRequest / Unknown)
└── __tests__/
    ├── translate-*.test.ts           # mock 单测（90/85 门槛）
    └── smoke/                        # 真 API smoke test（test:smoke script，warn-not-fail）
```

`packages/shared/llm-canonical.ts` 暴露 canonical types 给 creator 共享。

`packages/agent/src/routes/llm.ts` 改写：从「HTTP 透传」改成「接 canonical request → 路由到 provider → 转发 canonical SSE」。

`packages/creator/src/composables/useAIChat.ts` 重写 streaming 解析层（约 -500 行净减），消费 canonical event SSE。

### 4.1 LLMProvider interface

```ts
interface LLMProvider {
  readonly id: string  // 'openai' | 'anthropic' | 'gemini' | 'zhipu' | ...
  readonly family: 'openai-compatible' | 'anthropic' | 'gemini'

  streamChat(req: CanonicalChatRequest, signal: AbortSignal): AsyncIterable<CanonicalEvent>
  listModels?(): Promise<Array<{ id: string; description?: string }>>  // 可选，部分 provider 支持
}
```

`ProviderRegistry.get(userId)` 读取 user.llm_settings 解密 → 拿 activeProvider → 构造对应 adapter 实例（带 apiKey / baseUrl / advanced params）→ 返回 LLMProvider。

### 4.2 canonical 类型（核心）

```ts
type CanonicalRole = 'system' | 'user' | 'assistant' | 'tool'

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; dataBase64: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string | Block[]; isError?: boolean }

type CanonicalMessage = {
  role: CanonicalRole
  content: Block[]
  cacheControl?: { type: 'ephemeral' }  // Anthropic prompt caching 标记
}

type CanonicalChatRequest = {
  messages: CanonicalMessage[]
  tools?: ToolDef[]
  temperature?: number
  maxTokens?: number
  topP?: number
  stopSequences?: string[]
  thinking?: { enabled: boolean; budgetTokens?: number }  // Anthropic 专属
  structuredOutput?: { schema: JSONSchema }                // 主要 Gemini 用
}

type CanonicalEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call.start'; id: string; name: string }
  | { type: 'tool_call.delta'; id: string; argsChunk: string }
  | { type: 'tool_call.end'; id: string }
  | { type: 'thinking.delta'; text: string }
  | { type: 'cache.hit'; cachedTokens: number; costTokens: number }
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_use' | 'content_filter'; usage: TokenUsage }
  | { type: 'error'; code: string; message: string }
```

### 4.3 wire format（canonical SSE）

agent → frontend：标准 SSE，每事件用 `event:` 字段标 type，`data:` 字段是 JSON payload。

```
event: text.delta
data: {"text":"Hello"}

event: text.delta
data: {"text":" world"}

event: tool_call.start
data: {"id":"call_abc","name":"write_slides"}

event: tool_call.delta
data: {"id":"call_abc","argsChunk":"{\"slides\":["}

event: tool_call.end
data: {"id":"call_abc"}

event: cache.hit
data: {"cachedTokens":12450,"costTokens":89}

event: finish
data: {"reason":"tool_use","usage":{"input":13520,"output":234,"cached":12450}}
```

frontend `canonical-sse.ts` decoder 用 `ReadableStream` + 状态机解析 `event:` / `data:` 双行 frame。

## 5. users.llm_settings schema 迁移

### 旧 shape（Phase 5 起）

```ts
{ provider, apiKey, baseUrl?, model?, apiType? }
```

### 新 shape

```ts
type LlmSettings = {
  activeProvider:
    | 'openai' | 'anthropic' | 'gemini'
    | 'zhipu' | 'deepseek' | 'moonshot' | 'qwen'
  providers: {
    openai?:    { apiKey: string; model?: string; baseUrl?: string }
    anthropic?: { apiKey: string; model?: string; baseUrl?: string }
    gemini?:    { apiKey: string; model?: string; baseUrl?: string }
    zhipu?:     { apiKey: string; model?: string; baseUrl?: string }
    deepseek?:  { apiKey: string; model?: string; baseUrl?: string }
    moonshot?:  { apiKey: string; model?: string; baseUrl?: string }
    qwen?:      { apiKey: string; model?: string; baseUrl?: string }
  }
  advanced?: {
    anthropic?: { promptCaching?: boolean; thinkingEnabled?: boolean; thinkingBudgetTokens?: number }
    gemini?:    { jsonMode?: boolean; longContextStrategy?: 'truncate' | 'segment' }
    common?:    { temperature?: number; maxTokens?: number; topP?: number; stopSequences?: string[] }
  }
}
```

加密层不变：整个 JSON object 仍 AES-256-GCM 加密存 `users.llm_settings` (LONGTEXT)。

### 迁移脚本

`packages/agent/scripts/migrate-llm-settings.mjs`：

1. 解密所有用户的旧 `llm_settings`
2. 转成新 shape：`{ activeProvider: old.provider, providers: { [old.provider]: { apiKey, baseUrl, model } } }`
3. 重新加密写回
4. 失败用户列名单 + 报错，不阻塞其他用户

dev/test/prod 三库各跑一次（local: `pnpm -F @big-ppt/agent migrate:llm-settings`；prod: 部署时跑一次，详见 plan）。

## 6. tool calling 跨 provider 翻译

MCP 工具命名 `mcp__<serverId>__<toolName>` 在三家 provider 上**原封透传**：

- OpenAI: `tools[i].function.name = "mcp__notion__searchPages"` ✅ 合法
- Anthropic: `tools[i].name = "mcp__notion__searchPages"` ✅ 合法（match `^[a-zA-Z0-9_-]{1,64}$`）
- Gemini: `tools[i].functionDeclarations[i].name = "mcp__notion__searchPages"` ✅ 合法

工具入参 schema（JSON Schema）三家通用，但有细节差异：

- OpenAI: `tools[i].function.parameters` (JSON Schema)
- Anthropic: `tools[i].input_schema` (JSON Schema 子集，不支持 `oneOf` / `allOf`)
- Gemini: `tools[i].functionDeclarations[i].parameters` (OpenAPI 3.0 子集，不支持 `additionalProperties`)

`translate/to-*.ts` 每家做 schema sanitization：把 canonical JSON Schema 降级到目标 provider 接受的子集，记录 warning 不阻塞（无法表达的约束放业务层兜底）。

历史消息持久化用 canonical shape 存 `deck_chats` 表（新增 column `canonical_content JSON`，旧 `content`/`tool_call_id` 字段保留向后兼容 + 一次性迁移）。**用户切 provider 时历史消息无损延续**。

## 7. 前端改造

`useAIChat.ts` 重写 streaming 解析（约 -500 行净减）：

- 删：OpenAI delta `tool_calls[].index` 累积逻辑、args 字符串分片拼接、孤儿 tool 守护（这些移到 backend `translate/from-openai-stream.ts`）
- 加：canonical event consumer（switch event.type 写状态机）+ thinking block UI 渲染区 + cache hit UI 提示

Settings UI（`SettingsModal.vue`）改造：

- 顶部下拉：active provider（7 选 1）
- 每 provider 一个 collapsible section：apiKey / model / baseUrl 输入
- Advanced 子区：Anthropic 专属（prompt caching toggle / thinking enabled + budget slider）+ Gemini 专属（json mode / long context strategy） + 通用（temperature / maxTokens / topP）

## 8. 测试策略

### Mock 单测

每个 translate/from-*.ts 都有对应 `__tests__/from-*-stream.test.ts`：

- 输入：录制的真 stream chunk 序列（fixture JSON）
- 输出：canonical Event 序列
- 断言：序列匹配（type + payload 字段）

每个 translate/to-*.ts 都有对应 `__tests__/to-*.test.ts`：

- 输入：canonical Message[] + tools
- 输出：provider-specific 入参
- 断言：shape 匹配 + JSON Schema sanitization 正确

LLM 抽象层 lines 90 / branches 85 per-file 门槛（沿用 agent 安全模块标准）。

### Smoke test（真 API，warn-not-fail）

`packages/agent/src/llm/__tests__/smoke/*.smoke.test.ts`，每家 provider 一个 file：

- 测试 case：单轮 chat + 一次 tool call + 流式
- 用 `.env.test.local` 注入 key（gitignored）
- 单次 retry，连续 2 次 timeout / 5xx → `it.skipIf(...)` 跳过 + console.warn 高亮
- 进 `pnpm test:smoke` 脚本，**不**进默认 `pnpm test`
- nightly + 部署前 manual trigger 跑

### Smoke test 中转协议探测（plan 首步）

`duckcoding.ai` 是否支持 Anthropic 原生 `/v1/messages` + Gemini 原生 `generateContent` 未知，plan 第一步先 curl 探测：

- 支持 → smoke test 用中转 key 跑 native adapter，等价产线
- 不支持 → 文档化，要求 native adapter 上线前用临时直连官方 API key 跑通一次；中转 key 仅跑 OpenAI-兼容路径

## 9. 错误处理

`llm/errors.ts` 统一错误层级：

```ts
class LLMError extends Error {
  code: 'rate_limit' | 'auth' | 'network' | 'invalid_request' | 'context_too_long' | 'unknown'
  provider: string
  retryable: boolean
  cause?: unknown  // 原始 SDK error
}
```

每个 adapter 在 SDK 抛错时翻译成 LLMError；frontend 拿到 canonical `error` event 后按 code 走 UI 提示分支。

`logServerEvent({ category: 'llm', event: 'request-failed', provider, code, ... })` 全部落 `logs/server-YYYY-MM-DD.jsonl`，沿用 Phase 11.6 dogfood 后立的「重要功能必须落盘」规范。

## 10. 部署 / 配置

- `packages/agent/package.json` 新增依赖：`@anthropic-ai/sdk` + `@google/genai`（`openai` 已有）
- 锁版本号，不跟 npm `latest`（参考 [plan 17 踩坑 6](../../plans/17-phase8-deps-upgrade.md) `@antdv-next/x` 教训）
- 部署前先在 staging（本地 + prod 一次性 smoke run）跑一遍三家 native adapter
- 部署 script `deploy:backend` 已有的 `pnpm i` + `db:push:prod` + pm2 reload 流程不变；migration 脚本一次性 manual ssh 跑

## 11. 关键风险

| 风险 | 应对 |
|---|---|
| 中转 `duckcoding.ai` 不支持 native 协议 | plan 首步探测；smoke fallback 到 OpenAI-兼容路径，文档化 native 上线前用直连 key 验证一次 |
| Anthropic / Gemini SDK 升级 breaking | 锁 minor 版本；CI 增加 smoke nightly 抓 breaking |
| canonical 类型设计漏 case（如未来 audio block） | block union 类型可扩展，新加 block type 不破坏现有 adapter；adapter 默认 drop unknown block 不抛错 |
| deck_chats 表 canonical_content JSON 列体积膨胀 | block array 比纯字符串大 3-5 倍；监控；必要时压缩存储（gzip column） |
| frontend useAIChat 重写引入 regression | **不**用 feature flag 双轨（违反「不留技术债」原则）；改靠：Mock 单测覆盖 90/85 + smoke test + dogfood 期密集观察 + 单 git commit 可整体 revert |

## 12. 工作量估算

按 Phase 10.5 落地（6 天，含 spike）作为参考标尺：

- §4 canonical types + provider interface + 1 adapter（OpenAI 兼容复用）：1.5 天
- §5 schema 迁移 + 解密 / 加密层适配：1 天
- §6 Anthropic + Gemini adapter（含 stream translate）：3 天
- §7 前端 useAIChat 重写 + Settings UI：2 天
- §8 Mock 单测 + Smoke test 探测：1.5 天
- 联调 + dogfood + 修 bug：1.5 天

**合计 10.5 天**（含 buffer）。最大风险是中转协议探测结果——若不支持 native 则联调成本翻倍（需准备临时直连 key）。

## 13. 实施步骤大纲（详见 plan）

1. **探测 + 准备**：中转 native 协议探测；新增 SDK 依赖；锁版本
2. **canonical 类型 + interface**：types.ts + provider.ts + errors.ts
3. **OpenAI-兼容 adapter**：复用现有逻辑包装成新接口；翻译 to-openai / from-openai-stream
4. **canonical SSE wire**：encoder + decoder + 单测
5. **routes/llm.ts 改写**：透传 → canonical 路由
6. **schema 迁移**：新 shape + 加密 + 迁移脚本；老用户跑通
7. **Anthropic adapter**：to-anthropic / from-anthropic-stream + thinking + caching
8. **Gemini adapter**：to-gemini / from-gemini-stream + structured output
9. **前端 useAIChat 重写**：canonical event consumer + thinking UI + cache UI
10. **Settings UI 改造**：active provider 切换 + per-provider 配置 + advanced
11. **Mock 单测 + smoke**
12. **dogfood + 部署 + migration prod 跑**

---

**审阅 checklist**：

- [ ] 目标（§1）符合 Phase 12 roadmap 愿景
- [ ] 不做什么（§2）范围划分清晰
- [ ] 验收条件（§3）可验证、覆盖三家 + 切换 + 迁移 + 观测
- [ ] 工作量估算（§12）可接受

技术细节（§4-§11）实施期可微调，不重新 brainstorm。
