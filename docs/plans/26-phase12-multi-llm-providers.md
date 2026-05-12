# Phase 12 — 多 LLM Provider 原生接口 实施文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) 或 `superpowers:executing-plans` 来逐 Task 实施本 plan。步骤用 checkbox（`- [ ]`）追踪。
>
> **状态**：待启动
> **前置阶段**：[plan 25 Phase 10.5 — DeckRenderer + 锁语义归位](25-phase10.5-deck-renderer.md) ✅
> **后续阶段**：暂无
> **路线图**：[roadmap.md Phase 12](../requirements/roadmap.md)
> **设计 spec**：[2026-05-12-phase12-multi-llm-providers-design.md](../superpowers/specs/2026-05-12-phase12-multi-llm-providers-design.md)
> **执行子技能**：`superpowers:subagent-driven-development`（推荐，12 Task 体量适合 fresh agent per task）

**Goal**：把 LLM 调用从「OpenAI 兼容代理 only」升级到**三协议原生**（OpenAI 兼容族 / Anthropic Claude / Google Gemini），新增 `packages/agent/src/llm/` 抽象层，LLM 客户端逻辑从前端搬到后端，用 canonical event SSE wire format + inline block-based message shape 统一三家差异。用户可在前端 Settings 自由切换 active provider，老 LLM 配置自动迁移到新 schema 不丢。

**Architecture**：后端新建 `packages/agent/src/llm/` 目录，封装 LLMProvider interface + 3 个 adapter（OpenAI-兼容 5 家共享 + Anthropic 原生 + Gemini 原生）+ canonical 类型 + translate 层（messages 双向翻译 + stream 双向翻译）。前端 `useAIChat.ts` 重写 streaming 解析为 canonical event consumer（约 -500 行净减）。`deck_chats` 表加 `canonical_content` JSON 列，跨 provider 历史消息无损延续。

**Tech Stack**：`openai` SDK（已有，5 OpenAI-兼容 provider 共享）+ `@anthropic-ai/sdk`（新增）+ `@google/genai`（新增）；Hono 路由层；Drizzle ORM；AES-256-GCM 加密（沿用 `APIKEY_MASTER_KEY`）；canonical SSE wire format；vitest mock 单测 + warn-not-fail smoke test。

**预计工作量**：10.5 天（spec §12 估算）。

---

## 关键设计抉择（2026-05-12 与用户对齐）

> 设计期与用户拍板的非显然决策，每条带 "Why"。任务执行期发现 plan 的 bug 时直接修这里 + 加 prevent-regression 测试。

1. **LLM 客户端逻辑从 frontend 搬到 backend**：当前 `useAIChat.ts` 是 869 行 OpenAI SSE 客户端，agent 只是纯 HTTP 透传。三家 native SDK 都是 Node-only，且 API key 加密在 backend，抽象层必须在 backend。前端退化为 canonical event 消费者。
   - **Why**：Anthropic/Gemini 官方 SDK 用 Node-only features（streaming API、secrets handling），浏览器跑不起；放后端集中抽象避免三处协议解析。

2. **官方 per-provider SDK，不用 Vercel AI SDK**：用 `openai` + `@anthropic-ai/sdk` + `@google/genai`，放弃 Vercel AI SDK 类统一抽象。
   - **Why**：Vercel AI SDK 本身就是一层抽象，用它等于在我们抽象层下面再套一层；prompt caching / thinking blocks 等原生特性跟进永远滞后中间层。5 个 OpenAI-兼容 provider 共用一份 `openai` SDK + baseURL 切换，真正独立 adapter 只有 Anthropic + Gemini 两家。

3. **canonical event SSE wire format，不沿用 OpenAI delta**：自定义 8 类 event（`text.delta` / `tool_call.start|delta|end` / `thinking.delta` / `cache.hit` / `finish` / `error`）。
   - **Why**：OpenAI delta 形状装不下 Anthropic thinking blocks 和 cache hit metadata；硬塞 vendor extension 字段又脏又泄漏。canonical 让 thinking / cache 成为一等公民，三家 provider 都是单向翻译，零内部冲突。

4. **inline block-based message shape**：`content: Block[]` 而不是 `{content: string, tool_calls: [...]}`。
   - **Why**：thinking + text + tool_use 在 Claude 上**顺序敏感**（thinking 必须先于 text/tool_use），block 形式原生表达；多模态 image input 也是 block；未来 audio / 结构化输出全 block 化扩展。

5. **users.llm_settings 升级为扁平 active + 多 provider 字典**：`{ activeProvider, providers: { openai?, anthropic?, ... }, advanced? }`，而非两层 family/sub 嵌套。
   - **Why**：active 用 union 一个下拉就够，UI 心智简单；OpenAI-兼容族 SDK 共享是 backend 实现细节，不该泄漏到 schema。

6. **没有 feature flag 双轨切换**：frontend useAIChat 重写不保留旧路径开关。
   - **Why**：违反 CLAUDE.md「不留技术债」原则。改靠 Mock 单测 90/85 + smoke test + dogfood 期密集观察 + 单 git commit 整体 revert 兜底。

7. **MCP 工具命名 `mcp__<serverId>__<toolName>` 原封透传三家 provider**：三家 tool name regex 都允许 `[a-zA-Z0-9_-]{1,64}`。
   - **Why**：跨 provider 切换时 tool 调用结果应该完全可比；改名意味着同一逻辑工具在不同 provider 上身份不同，破坏统一性。

8. **`generate_slide_image` 工具不进 Phase 12 抽象**：image gen 仍走 `openai-image.ts` 独立单 provider 路径。
   - **Why**：用户实测 Gemini / Claude 出图质量都达不到 Lumideck 产品要求，仅 GPT 可用。未来质量提升再开 Phase 加 image-gen provider 抽象。（已存项目 memory `project_image-gen-provider-scope`）

9. **测试：Mock 单测主测 + 真 API smoke（warn-not-fail）**：mock 覆盖 90/85 per-file；smoke 进 `pnpm test:smoke` 单独 script，不进默认 `pnpm test`，连续 2 次 5xx 自动 skip。
   - **Why**：纯 mock 风险 SDK 漂移；VCR 录像维护成本高；smoke 兜底真实兼容性又不阻塞 CI。三家测试 key 不稳定，warn-not-fail 是硬需求。

10. **`ProviderRegistry.resolve(settings)` 而非 spec §4.1 的 `get(userId)`**：registry 设计为 pure function，**不**内部读 DB；调用方（routes/llm.ts）解密 + zod 校验完 settings 后传进来。
    - **Why**：解耦关注点——registry 只管「按 active id 构造 adapter 实例」，DB 访问 + 解密 + zod 校验是 route handler 的职责。这让 registry 完全可单测（不需要 mock DB），且未来加新 caller（如 batch 后台任务用不同 settings 来源）零成本。spec §4.1 描述的耦合形态是初稿，plan 落地时优化。

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不要动
- **本 Phase 引入新环境变量**：无新增。沿用 `APIKEY_MASTER_KEY`（已有，AES-GCM master key）+ provider per-user 加密 key（存 DB，不进 env）
- **smoke test key 通过 `packages/agent/.env.test.local` 注入**（gitignored），`.env.test.example` 加占位符（不带真 key）
- 三把测试 key（用户在 brainstorming 阶段提供，走 `duckcoding.ai` 中转）**不进 git 任何位置**——chat 历史也算泄漏面，Phase 12 跑完建议轮换
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/agent/src/llm/types.ts` | canonical 类型集（CanonicalMessage / Block / Event / ChatRequest / ToolDef） |
| `packages/agent/src/llm/provider.ts` | `LLMProvider` interface + `ProviderRegistry`（按 user.llm_settings.activeProvider 构造 adapter） |
| `packages/agent/src/llm/errors.ts` | `LLMError` 统一错误类型（code/provider/retryable/cause） |
| `packages/agent/src/llm/canonical-sse.ts` | canonical event SSE encoder（agent → frontend）+ decoder（test 用 + 共享给 frontend 通过 `@big-ppt/shared`） |
| `packages/agent/src/llm/adapters/openai-compatible.ts` | OpenAI SDK 适配器，5 OpenAI-兼容 provider 共享（构造时传 apiKey/baseURL/model） |
| `packages/agent/src/llm/adapters/anthropic.ts` | `@anthropic-ai/sdk` 适配器，支持 prompt caching + extended thinking |
| `packages/agent/src/llm/adapters/gemini.ts` | `@google/genai` 适配器，支持 structured output + long context |
| `packages/agent/src/llm/translate/to-openai.ts` | CanonicalMessage[] → OpenAI ChatCompletionMessageParam[] |
| `packages/agent/src/llm/translate/to-anthropic.ts` | CanonicalMessage[] → Anthropic MessageParam[] |
| `packages/agent/src/llm/translate/to-gemini.ts` | CanonicalMessage[] → Gemini Content[] |
| `packages/agent/src/llm/translate/from-openai-stream.ts` | OpenAI streaming chunk → AsyncIterable&lt;CanonicalEvent&gt; |
| `packages/agent/src/llm/translate/from-anthropic-stream.ts` | Anthropic streaming event → AsyncIterable&lt;CanonicalEvent&gt; |
| `packages/agent/src/llm/translate/from-gemini-stream.ts` | Gemini streaming chunk → AsyncIterable&lt;CanonicalEvent&gt; |
| `packages/agent/src/llm/__tests__/translate-*.test.ts` | 12 个 mock 单测文件（每 translate file 一个） |
| `packages/agent/src/llm/__tests__/smoke/openai.smoke.test.ts` | OpenAI-兼容 smoke（真 API，warn-not-fail） |
| `packages/agent/src/llm/__tests__/smoke/anthropic.smoke.test.ts` | Anthropic smoke |
| `packages/agent/src/llm/__tests__/smoke/gemini.smoke.test.ts` | Gemini smoke |
| `packages/agent/scripts/migrate-llm-settings.mjs` | 一次性迁移：老 `{provider, apiKey, ...}` → 新扁平 active+providers shape |
| `packages/agent/scripts/migrate-deck-chats.mjs` | 一次性迁移：旧 `{content, toolCallId}` row → 新 `canonical_content` JSON |
| `packages/agent/scripts/probe-duckcoding.mjs` | 中转协议探测：curl `/v1/messages` + `generateContent`，输出能否走 native |
| `packages/shared/src/llm-canonical.ts` | 暴露 canonical types（Block/Event/Message）给 creator 共享 |
| `docs/plans/26-phase12-multi-llm-providers.md` | 本文件 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/agent/package.json` | 新增 `@anthropic-ai/sdk` + `@google/genai` 锁版本依赖；新增 `migrate:llm-settings` / `migrate:deck-chats` / `probe:duckcoding` / `test:smoke` script |
| `packages/agent/src/routes/llm.ts` | 从「HTTP 透传」改成「接 canonical CanonicalChatRequest → ProviderRegistry.get(user) → 转发 canonical SSE」；删除 `PROVIDERS` 硬编（移到 `providerCatalog` 静态描述给前端）、`StoredLlmSettings` 类型（移到新 schema） |
| `packages/agent/src/db/schema.ts` | `users.llm_settings` 注释更新；`deck_chats` 加 `canonical_content` LONGTEXT 列（JSON 编码 Block[]，存 canonical message 全形） |
| `packages/agent/src/routes/decks.ts` | 写 deck_chats 路径都改为同时写新旧字段（向后兼容期），读优先 canonical_content fallback 旧 content |
| `packages/shared/src/index.ts` | export llm-canonical types |
| `packages/creator/src/composables/useAIChat.ts` | 重写 streaming 解析（约 -500 行）：删 OpenAI delta 累积逻辑；加 canonical event consumer + thinking UI state + cache UI state |
| `packages/creator/src/components/SettingsModal.vue` | 改造 LLM 设置区：active provider 下拉（7 选 1）+ per-provider config 折叠区 + advanced 子区（Anthropic / Gemini / common 参数） |
| `packages/creator/src/api/llm.ts` | 新增 canonical request body 类型 + fetch helper（如已有则改类型，否则新建） |
| `packages/agent/.env.test.example` | 加 OPENAI_TEST_KEY / ANTHROPIC_TEST_KEY / GEMINI_TEST_KEY 占位符 + DUCKCODING_TEST_BASE_URL（默认 https://www.duckcoding.ai） |
| `packages/agent/drizzle.config.ts` | 无改动（drizzle-kit push 自动同步新列） |
| `docs/requirements/roadmap.md` | Phase 12 状态从「待开始」改「进行中 → ✅ 已完成」（完成时改） |
| `CLAUDE.md` | 「LLM / Tool 工程」章节增补 canonical 抽象层说明（关闭 Phase 时） |

### 删除（关闭后清理，单独 commit）

| 文件 | 原因 |
| ---- | ---- |
| `packages/agent/src/routes/llm.ts` 的 `PROVIDERS` 常量 + `resolveUpstream` 函数 + `StoredLlmSettings` 类型 | 被 ProviderRegistry 取代 |
| `packages/creator/src/composables/useAIChat.ts` 中 OpenAI delta 累积逻辑（line ~196-330 区块） | 被 canonical event consumer 取代 |

---

## 数据模型变更

### `users.llm_settings` 字段（无 DDL 改动，仅 JSON shape 变化）

加密前 JSON 从

```ts
{ provider, apiKey, baseUrl?, model?, apiType? }
```

变为

```ts
{
  activeProvider: 'openai' | 'anthropic' | 'gemini' | 'zhipu' | 'deepseek' | 'moonshot' | 'qwen',
  providers: {
    [key]: { apiKey: string; model?: string; baseUrl?: string }
  },
  advanced?: {
    anthropic?: { promptCaching?: boolean; thinkingEnabled?: boolean; thinkingBudgetTokens?: number },
    gemini?:    { jsonMode?: boolean; longContextStrategy?: 'truncate' | 'segment' },
    common?:    { temperature?: number; maxTokens?: number; topP?: number; stopSequences?: string[] }
  }
}
```

加密 / 解密层不变。

### `deck_chats` 表新增 `canonical_content` 列

```ts
// packages/agent/src/db/schema.ts
export const deckChats = mysqlTable('deck_chats', {
  // ... 旧字段保留向后兼容期 ...
  content: mediumtext('content').notNull(),
  toolCallId: varchar('tool_call_id', { length: 128 }),
  // 新增
  canonicalContent: longtext('canonical_content'),  // 可空：迁移期老 row 没填
  // ...
})
```

`canonical_content` 存 `CanonicalMessage.content: Block[]` 的 JSON 序列化。旧 `content` + `toolCallId` 字段在迁移期保留，迁移脚本跑完后**当前 Phase 不删**（留下个 Phase 清理，减少回滚风险）。

迁移策略：`drizzle-kit push` 推 dev / test 库（开发期）；prod 部署时跑 `db:push:prod` + manual ssh 跑 `migrate-deck-chats.mjs` + `migrate-llm-settings.mjs`。

---

## 阶段拆分

每个 Task 一个 commit（除非 Task 说明里显式标多 commit）；每步绿测试 + 当步独立可回退。

### Task A：中转协议探测 + 依赖添加

**目的**：先搞清 `duckcoding.ai` 是否支持 Anthropic / Gemini native 协议端点，决定 smoke test 走 native 还是 fallback；同时把新 SDK 依赖装上。

**操作**：

1. 新建 `packages/agent/scripts/probe-duckcoding.mjs`，逻辑：

   ```js
   #!/usr/bin/env node
   // Usage: node scripts/probe-duckcoding.mjs
   // 读 ANTHROPIC_TEST_KEY / GEMINI_TEST_KEY / OPENAI_TEST_KEY + DUCKCODING_TEST_BASE_URL（默认 https://www.duckcoding.ai）
   // 三个端点 curl 一遍，输出 markdown 报告（stdout）

   const baseUrl = process.env.DUCKCODING_TEST_BASE_URL ?? 'https://www.duckcoding.ai'
   const anthropicKey = process.env.ANTHROPIC_TEST_KEY
   const geminiKey = process.env.GEMINI_TEST_KEY
   const openaiKey = process.env.OPENAI_TEST_KEY

   async function probe(name, fn) {
     try {
       const r = await fn()
       console.log(`- ${name}: ✅ ${r.status} ${r.statusText}`)
       if (r.body) console.log(`  body sample: ${(await r.text()).slice(0, 200)}`)
     } catch (e) {
       console.log(`- ${name}: ❌ ${e.message}`)
     }
   }

   await probe('OpenAI /v1/chat/completions', () =>
     fetch(`${baseUrl}/v1/chat/completions`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
       body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
     }))

   await probe('Anthropic /v1/messages', () =>
     fetch(`${baseUrl}/v1/messages`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
       body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
     }))

   await probe('Gemini /v1beta/models/gemini-2.5-flash:generateContent', () =>
     fetch(`${baseUrl}/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
     }))
   ```

2. 在 `packages/agent/.env.test.local`（用户运行时手动填）放三把 key。**不入 git**。
3. 跑探测：`pnpm -F @big-ppt/agent exec node scripts/probe-duckcoding.mjs`，**结果追加到本 plan「执行期偏离」章节**（不入 commit message，避免泄漏）。
4. 装 SDK：

   ```bash
   pnpm -F @big-ppt/agent add @anthropic-ai/sdk @google/genai
   ```

   **锁版本**：先看 `pnpm view @anthropic-ai/sdk versions` 找最新 stable major（注意 npm `latest` 可能是 beta，参考 plan 17 踩坑 6）；同理 `@google/genai`。在 package.json 用 `^x.y.z` 形式锁 minor。
5. `package.json` 加 scripts：

   ```json
   "probe:duckcoding": "dotenv -e .env.test.local -- node scripts/probe-duckcoding.mjs",
   "test:smoke": "dotenv -e .env.test.local -- vitest run --testNamePattern='smoke' src/llm/__tests__/smoke"
   ```

6. 写 `.env.test.example` 占位（不带真 key）：

   ```
   OPENAI_TEST_KEY=sk-placeholder
   ANTHROPIC_TEST_KEY=sk-placeholder
   GEMINI_TEST_KEY=sk-placeholder
   DUCKCODING_TEST_BASE_URL=https://www.duckcoding.ai
   ```

**验证方法**：

- `pnpm probe:duckcoding` 输出三行 ✅/❌ 标记
- `pnpm -F @big-ppt/agent type-check` 不报错（依赖加上但暂未使用）
- `git status` 确认 `.env.test.local` 不在 staged 列表

**风险**：

- 中转可能限速，连续 fail 不代表协议不支持——retry 一次再判
- SDK 大版本号可能跟 npm `latest` 指向 beta（plan 17 踩坑 6）：用 `pnpm view @anthropic-ai/sdk versions --json | tail -20` 看实际 stable 版本号

**Commit**：`feat(phase12-A): 中转协议探测脚本 + 新增 Anthropic/Google SDK 依赖`

---

### Task B：canonical 类型 + LLMProvider interface + errors

**目的**：搭抽象层骨架——所有类型 + interface + 错误层级定义清楚，后续 adapter / translate 都 import 这里。

**操作**：

1. 新建 `packages/agent/src/llm/types.ts`，完整搬入 spec §4.2 的类型定义：

   ```ts
   export type CanonicalRole = 'system' | 'user' | 'assistant' | 'tool'

   export type TextBlock = { type: 'text'; text: string }
   export type ImageBlock = { type: 'image'; mediaType: string; dataBase64: string }
   export type ThinkingBlock = { type: 'thinking'; text: string }
   export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
   export type ToolResultBlock = {
     type: 'tool_result'
     toolUseId: string
     content: string | Block[]
     isError?: boolean
   }
   export type Block = TextBlock | ImageBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

   export type CanonicalMessage = {
     role: CanonicalRole
     content: Block[]
     cacheControl?: { type: 'ephemeral' }
   }

   export type ToolDef = {
     name: string  // 'mcp__notion__searchPages' 等
     description: string
     inputSchema: Record<string, unknown>  // JSON Schema
   }

   export type CanonicalChatRequest = {
     messages: CanonicalMessage[]
     tools?: ToolDef[]
     temperature?: number
     maxTokens?: number
     topP?: number
     stopSequences?: string[]
     thinking?: { enabled: boolean; budgetTokens?: number }
     structuredOutput?: { schema: Record<string, unknown> }
   }

   export type TokenUsage = { input: number; output: number; cached?: number }
   export type FinishReason = 'stop' | 'length' | 'tool_use' | 'content_filter'

   export type CanonicalEvent =
     | { type: 'text.delta'; text: string }
     | { type: 'tool_call.start'; id: string; name: string }
     | { type: 'tool_call.delta'; id: string; argsChunk: string }
     | { type: 'tool_call.end'; id: string }
     | { type: 'thinking.delta'; text: string }
     | { type: 'cache.hit'; cachedTokens: number; costTokens: number }
     | { type: 'finish'; reason: FinishReason; usage: TokenUsage }
     | { type: 'error'; code: string; message: string }
   ```

2. 新建 `packages/agent/src/llm/errors.ts`：

   ```ts
   export type LLMErrorCode =
     | 'rate_limit'
     | 'auth'
     | 'network'
     | 'invalid_request'
     | 'context_too_long'
     | 'unknown'

   export class LLMError extends Error {
     constructor(
       message: string,
       readonly code: LLMErrorCode,
       readonly provider: string,
       readonly retryable: boolean,
       readonly cause?: unknown,
     ) {
       super(message)
       this.name = 'LLMError'
     }
   }
   ```

3. 新建 `packages/agent/src/llm/provider.ts`：

   ```ts
   import type { CanonicalChatRequest, CanonicalEvent } from './types.js'
   import type { LlmSettings } from './settings.js'  // 见 Task F

   export type ProviderFamily = 'openai-compatible' | 'anthropic' | 'gemini'

   export interface LLMProvider {
     readonly id: string
     readonly family: ProviderFamily
     streamChat(req: CanonicalChatRequest, signal: AbortSignal): AsyncIterable<CanonicalEvent>
     listModels?(): Promise<Array<{ id: string; description?: string }>>
   }

   /** 工厂：根据用户 settings 构造 provider 实例。在 Task C/G/H 完成 adapter 后逐步填充。 */
   export class ProviderRegistry {
     constructor(private readonly factories: Map<string, (cfg: ProviderConfig) => LLMProvider>) {}

     resolve(settings: LlmSettings): LLMProvider {
       const id = settings.activeProvider
       const cfg = settings.providers[id]
       if (!cfg) throw new Error(`active provider "${id}" 未配置 apiKey`)
       const factory = this.factories.get(id)
       if (!factory) throw new Error(`provider "${id}" adapter 未注册`)
       return factory({ id, apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl, advanced: settings.advanced })
     }
   }

   export type ProviderConfig = {
     id: string
     apiKey: string
     model?: string
     baseUrl?: string
     advanced?: LlmSettings['advanced']
   }
   ```

4. 把 `packages/shared/src/llm-canonical.ts` 创建出来 re-export types（让 creator 共享）：

   ```ts
   export type {
     Block,
     TextBlock,
     ImageBlock,
     ThinkingBlock,
     ToolUseBlock,
     ToolResultBlock,
     CanonicalMessage,
     CanonicalRole,
     CanonicalChatRequest,
     CanonicalEvent,
     TokenUsage,
     FinishReason,
     ToolDef,
   } from '../../agent/src/llm/types.js'
   ```

   注意：因 shared 包是源码直 import 不打包（CLAUDE.md「关键模块（agent）」节），可以跨包 import；但若 type-check 报错，改成 shared 自己定义一份并 agent re-export。退化方案见风险。

5. `packages/shared/src/index.ts` 加 `export * from './llm-canonical.js'`。

6. 加 4 个单测文件 `packages/agent/src/llm/__tests__/types.test.ts` + `errors.test.ts` + `provider.test.ts` + `shared-reexport.test.ts`：

   - types 单测：用 `expectTypeOf` 验 union exhaustive（switch case 编译期覆盖）
   - errors 单测：构造 + readonly 字段访问 + cause 透传
   - provider 单测：注册 fake factory + resolve 正确 / 未注册抛错 / 缺 apiKey 抛错
   - shared 单测：import canonical type 链路通

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run src/llm/__tests__/` 全绿
- `pnpm -F @big-ppt/agent type-check` 不报错
- `pnpm -F @big-ppt/shared type-check` 不报错

**风险**：

- shared 跨包 import agent 源码可能因 tsconfig path / module resolution 报错。退化：shared 自己定义一份 canonical types，agent 重新 export 而非 re-define（避免双源）。决策时机：第一次 type-check 失败时切方案。

**Commit**：`feat(phase12-B): canonical 类型 + LLMProvider interface + LLMError 错误层级`

---

### Task C：OpenAI-兼容 adapter + translate 层

**目的**：第一个 adapter 落地，路径最熟悉（沿用当前 OpenAI SDK 风格）；同时把 to-openai / from-openai-stream translate 双层做完，跑通单测。

**操作**：

1. 新建 `packages/agent/src/llm/translate/to-openai.ts`：把 `CanonicalMessage[]` flatten 成 OpenAI `ChatCompletionMessageParam[]`：

   ```ts
   import OpenAI from 'openai'
   import type { CanonicalMessage, Block, ToolDef } from '../types.js'

   export function toOpenAIMessages(messages: CanonicalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
     return messages.flatMap(translateMessage)
   }

   function translateMessage(msg: CanonicalMessage): OpenAI.Chat.ChatCompletionMessageParam[] {
     // assistant: 把 text blocks 拼成 content string, tool_use blocks 提到 tool_calls
     // user: text + image 走 content array (OpenAI 多模态格式), 不混 tool_result
     // tool: tool_result blocks 拆成多条 role:'tool' message
     // system: text only, 拼接
     // thinking blocks 在 to-openai 里 drop（OpenAI 没有 thinking 概念）
     // ... 完整实现见单测 fixture
   }

   export function toOpenAITools(tools: ToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
     return tools.map(t => ({
       type: 'function',
       function: { name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> },
     }))
   }
   ```

2. 新建 `packages/agent/src/llm/translate/from-openai-stream.ts`：把 OpenAI streaming response（`AsyncIterable<ChatCompletionChunk>`）翻译成 `AsyncIterable<CanonicalEvent>`：

   ```ts
   import OpenAI from 'openai'
   import type { CanonicalEvent } from '../types.js'

   export async function* fromOpenAIStream(
     stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
   ): AsyncGenerator<CanonicalEvent> {
     // 状态机：累积 tool_calls[index] → 同 index 第一次出现 emit tool_call.start, 后续 args fragment emit tool_call.delta, finish_reason 时 emit tool_call.end
     // 普通 delta.content emit text.delta
     // 结束 emit finish event
     // 处理 usage（如果开启 stream_options.include_usage）emit usage in finish
   }
   ```

3. 新建 `packages/agent/src/llm/adapters/openai-compatible.ts`：

   ```ts
   import OpenAI from 'openai'
   import type { LLMProvider, ProviderConfig } from '../provider.js'
   import type { CanonicalChatRequest, CanonicalEvent } from '../types.js'
   import { toOpenAIMessages, toOpenAITools } from '../translate/to-openai.js'
   import { fromOpenAIStream } from '../translate/from-openai-stream.js'
   import { LLMError } from '../errors.js'

   const DEFAULT_BASE_URLS: Record<string, string> = {
     openai: 'https://api.openai.com/v1',
     zhipu: 'https://open.bigmodel.cn/api/paas/v4',
     deepseek: 'https://api.deepseek.com/v1',
     moonshot: 'https://api.moonshot.cn/v1',
     qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
   }

   const DEFAULT_MODELS: Record<string, string> = {
     openai: 'gpt-4o',
     zhipu: 'GLM-5.1',
     deepseek: 'deepseek-chat',
     moonshot: 'moonshot-v1-8k',
     qwen: 'qwen-plus',
   }

   export function createOpenAICompatibleProvider(cfg: ProviderConfig): LLMProvider {
     const baseURL = cfg.baseUrl ?? DEFAULT_BASE_URLS[cfg.id] ?? DEFAULT_BASE_URLS.openai
     const model = cfg.model ?? DEFAULT_MODELS[cfg.id] ?? 'gpt-4o'
     const client = new OpenAI({ apiKey: cfg.apiKey, baseURL })
     return {
       id: cfg.id,
       family: 'openai-compatible',
       async *streamChat(req: CanonicalChatRequest, signal: AbortSignal) {
         try {
           const stream = await client.chat.completions.create({
             model,
             stream: true,
             stream_options: { include_usage: true },
             messages: toOpenAIMessages(req.messages),
             tools: req.tools ? toOpenAITools(req.tools) : undefined,
             temperature: req.temperature,
             max_tokens: req.maxTokens,
             top_p: req.topP,
             stop: req.stopSequences,
           }, { signal })
           yield* fromOpenAIStream(stream)
         } catch (e) {
           throw translateOpenAIError(e, cfg.id)
         }
       },
     }
   }

   function translateOpenAIError(e: unknown, providerId: string): LLMError {
     // OpenAI SDK 抛 APIError / RateLimitError 等；按 status 翻译成 LLMError code
     // 详细映射见单测
   }
   ```

4. 单测 fixtures：录三家 OpenAI-兼容 provider 的真 streaming response chunk 序列（手工构造 JSON，参考 OpenAI cookbook），存 `__tests__/fixtures/openai-stream-*.json`。
5. 单测：
   - `translate-to-openai.test.ts`：覆盖 5 种 block 类型翻译，含多模态 image / tool_result 拆分
   - `translate-from-openai-stream.test.ts`：覆盖单 text、单 tool_call、多 tool_call 并发、含 usage 的 finish
   - `adapter-openai-compatible.test.ts`：mock `OpenAI` SDK，验 streamChat 走通 + error 翻译

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run src/llm/__tests__/translate-to-openai.test.ts src/llm/__tests__/translate-from-openai-stream.test.ts src/llm/__tests__/adapter-openai-compatible.test.ts` 全绿
- 覆盖率：`pnpm -F @big-ppt/agent test:coverage --reporter=text` 看 `src/llm/translate/to-openai.ts` / `from-openai-stream.ts` / `adapters/openai-compatible.ts` 三个文件均 ≥ 90/85 per-file

**风险**：

- OpenAI tool_calls streaming 协议有「fragment by index」复杂性（同 tool call 的 arguments JSON 字符串按多个 chunk fragment 拼装），状态机要正确按 index 累积——这正是 `useAIChat.ts` 现有逻辑搬到 backend 的核心，可以参考现有代码 (line 271-321) 但用 async generator 重写
- OpenAI v6 SDK 的 `.create({ stream: true })` 返回类型是 `Stream<ChatCompletionChunk>`，不是直接 async iterable，可能要 `for await` 包一层

**Commit**：`feat(phase12-C): OpenAI-兼容 provider adapter + to-openai/from-openai-stream translate + 单测`

---

### Task D：canonical SSE wire encoder + decoder

**目的**：定义 agent → frontend 的 wire format（SSE 编码 canonical event）+ decoder（让 frontend 反向消费）。

**操作**：

1. 新建 `packages/agent/src/llm/canonical-sse.ts`：

   ```ts
   import type { CanonicalEvent } from './types.js'

   /** agent 端用：单个 event 编码为 SSE frame（event: type\ndata: json\n\n） */
   export function encodeSSEFrame(evt: CanonicalEvent): string {
     return `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`
   }

   /** agent 端用：把 AsyncIterable<CanonicalEvent> 转成 ReadableStream<Uint8Array>，供 Hono response */
   export function eventsToSSEStream(events: AsyncIterable<CanonicalEvent>): ReadableStream<Uint8Array> {
     const encoder = new TextEncoder()
     return new ReadableStream({
       async start(controller) {
         try {
           for await (const evt of events) {
             controller.enqueue(encoder.encode(encodeSSEFrame(evt)))
           }
           controller.close()
         } catch (e) {
           const errEvt: CanonicalEvent = { type: 'error', code: 'unknown', message: (e as Error).message }
           controller.enqueue(encoder.encode(encodeSSEFrame(errEvt)))
           controller.close()
         }
       },
     })
   }

   /** frontend / test 端用：ReadableStream<Uint8Array> 解析回 AsyncIterable<CanonicalEvent>。 */
   export async function* decodeSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<CanonicalEvent> {
     const reader = stream.getReader()
     const decoder = new TextDecoder()
     let buf = ''
     while (true) {
       const { done, value } = await reader.read()
       if (done) break
       buf += decoder.decode(value, { stream: true })
       // 按 \n\n 切 frame
       let idx
       while ((idx = buf.indexOf('\n\n')) !== -1) {
         const frame = buf.slice(0, idx)
         buf = buf.slice(idx + 2)
         const evt = parseSSEFrame(frame)
         if (evt) yield evt
       }
     }
   }

   function parseSSEFrame(frame: string): CanonicalEvent | null {
     const eventLine = frame.split('\n').find(l => l.startsWith('event: '))
     const dataLine = frame.split('\n').find(l => l.startsWith('data: '))
     if (!eventLine || !dataLine) return null
     return JSON.parse(dataLine.slice('data: '.length)) as CanonicalEvent
   }
   ```

2. 把 `canonical-sse.ts` 通过 shared re-export 给 creator（让 frontend 直接 import decoder）：

   ```ts
   // packages/shared/src/llm-canonical.ts 加：
   export { decodeSSEStream } from '../../agent/src/llm/canonical-sse.js'
   ```

   若跨包 import .ts 报错，shared 自己复制一份 decoder（encoder 留 agent 独占）。

3. 单测 `canonical-sse.test.ts`：

   - encode → decode round-trip 所有 8 类 event
   - 多 event 拼一个 stream → decode 出原序列
   - 中途异常 → emit error event + 关闭流
   - 半 frame 边界（chunk 切在 `data:` 中间）正常解析

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run src/llm/__tests__/canonical-sse.test.ts` 全绿
- 覆盖率 `canonical-sse.ts` ≥ 90/85 per-file

**Commit**：`feat(phase12-D): canonical event SSE encoder + decoder + round-trip 单测`

---

### Task E：routes/llm.ts 改写（透传 → canonical 路由）

**目的**：把后端 LLM 路由从「HTTP body 透传」改成「接 canonical request → ProviderRegistry → SSE 转发 canonical event」。**先只接 OpenAI-兼容族**（Task C 已落地），Anthropic / Gemini 在 Task G/H 注册到 registry。

**操作**：

1. 改写 `packages/agent/src/routes/llm.ts`：

   ```ts
   import { Hono } from 'hono'
   import type { AuthVars } from '../middleware/auth.js'
   import { decryptApiKey } from '../crypto/apikey.js'
   import { acquireLlmSlot, LlmConcurrencyTimeoutError } from '../middleware/llm-semaphore.js'
   import { ProviderRegistry } from '../llm/provider.js'
   import { createOpenAICompatibleProvider } from '../llm/adapters/openai-compatible.js'
   import { eventsToSSEStream } from '../llm/canonical-sse.js'
   import { LLMError } from '../llm/errors.js'
   import { parseLlmSettings } from '../llm/settings.js'  // Task F 创建
   import { logServerEvent } from '../logger/server-log.js'
   import type { CanonicalChatRequest } from '../llm/types.js'

   const registry = new ProviderRegistry(
     new Map([
       ['openai', createOpenAICompatibleProvider],
       ['zhipu', createOpenAICompatibleProvider],
       ['deepseek', createOpenAICompatibleProvider],
       ['moonshot', createOpenAICompatibleProvider],
       ['qwen', createOpenAICompatibleProvider],
       // anthropic / gemini 在 Task G/H 注册
     ]),
   )

   export const llm = new Hono<{ Variables: AuthVars }>()

   llm.post('/chat/completions', async (c) => {
     const user = c.get('user')
     if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)
     if (!user.llmSettings) return c.json({ error: { message: '请先在设置中配置 LLM API Key' } }, 400)

     let settings
     try {
       settings = parseLlmSettings(JSON.parse(decryptApiKey(user.llmSettings)))
     } catch (e) {
       return c.json({ error: { message: `LLM 配置解密 / 解析失败：${(e as Error).message}` } }, 500)
     }

     let provider
     try {
       provider = registry.resolve(settings)
     } catch (e) {
       return c.json({ error: { message: (e as Error).message } }, 400)
     }

     const req = (await c.req.json()) as CanonicalChatRequest

     let release: () => void
     try {
       release = await acquireLlmSlot(user.id)
     } catch (e) {
       if (e instanceof LlmConcurrencyTimeoutError) return c.json({ error: { message: e.message } }, 503)
       throw e
     }

     const clientSignal = c.req.raw.signal
     const events = (async function* () {
       try {
         yield* provider.streamChat(req, clientSignal)
       } catch (e) {
         logServerEvent({ category: 'llm', event: 'request-failed', userId: user.id, provider: provider.id, code: e instanceof LLMError ? e.code : 'unknown', errorMsg: (e as Error).message })
         throw e
       } finally {
         release()
       }
     })()

     const stream = eventsToSSEStream(events)
     return new Response(stream, {
       status: 200,
       headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
     })
   })
   ```

2. **保留 `parseLlmSettings`** 函数（在 Task F 完整定义；本 Task 先 stub 出来直接 `return raw as LlmSettings` + TODO 注释）。
3. 删除旧 `PROVIDERS` 常量 + `resolveUpstream` + `StoredLlmSettings` 类型——commit 在本 Task 一起做。
4. 集成测 `packages/agent/test/integration/llm-route.test.ts`：

   - 用 `app.fetch(req)` shim，发 canonical request body，断言 SSE response 含预期 event 序列
   - mock `ProviderRegistry`：注入 fake provider 返回固定 event 序列，验中转 + acquireLlmSlot + abort signal 透传
   - 覆盖：未登录 401 / 未配置 400 / abort 后释放 slot / LLMError 转 SSE error event

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run test/integration/llm-route.test.ts` 全绿
- `pnpm -F @big-ppt/agent test` 全绿（不破坏其他集成测）
- 手工浏览器：临时把 frontend `useAIChat.ts` 改成发 canonical body 也能跑通一轮（不 commit，仅本地验证）

**风险**：

- frontend 还没改，本 Task 后线上是「frontend OpenAI delta body → backend 解析为 canonical 报错」。**所以 Task E 不能上 main 跑产线，必须跟 Task I（前端重写）连续合并**。本 plan 排序保证 E → I 在同一周期内连续 commit；用户 dogfood 在 Task I 后开始。
- Hono SSE response 在 Node http 下要确认 chunked transfer / 不 buffer（已 set `X-Accel-Buffering: no`）

**Commit**：`feat(phase12-E): routes/llm.ts 改写为 canonical 路由（OpenAI-兼容族先接通）+ 集成测`

---

### Task F：users.llm_settings + deck_chats schema 迁移

**目的**：把 settings JSON 升级到新 shape；deck_chats 加 canonical_content 列；写双向迁移脚本；老用户跑通。

**操作**：

1. 新建 `packages/agent/src/llm/settings.ts`：

   ```ts
   import { z } from 'zod'

   export const ProviderConfigSchema = z.object({
     apiKey: z.string().min(1),
     model: z.string().optional(),
     baseUrl: z.string().url().optional(),
   })

   export const LlmSettingsSchema = z.object({
     activeProvider: z.enum(['openai', 'anthropic', 'gemini', 'zhipu', 'deepseek', 'moonshot', 'qwen']),
     providers: z.object({
       openai:    ProviderConfigSchema.optional(),
       anthropic: ProviderConfigSchema.optional(),
       gemini:    ProviderConfigSchema.optional(),
       zhipu:     ProviderConfigSchema.optional(),
       deepseek:  ProviderConfigSchema.optional(),
       moonshot:  ProviderConfigSchema.optional(),
       qwen:      ProviderConfigSchema.optional(),
     }),
     advanced: z.object({
       anthropic: z.object({
         promptCaching: z.boolean().optional(),
         thinkingEnabled: z.boolean().optional(),
         thinkingBudgetTokens: z.number().int().positive().optional(),
       }).optional(),
       gemini: z.object({
         jsonMode: z.boolean().optional(),
         longContextStrategy: z.enum(['truncate', 'segment']).optional(),
       }).optional(),
       common: z.object({
         temperature: z.number().min(0).max(2).optional(),
         maxTokens: z.number().int().positive().optional(),
         topP: z.number().min(0).max(1).optional(),
         stopSequences: z.array(z.string()).optional(),
       }).optional(),
     }).optional(),
   })

   export type LlmSettings = z.infer<typeof LlmSettingsSchema>

   /** 解密后的 JSON 走 zod 校验。失败时抛错让 route 返 500。 */
   export function parseLlmSettings(raw: unknown): LlmSettings {
     return LlmSettingsSchema.parse(raw)
   }

   /** 老 shape → 新 shape 迁移（迁移脚本 + 兼容期老用户首次访问触发用）。 */
   export function migrateLegacySettings(legacy: { provider: string; apiKey: string; baseUrl?: string; model?: string }): LlmSettings {
     return {
       activeProvider: legacy.provider as LlmSettings['activeProvider'],
       providers: {
         [legacy.provider]: { apiKey: legacy.apiKey, baseUrl: legacy.baseUrl, model: legacy.model },
       },
     }
   }
   ```

2. 改 `packages/agent/src/db/schema.ts`：deckChats 加 `canonicalContent: longtext('canonical_content')` 列。
3. 跑 `pnpm -F @big-ppt/agent db:push` + `db:push:test`，确认列加上。
4. 改 `packages/agent/src/routes/decks.ts` 写 deck_chats 路径：同时写 `content`（旧字段，存 canonical 的 text block flatten 字符串 fallback）+ `canonicalContent`（JSON）；读路径优先 `canonicalContent`，缺则解析旧 `content` + `toolCallId` 重组成 Block[]。详细 helper 在新 `packages/agent/src/llm/chat-row.ts`：

   ```ts
   import type { CanonicalMessage, Block } from './types.js'

   export function rowToCanonical(row: { role: string; content: string; toolCallId: string | null; canonicalContent: string | null }): CanonicalMessage {
     if (row.canonicalContent) {
       return { role: row.role as CanonicalMessage['role'], content: JSON.parse(row.canonicalContent) as Block[] }
     }
     // legacy fallback
     return legacyRowToCanonical(row)
   }

   export function canonicalToRow(msg: CanonicalMessage): { content: string; toolCallId: string | null; canonicalContent: string } {
     return {
       content: flattenTextBlocks(msg.content),
       toolCallId: extractToolCallId(msg),
       canonicalContent: JSON.stringify(msg.content),
     }
   }
   ```

5. 新建 `packages/agent/scripts/migrate-llm-settings.mjs`：

   - 连 DB，遍历 users
   - 解密旧 settings → zod 校验（如已是新 shape 跳过）→ 老 shape 跑 `migrateLegacySettings` → 重新加密写回
   - 失败用户列名单 + console.error，不阻塞其他

6. 新建 `packages/agent/scripts/migrate-deck-chats.mjs`：

   - 遍历 `deck_chats` where `canonical_content IS NULL`
   - 用 `legacyRowToCanonical` 转 + 写回 canonical_content
   - 批量 100 row 一 transaction

7. `package.json` 加 scripts：

   ```json
   "migrate:llm-settings": "dotenv -e .env.development.local -- node scripts/migrate-llm-settings.mjs",
   "migrate:llm-settings:test": "dotenv -e .env.test.local -- node scripts/migrate-llm-settings.mjs",
   "migrate:llm-settings:prod": "dotenv -e .env.production.local -- node scripts/migrate-llm-settings.mjs",
   "migrate:deck-chats": "dotenv -e .env.development.local -- node scripts/migrate-deck-chats.mjs",
   "migrate:deck-chats:test": "dotenv -e .env.test.local -- node scripts/migrate-deck-chats.mjs",
   "migrate:deck-chats:prod": "dotenv -e .env.production.local -- node scripts/migrate-deck-chats.mjs"
   ```

8. 单测：
   - `settings.test.ts`：zod 校验 + migrateLegacySettings + 错误 case
   - `chat-row.test.ts`：rowToCanonical 双路径（含 canonical / 仅 legacy）+ canonicalToRow round-trip
   - `scripts/migrate-llm-settings.test.ts`：用真 lumideck_test DB 跑全链路（插入老 row → 跑 migrate → 读出新 shape 校验）
   - `scripts/migrate-deck-chats.test.ts`：同上

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run src/llm/__tests__/settings.test.ts src/llm/__tests__/chat-row.test.ts test/scripts/migrate-*.test.ts` 全绿
- 本地 dev：手工 INSERT 一条老格式 user + 跑 `pnpm migrate:llm-settings`，验数据库改成新 shape
- coverage：settings.ts / chat-row.ts ≥ 90/85

**风险**：

- decks.ts 读路径有多处（chat history、新增 chat、tool result 入库），grep 所有 `deckChats` 调用确保都改双写
- legacy fallback 解析有边角 case（assistant.tool_calls JSON 串、tool message 的 tool_call_id 拼接），fixture 必须覆盖至少 3 类历史 row 形态

**Commit**：`feat(phase12-F): users.llm_settings + deck_chats schema 迁移 + 双向 helper + 一次性迁移脚本`

---

### Task G：Anthropic adapter（含 prompt caching + extended thinking）

**目的**：Anthropic 原生 adapter 落地——这是 Phase 12 核心价值点（prompt caching + thinking 是 OpenAI 兼容代理拿不到的）。

**操作**：

1. 新建 `packages/agent/src/llm/translate/to-anthropic.ts`：

   ```ts
   import Anthropic from '@anthropic-ai/sdk'
   import type { CanonicalMessage, ToolDef } from '../types.js'

   /** 把 canonical messages 分成 system 字符串（首条 role:'system'）+ Anthropic messages 数组 */
   export function toAnthropicInput(messages: CanonicalMessage[]): {
     system?: Anthropic.MessageCreateParams['system']
     messages: Anthropic.MessageParam[]
   } {
     // system: 第一条 system msg 的 text blocks 拼成字符串（可带 cache_control）
     // 其他: user/assistant/tool 翻译
     //   - user: content blocks 直接对应 Anthropic content blocks，tool_result block 翻译为 { type: 'tool_result', tool_use_id, content }
     //   - assistant: 同上，含 text / tool_use / thinking blocks
     //   - tool: 在 Anthropic 协议里要并入 user message 的 content[]（tool_result 是 user role 下的）→ 在这里合并
     // cacheControl 标记：messages 上的 cacheControl 翻译为 content block 的 cache_control: { type: 'ephemeral' }（标在 block 上）
   }

   export function toAnthropicTools(tools: ToolDef[]): Anthropic.Tool[] {
     return tools.map(t => ({
       name: t.name,
       description: t.description,
       input_schema: sanitizeForAnthropic(t.inputSchema) as Anthropic.Tool['input_schema'],
     }))
   }

   /** 去除 Anthropic 不支持的 oneOf / allOf 字段，warning to logger */
   function sanitizeForAnthropic(schema: Record<string, unknown>): Record<string, unknown> {
     // 递归遍历 schema tree, drop 'oneOf'/'allOf'/'not'/'$ref', warn 每次 drop
   }
   ```

2. 新建 `packages/agent/src/llm/translate/from-anthropic-stream.ts`：

   - Anthropic streaming events: `message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`
   - state machine: content_block_start with type='text' → 后续 text_delta emit text.delta; type='thinking' → emit thinking.delta; type='tool_use' → emit tool_call.start, 后续 input_json_delta emit tool_call.delta, stop emit tool_call.end
   - message_start.usage.cache_read_input_tokens / cache_creation_input_tokens → emit cache.hit event
   - message_stop → emit finish

3. 新建 `packages/agent/src/llm/adapters/anthropic.ts`：

   ```ts
   import Anthropic from '@anthropic-ai/sdk'
   import type { LLMProvider, ProviderConfig } from '../provider.js'
   import { toAnthropicInput, toAnthropicTools } from '../translate/to-anthropic.js'
   import { fromAnthropicStream } from '../translate/from-anthropic-stream.js'

   export function createAnthropicProvider(cfg: ProviderConfig): LLMProvider {
     const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl })
     const model = cfg.model ?? 'claude-sonnet-4-5'
     return {
       id: 'anthropic',
       family: 'anthropic',
       async *streamChat(req, signal) {
         const { system, messages } = toAnthropicInput(req.messages)
         const stream = await client.messages.stream({
           model,
           max_tokens: req.maxTokens ?? 8192,
           system,
           messages,
           tools: req.tools ? toAnthropicTools(req.tools) : undefined,
           temperature: req.temperature,
           top_p: req.topP,
           stop_sequences: req.stopSequences,
           ...(req.thinking?.enabled ? { thinking: { type: 'enabled', budget_tokens: req.thinking.budgetTokens ?? 5000 } } : {}),
         }, { signal })
         yield* fromAnthropicStream(stream)
       },
     }
   }
   ```

4. 在 `routes/llm.ts` 的 `ProviderRegistry` 注册：

   ```ts
   ['anthropic', createAnthropicProvider],
   ```

5. 单测：
   - `translate-to-anthropic.test.ts`：系统 split / tool_result merge to user / cache_control 标记 / thinking block / schema sanitization
   - `translate-from-anthropic-stream.test.ts`：fixture 复用真 Anthropic streaming format JSON 序列，验 cache.hit 事件 + thinking.delta + tool_call 三类
   - `adapter-anthropic.test.ts`：mock SDK，验 streamChat / error 翻译

6. fixture: `__tests__/fixtures/anthropic-stream-*.json`，3-4 个录的真序列（无 thinking / 有 thinking / 含 tool_use / 含 cache_read_input_tokens）

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run src/llm/__tests__/translate-to-anthropic.test.ts src/llm/__tests__/translate-from-anthropic-stream.test.ts src/llm/__tests__/adapter-anthropic.test.ts` 全绿
- coverage：to-anthropic.ts / from-anthropic-stream.ts / adapter-anthropic.ts ≥ 90/85 per-file

**风险**：

- Anthropic SDK `client.messages.stream` 返回 `MessageStream` 对象，`for await` 迭代它产出 raw event；要兼容 SDK 版本差异看 API doc
- prompt caching 的 `cache_control` 字段加在哪一层（system message 块上 / 历史消息块上）规则：每个被标 cacheControl 的 canonical message，翻译时给其最后一个 content block 加 `cache_control: { type: 'ephemeral' }`（这是 Anthropic 缓存粒度）
- extended thinking 跟 tools 同时启用时有约束（thinking 必须在 tool_use 前出现），翻译层要保证 block 顺序

**Commit**：`feat(phase12-G): Anthropic 原生 adapter + prompt caching + extended thinking + 单测`

---

### Task H：Gemini adapter（含 structured output + long context）

**目的**：Gemini 原生 adapter 落地。重点是 Gemini 的 `parts` 数组形式 + functionCall 翻译 + structured output（response schema）。

**操作**：

1. 新建 `packages/agent/src/llm/translate/to-gemini.ts`：

   ```ts
   import type { GoogleGenAI } from '@google/genai'
   import type { CanonicalMessage, ToolDef } from '../types.js'

   /** Gemini 没有独立 system role；系统消息走 systemInstruction 字段，其他走 contents */
   export function toGeminiInput(messages: CanonicalMessage[]): {
     systemInstruction?: Content
     contents: Content[]
   } {
     // 第一条 system → systemInstruction: { parts: [{ text: ... }] }
     // user/assistant 翻译为 contents 数组，role 用 'user' / 'model'（Gemini 用 model 不是 assistant）
     // tool_use blocks 翻译为 { functionCall: { name, args } }
     // tool_result blocks 翻译为 user role 下的 { functionResponse: { name, response } }
     // image block → { inlineData: { mimeType, data } }
     // thinking blocks: Gemini 当前 SDK 不显式支持思考输出 → drop（warning）
   }

   export function toGeminiTools(tools: ToolDef[]): Tool[] {
     return [{
       functionDeclarations: tools.map(t => ({
         name: t.name,
         description: t.description,
         parameters: sanitizeForGemini(t.inputSchema) as FunctionDeclaration['parameters'],
       })),
     }]
   }

   /** 去除 Gemini 不支持的字段（additionalProperties / $ref / oneOf），warning */
   function sanitizeForGemini(schema: Record<string, unknown>): Record<string, unknown> {...}
   ```

2. 新建 `packages/agent/src/llm/translate/from-gemini-stream.ts`：

   - Gemini streaming chunk format: `{ candidates: [{ content: { parts: [...] }, finishReason?, ... }], usageMetadata?: {...} }`
   - 每个 chunk 的 parts 数组遍历 → text 部分累积 emit text.delta，functionCall 部分按 name+args 完整出现 emit tool_call.start + tool_call.delta（args JSON 一次性，没有 fragment） + tool_call.end
   - usageMetadata.candidatesTokenCount / promptTokenCount → finish event 的 usage

3. 新建 `packages/agent/src/llm/adapters/gemini.ts`:

   ```ts
   import { GoogleGenAI } from '@google/genai'

   export function createGeminiProvider(cfg) {
     const client = new GoogleGenAI({ apiKey: cfg.apiKey, ...(cfg.baseUrl ? { httpOptions: { baseUrl: cfg.baseUrl } } : {}) })
     const model = cfg.model ?? 'gemini-2.5-flash'
     return {
       id: 'gemini',
       family: 'gemini',
       async *streamChat(req, signal) {
         const { systemInstruction, contents } = toGeminiInput(req.messages)
         const stream = await client.models.generateContentStream({
           model,
           contents,
           config: {
             systemInstruction,
             tools: req.tools ? toGeminiTools(req.tools) : undefined,
             temperature: req.temperature,
             maxOutputTokens: req.maxTokens,
             topP: req.topP,
             stopSequences: req.stopSequences,
             ...(req.structuredOutput ? { responseMimeType: 'application/json', responseSchema: req.structuredOutput.schema } : {}),
           },
           // signal 透传方式视 SDK 版本，可能要用 AbortController 包一层
         })
         yield* fromGeminiStream(stream)
       },
     }
   }
   ```

4. 在 `routes/llm.ts` 注册 Gemini provider。
5. 单测同 Task G 结构（translate-to / translate-from-stream / adapter 三个 test file + fixtures）。

**验证方法**：

- `pnpm -F @big-ppt/agent vitest run src/llm/__tests__/translate-to-gemini.test.ts src/llm/__tests__/translate-from-gemini-stream.test.ts src/llm/__tests__/adapter-gemini.test.ts` 全绿
- coverage：to-gemini.ts / from-gemini-stream.ts / adapter-gemini.ts ≥ 90/85 per-file

**风险**：

- Gemini SDK API 名字（`generateContentStream` vs `streamGenerateContent`）跟 SDK 版本相关，先 `pnpm -F @big-ppt/agent exec node -e "console.log(Object.keys(await import('@google/genai')))"` 验
- Gemini structured output 跟 tools 互斥（两者都用 responseSchema 字段）；翻译层有 tools 时不传 responseSchema，但保证 jsonMode 单独场景能跑
- Gemini SDK abort signal 传递方式跟 OpenAI/Anthropic SDK 不同，可能要 SDK level AbortController 包

**Commit**：`feat(phase12-H): Gemini 原生 adapter + structured output + 单测`

---

### Task I：前端 useAIChat 重写（canonical event consumer）

**目的**：把 frontend `useAIChat.ts` 从 OpenAI SSE 解析器重写成 canonical event consumer。预计净减 ~500 行。**Task E 上线后必须紧跟本 Task**（同一周期合并）。

**操作**：

1. 把 `decodeSSEStream` 通过 shared 包 export 让 creator 用（Task D 已做）。
2. 重写 `packages/creator/src/composables/useAIChat.ts`：

   - **删**：line 196-220 history 守护（tool_call_id 配对）—— 移到 backend
   - **删**：line 270-330 tool_calls accumulate by index 状态机 —— 移到 backend
   - **删**：line 280-310 SSE 手工切 `data:` line + `done` 标记解析 —— 用 `decodeSSEStream`
   - **加**：canonical event consumer 状态机：

     ```ts
     for await (const evt of decodeSSEStream(response.body!)) {
       switch (evt.type) {
         case 'text.delta':
           streamingContent.value += evt.text
           break
         case 'tool_call.start':
           currentToolCalls[evt.id] = { id: evt.id, name: evt.name, argsBuffer: '' }
           break
         case 'tool_call.delta':
           currentToolCalls[evt.id].argsBuffer += evt.argsChunk
           break
         case 'tool_call.end':
           finalizedToolCalls.push({
             id: evt.id,
             name: currentToolCalls[evt.id].name,
             args: JSON.parse(currentToolCalls[evt.id].argsBuffer),
           })
           break
         case 'thinking.delta':
           thinkingContent.value += evt.text
           break
         case 'cache.hit':
           lastCacheStats.value = { cached: evt.cachedTokens, cost: evt.costTokens }
           break
         case 'finish':
           lastUsage.value = evt.usage
           finishReason.value = evt.reason
           break
         case 'error':
           throw new Error(`LLM error [${evt.code}]: ${evt.message}`)
       }
     }
     ```

   - **加**：`thinkingContent` ref + `lastCacheStats` ref + `lastUsage` ref 暴露给消费者
   - **保留**：业务循环（tool call → 执行 tool → 把结果作为新 message 加历史 → 再发 LLM 调用）—— 把 OpenAI shape `{role:'tool', content, tool_call_id}` 改写为 canonical `{role:'tool', content: [{type:'tool_result', toolUseId, content}]}` 形式

3. 改 `packages/creator/src/api/llm.ts`（如已有则改类型，否则新建）：fetch helper 接 canonical request body，POST `/api/llm/chat/completions`，返 `response.body` ReadableStream 给 consumer。
4. UI 改造（最小）：
   - `ChatPanel.vue` 或对应组件加 thinking block 折叠区（默认折叠，展开显示 `thinkingContent` 文本）
   - 每个 assistant bubble 下加小字 "本轮命中缓存 N tokens（节省 M%）" 当 `lastCacheStats` 非空时显示
5. 单测：
   - `useAIChat.canonical-consumer.test.ts`：mock `decodeSSEStream` 产出固定 event 序列，验状态机正确累积
   - `useAIChat.tool-loop.test.ts`：多轮 tool call 完整循环 + canonical message 历史拼接正确
   - `ChatPanel.thinking-block.test.ts`：thinkingContent 非空时渲染折叠区，默认折叠 + 点击展开

**验证方法**：

- `pnpm -F @big-ppt/creator vitest run src/composables/useAIChat.canonical-consumer.test.ts src/composables/useAIChat.tool-loop.test.ts src/components/ChatPanel.thinking-block.test.ts` 全绿
- 浏览器手验：`pnpm dev`，创建 deck，发消息「生成 5 页关于 AI 历史的 deck」，看 streaming 文本 + tool call 执行 + （切到 Claude 模型时）cache hit 提示出现
- creator 全测：`pnpm -F @big-ppt/creator test` 全绿

**风险**：

- frontend 重写一旦 broken 影响用户主链路。**用 1 个 commit 整体推上 main，配合 Task E + Task K smoke 验过再推**
- canonical message 历史拼接要跟 backend chat-row.ts 编解码完全对称，否则切 provider 时历史断
- thinking block UI 视觉要跟现有设计 token 一致，配合 `--ld-*` token

**Commit**：`feat(phase12-I): frontend useAIChat 重写为 canonical event consumer + thinking UI + cache 提示`

---

### Task J：Settings UI 改造（active provider + per-provider config + advanced）

**目的**：用户能在前端 Settings 切换 active provider + 配置 7 个 provider 各自 key/model/baseUrl + advanced 参数。

**操作**：

1. 改 `packages/creator/src/components/SettingsModal.vue`：
   - 顶部 active provider 下拉（7 选 1）
   - 7 个 collapsible card 区，每个对应 provider，含 apiKey input（密码字段） / model / baseUrl
   - Advanced 区折叠：
     - Common 区：temperature slider / maxTokens input / topP slider
     - 当 active 是 anthropic 时展示：promptCaching toggle / thinkingEnabled toggle / thinkingBudgetTokens input
     - 当 active 是 gemini 时展示：jsonMode toggle / longContextStrategy 下拉

2. 改 `packages/agent/src/routes/llm.ts` 或新建 `routes/llm-settings.ts`（如已分离）的 PUT 路径接 LlmSettings zod 校验 + 加密落库。
3. 把 7 个 provider 的元信息（id / name / baseUrl 默认 / 默认 model / 是否需 baseUrl）抽到 `packages/shared/src/llm-providers-catalog.ts`：

   ```ts
   export const PROVIDER_CATALOG = [
     { id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', family: 'openai-compatible' },
     { id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-sonnet-4-5', family: 'anthropic' },
     { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-2.5-flash', family: 'gemini' },
     { id: 'zhipu', name: '智谱 GLM', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'GLM-5.1', family: 'openai-compatible' },
     // ...
   ] as const
   ```

4. 单测：
   - `SettingsModal.provider-switch.test.ts`：切 active 时切换显示的 advanced 区
   - `SettingsModal.save.test.ts`：填表 + 保存 → PUT /api/llm-settings 正确 payload
   - backend `routes/llm-settings.test.ts`：PUT 校验 zod / 加密落库 / 缺 active provider 配置返 400

**验证方法**：

- `pnpm -F @big-ppt/creator vitest run src/components/SettingsModal.*.test.ts` 全绿
- 浏览器手验：登录 → Settings → 配置 Claude key + 切换 active → 关掉 modal → 发消息验证走 Anthropic（看 dev terminal 日志）

**风险**：

- Settings UI 既要兼容老用户首次打开（数据已被 Task F migrate 脚本转好）也要兼容 Task F 没跑完的老用户（用户首次打开 settings 时检测，若是老 shape 就在客户端层调 migrate API）—— 推荐 backend 接口直接返回 normalized 新 shape（routes/auth.ts 的 `/api/auth/me` 拉用户时执行 migration 保底）

**Commit**：`feat(phase12-J): Settings UI 改造为 active provider 切换 + per-provider 配置 + advanced 参数`

---

### Task K：Smoke test 套件

**目的**：每家 provider 落一个真 API smoke test，warn-not-fail 兜底真实兼容性。

**操作**：

1. 新建 3 个 smoke test 文件：

   ```ts
   // packages/agent/src/llm/__tests__/smoke/anthropic.smoke.test.ts
   import { describe, it, expect } from 'vitest'
   import { createAnthropicProvider } from '../../adapters/anthropic.js'

   const ANTHROPIC_KEY = process.env.ANTHROPIC_TEST_KEY
   const BASE_URL = process.env.DUCKCODING_TEST_BASE_URL

   describe.skipIf(!ANTHROPIC_KEY)('anthropic smoke', () => {
     it('chat + tool call + streaming round trip', { retry: 1, timeout: 30_000 }, async () => {
       const provider = createAnthropicProvider({ id: 'anthropic', apiKey: ANTHROPIC_KEY!, baseUrl: BASE_URL })
       const events: CanonicalEvent[] = []
       const controller = new AbortController()
       try {
         for await (const e of provider.streamChat({
           messages: [{ role: 'user', content: [{ type: 'text', text: 'say hi in 3 words' }] }],
           maxTokens: 50,
         }, controller.signal)) {
           events.push(e)
         }
       } catch (e) {
         if (isUpstreamUnstable(e)) {
           console.warn('⚠️ anthropic smoke skipped: upstream unstable')
           return  // soft skip
         }
         throw e
       }
       expect(events.some(e => e.type === 'text.delta')).toBe(true)
       expect(events.at(-1)?.type).toBe('finish')
     })
   })

   function isUpstreamUnstable(e: unknown): boolean {
     const msg = (e as Error).message
     return /timeout|ECONNREFUSED|502|503|504|fetch failed/i.test(msg)
   }
   ```

2. 同样写 `openai.smoke.test.ts`（用 OPENAI_TEST_KEY） + `gemini.smoke.test.ts`。
3. **如果 Task A 探测发现 duckcoding.ai 不支持 Anthropic native /v1/messages 或 Gemini native，对应 smoke 在 desribe 块 console.warn 提示「中转协议不支持，请用直连官方 API key 跑过一次」**，仍允许跑（用直连 key 时会走通）。
4. 跑 `pnpm -F @big-ppt/agent test:smoke`，目标输出 3 个 it 全 ✅ 或 至少 1 个 ✅ 其他 warn skip。

**验证方法**：

- `pnpm -F @big-ppt/agent test:smoke`：至少跑通 OpenAI（中转最稳）；Anthropic / Gemini 视探测结果，warn 不阻塞
- `pnpm -F @big-ppt/agent test`（默认）**不包含** smoke（因 testNamePattern 隔离）—— `grep` 默认 test output 不应见 smoke 测试名

**风险**：

- vitest 4 的 `describe.skipIf` API 跟 vitest 2 写法差异，要查 [vitest 4 docs](https://vitest.dev/api/#describe-skipif)
- smoke test 跑真 API 烧 token；每 case 限制 maxTokens ≤ 50，3 家 × 1 case ≈ 单次 nightly < ¥0.01

**Commit**：`feat(phase12-K): 三家 provider smoke test 套件（warn-not-fail）`

---

### Task L：dogfood + 部署 + prod migration

**目的**：本地跑通端到端 → prod 部署 → 跑迁移脚本 → 验证至少一个「Claude 生成 + Gemini 编辑」端到端场景。

**操作**：

1. **本地 dogfood**（1 天）：
   - 配三家 provider key
   - 跑创建 deck / 切模板 / 多轮编辑 / 工具调用 完整场景，每家 provider 各一遍
   - 记录踩坑（写「踩坑与解决」章节）
2. **prod 部署前 checklist**：
   - `pnpm -F @big-ppt/agent test` 全绿
   - `pnpm -F @big-ppt/agent test:coverage` 各文件 ≥ 90/85
   - `pnpm -F @big-ppt/agent test:smoke` 至少 OpenAI 跑通（Anthropic / Gemini 视协议探测）
   - `pnpm -F @big-ppt/creator test` 全绿
   - `pnpm -F @big-ppt/e2e test` 全绿
   - `pnpm type-check` 全绿
3. 部署：

   ```bash
   pnpm deploy:backend       # 先后端（含 db:push:prod 自动加 canonical_content 列）
   ssh server "cd /var/www/lumideck/agent && pnpm migrate:llm-settings:prod && pnpm migrate:deck-chats:prod"
   pnpm deploy:creator       # 再前端
   pnpm deploy:healthz       # 验 healthz
   ```

4. **prod dogfood 验收**（1 小时）：
   - 用主账号登录 prod
   - 切 active 到 anthropic / 配 Claude key（如果没用 duckcoding 中转，用临时直连 key）
   - 创建新 deck 让 Claude 生成 5 页关于「Vue.js 状态管理」的 PPT
   - 切 active 到 gemini，继续对话「优化第 2 页布局，加图表」
   - 验证：内容连贯（历史延续）+ 工具调用正常 + UI 无报错 + dev 日志 / pm2 logs 无 ERROR
5. roadmap.md Phase 12 状态从「待开始」改「✅ 已关闭（YYYY-MM-DD）」
6. 关闭本 plan：填「执行期偏离」+「踩坑与解决」+「测试数量落地」表，commit。

**验证方法**：

- prod healthz 返 200
- prod dogfood 场景跑通 + 无 5xx
- pm2 logs 无 LLMError unhandled

**风险**：

- migration prod 脚本第一次跑可能踩边角 case（某用户 llm_settings 残缺）—— 脚本设计为 fail-soft（单用户失败不阻塞），并打印失败用户 ID 让后续手工修
- creator 前端 build 后 canonical event consumer 在产线 nginx 反代下要确认 SSE 没 buffer（nginx `proxy_buffering off` 已在 deploy ecosystem）

**Commit**：`docs(phase12-L): 关闭 Phase 12 — Anthropic + Gemini 原生上线 + 偏离与踩坑记录`

---

## 验收条件（roadmap.md Phase 12 清单映射）

- [ ] 三家 provider（OpenAI 兼容族 / Anthropic / Gemini）任一都能完整跑通单轮对话 + 流式 + 取消（Task K + L 端到端验证）
- [ ] 多轮 tool 调用（含 MCP 工具）三家通跑（Task L dogfood 场景覆盖）
- [ ] 8 页 deck 完整生成场景三家通跑（Task L prod dogfood）
- [ ] 切换 active provider 不需改业务代码（Task E + I 架构保证）
- [ ] 前端 Settings 切换 provider，per-provider key 独立加密存（Task J + Task F schema）
- [ ] 老用户 llm_settings 自动迁移无丢失（Task F migration script + prod dogfood 验证）
- [ ] Anthropic prompt caching cache hit 数透传前端 UI 可见（Task G + I）
- [ ] Claude extended thinking 内容流式渲染到前端独立 UI 区（Task G + I）
- [ ] 多模态 image input 三家通跑（Task C/G/H translate 层覆盖 + Task L 验）
- [ ] Mock 单测覆盖率 LLM 抽象层 lines 90 / branches 85 per-file
- [ ] Smoke test：每家 provider ≥ 1 个，warn-not-fail（Task K）
- [ ] 部署到 lumideck.illegalscreed.cn 至少跑通一次「Claude 生成 + Gemini 编辑」端到端（Task L）
- [ ] 全量回归（`pnpm test` + `pnpm -F @big-ppt/e2e test` 全绿）
- [ ] coverage 门槛维持（agent 90/85，creator 75/65）

---

## 不做什么（范围围栏）

- ❌ 同时启用多个主 LLM（无意义；单 active provider）
- ❌ Fine-tuning / 自托管模型（Ollama / vLLM）— 留 Phase 17+
- ❌ Provider 价格估算 / 用量统计页 — 留 Phase 17+
- ❌ 自动按任务类型路由 provider（手动选）
- ❌ 多人协同 / 共享 provider 配置 — per-user 独立
- ❌ `generate_slide_image` 工具的 provider 抽象 — 仍走 `openai-image.ts` 独立路径
- ❌ Vercel AI SDK 或类似第三方统一抽象 — 跟 LLMProvider 接口冲突
- ❌ frontend useAIChat 双轨 feature flag — 单 commit 整体切换 + revert 兜底
- ❌ 旧 `deck_chats.content` / `tool_call_id` 字段删除 — 留下个 Phase 清理减少回滚风险

---

## 执行期偏离（关闭后追加）

> 实际跑下来与 plan 不一致的点，写清"原 plan 怎么说 / 实际怎么做 / 为什么改"。

- _（待填）_

---

## 踩坑与解决（实施期 / 关闭后追加）

> 按「症状 / 根因 / 修复 / 防再犯」四段记完整故事。
> **判断要不要提炼到 [CLAUDE.md 已知坑](../../CLAUDE.md#已知坑)**：换 Phase 还会撞的工具链 / 测试基建 / 构建系统坑才提炼。

- _（待填）_

---

## 测试数量落地（关闭后追加）

| 指标             | 起点 | 终点 | 增量 |
| ---------------- | ---- | ---- | ---- |
| agent unit       |      |      |      |
| creator unit     |      |      |      |
| shared unit      |      |      |      |
| E2E              |      |      |      |
| coverage lines   |      |      |      |
| coverage branch  |      |      |      |
