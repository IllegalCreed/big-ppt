# Phase 12.7 — pi-agent-core 上移 backend agent runtime 实施文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐，8 Task 体量适合 fresh agent per task）或 `superpowers:executing-plans` 逐 Task 实施。步骤用 checkbox（`- [ ]`）追踪。
>
> **状态**：待启动
> **前置阶段**：[plan 26 Phase 12](26-phase12-multi-llm-providers.md) ✅ + [plan 27 Phase 12.5](27-phase12.5-pi-ai-migration.md) ✅
> **后续候选**：Phase 13 MCP catalog 扩展
> **路线图**：[roadmap.md Phase 12.7](../requirements/roadmap.md)
> **设计 spec**：[2026-05-15-phase12.7-pi-agent-core-design.md](../superpowers/specs/2026-05-15-phase12.7-pi-agent-core-design.md)
> **执行子技能**：`superpowers:subagent-driven-development`

**Goal**：把 chat agent execution loop 从 `frontend useAIChat.ts` 搬到 backend，用 `@earendil-works/pi-agent-core@0.74.0`。frontend 从 1011 行瘦到 ~300 行（canonical event SSE consumer + UI 状态），backend 拿到 parallel tool / sessionId caching / beforeToolCall hooks / thinkingLevel 6 档 / terminate flag 等开箱即用能力。

**Architecture**：新建 `POST /api/chat/turn` route，backend 构造 pi-agent-core `Agent` 实例（注入 `streamFn: piAi.stream` / `tools` per-turn 从 user-scoped tool registry wrap / `sessionId` / `beforeToolCall` audit hook），跑 `agent.prompt(message)`，事件流转 SSE 回 frontend。canonical event 集合扩 5 类（turn / tool_execution）。backend 在 `agent_end` 写 `deck_chats`，frontend 不再 POST `/api/decks/:id/chats`。Phase 12 / 12.5 的 canonical 抽象 / pi-ai-adapter 一行不动。

**Tech Stack**：`@earendil-works/pi-agent-core@0.74.0`（pin，跟 OpenClaw）+ pi-ai 0.74.0（已装）+ Hono / Vue 3 / Drizzle / zod 不变。

**预计工作量**：8.5 天（spec §12）。

---

## 关键设计抉择（2026-05-15 与用户对齐）

> 设计期与用户拍板的非显然决策，每条带 "Why"。

1. **pi-agent-core 放 backend 不是 frontend**：Phase 12.5 brainstorming 当时把 pi-agent-core 写成「frontend 上移 useAIChat」是错的——pi-agent-core 设计就是 backend / CLI 用例。
   - **Why**：(a) pi-agent-core README 说 `streamFn for proxy backends`；(b) `getApiKey: async (provider)` callback + `getEnvKeys()` 是 Node-only；(c) OpenClaw 也是 agent 跑 server 端；(d) backend 跑省 frontend-backend 双跳工具执行 + 多端状态一致 + parallel tool 自然实现。

2. **新建 `/api/chat/turn` route，不复用 `/api/llm/chat/completions`**：
   - **Why**：「one turn」≠「one LLM call」，turn 包含 LLM call + N tool execution + 可能继续 LLM call。route 名字反映真实做什么。`/api/llm/chat/completions` 保留供 `rewriteForTemplate` / `rewriteSinglePageToComponents` 这种**单轮无 tool** 的 LLM call 用。

3. **canonical event 集合扩 5 类**：`turn.start` / `turn.end` / `tool_execution.{start,delta,end}`。**不改名** 现有 8 类。
   - **Why**：现有 8 类是 frontend useAIChat / SSE encoder/decoder / 单测 fixture 的契约，改名冲击大。新功能（tool execution 进度可视化、turn 边界）加新事件类型 cleaner。

4. **tool registry bridge 走 per-turn 现场 wrap**：buildToolsForUser(userId) 每 turn 调一次，从现有 user-scoped registry 拉所有 tools wrap 成 `AgentTool[]`。
   - **Why**：现有 tool registry（含 MCP 工具）不动是 single source of truth；20-30 个 tool 量级，per-turn 构造成本忽略。避免双源维护。

5. **chat 持久化交给 backend**：`agent_end` event 后 backend 写 deck_chats，frontend 不再 POST。
   - **Why**：消除 frontend / backend 双源持久化竞争；agent 内部 state 跟 DB 一致由 backend 保证；frontend 仅 GET 渲染。

6. **thinkingLevel 改 6 档 enum 替换 thinkingEnabled boolean**：DB schema migration + Settings UI select 替换 checkbox。
   - **Why**：pi-agent-core 用 6 档（off/minimal/low/medium/high/xhigh），thinkingBudgets 跟 level 映射；boolean shape 表达力不够（Anthropic claude-opus-4-7 / Gemini 2.5 都支持精细 reasoning effort）。

7. **必做 6 项 + defer 4 项**：必做 backend agent loop / parallel tool / sessionId caching / beforeToolCall audit / terminate flag / thinkingLevel UI；defer transformContext compaction / steering UI / cross-provider handoff UI / Custom AgentMessage 类型。
   - **Why**：必做都是「实施成本极小但 ROI 高」+「核心架构必经」；defer 都是「需独立 UI 设计 / 无痛点 / 无新价值」。8.5 天范围圈死。

8. **frontend useAIChat 单文件 commit 整体重写**（不分阶段）：
   - **Why**：tool exec loop 和 SSE 状态机紧耦合，半改 half-broken 风险高。一个 commit 砸下去 + Mock 单测覆盖 + 大 commit 整体 revert 兜底。

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- `.gitignore` 现有 `.env` / `.env.*` / `!.env.example` 规则不要动
- **本 Phase 不引入新环境变量**。`APIKEY_MASTER_KEY` + provider per-user 加密 key 沿用
- 4 把测试 key（memory `test-api-keys`）继续 inline env 跑 smoke + dogfood，**绝不进 git**
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/agent/src/llm/agent/index.ts` | `createAgent({userId, deckId, encryptedSettings, signal})` factory：构造 pi-agent-core Agent 实例（注入 streamFn / tools / sessionId / hooks / initial messages） |
| `packages/agent/src/llm/agent/tool-bridge.ts` | `buildToolsForUser(userId): Promise<AgentTool[]>` —— per-turn 从 user-scoped tool registry 拉所有 tools wrap 成 pi-agent-core AgentTool；执行回调走 `executeTool({userId, toolName, args, signal})` |
| `packages/agent/src/llm/agent/persistence.ts` | `persistTurnToDeckChats(deckId, allMessages, existingMessages): Promise<void>`：计算本 turn 新增的 messages（delta vs already-in-DB），单 transaction 批量 insert 到 `deck_chats`（`canonicalContent` JSON 列 + 兼容旧 `content` / `toolCallId` 字段） |
| `packages/agent/src/llm/agent/translate-events.ts` | pi-agent-core 11 类 event → canonical 13 类 event 映射；`async function* translateAgentStream(agent, prompt)`：用 subscribe → buffer queue → async generator pattern 把 push-based event 转 pull-based |
| `packages/agent/src/llm/agent/agent-message.ts` | pi-agent-core `AgentMessage` ↔ canonical `CanonicalMessage` 双向翻译（沿用 Phase 12 Task F 的 chat-row.ts 风格） |
| `packages/agent/src/routes/chat.ts` | `POST /api/chat/turn` 路由：鉴权 → 验 deck 所有权 → acquireLlmSlot → createAgent → translateAgentStream → eventsToSSEStream Response |
| `packages/agent/src/llm/agent/__tests__/tool-bridge.test.ts` | tool-bridge 单测：fake user-scoped registry 注入多个 tool，验 AgentTool[] wrap 正确 + execute 调 executeTool 透传 |
| `packages/agent/src/llm/agent/__tests__/persistence.test.ts` | persistence 单测：用 lumideck_test 真 DB 跑全链路（mock messages → persist → 读出 → 校验 canonical Block[] round-trip） |
| `packages/agent/src/llm/agent/__tests__/translate-events.test.ts` | event 映射单测：构造 pi-agent-core event 序列 → 验 canonical event 输出 |
| `packages/agent/src/llm/agent/__tests__/agent-message.test.ts` | AgentMessage ↔ CanonicalMessage 翻译单测（user/assistant/toolResult 三种 role + 5 种 Block） |
| `packages/agent/test/integration/chat-turn.test.ts` | route 集成测：用 `__setAgentFactoryForTesting` 注入 fake agent（按脚本 emit event 序列），验 SSE 响应 + DB 写入 + 401/400/503 |
| `packages/agent/scripts/migrate-thinking-level.mjs` | 一次性 migration：把 `users.llm_settings.advanced.{anthropic,gemini,common}.thinkingEnabled: boolean` 改 `thinkingLevel: enum`；boolean → enum 映射 `false → 'off'` / `true → 'medium'` |
| `packages/creator/src/components/ToolExecutionBlock.vue` | Chat bubble 内 tool execution 进度展示：状态（pending/running/done/error）+ args 摘要 + result preview（可折叠） |
| `packages/creator/src/api/chat.ts` | frontend fetch helper：`chatTurn(req, { deckId, signal }): Response` POST `/api/chat/turn` 返回 ReadableStream<Uint8Array> 给 consumer |
| `packages/creator/test/useAIChat.thin-consumer.test.ts` | 重写后的 useAIChat 单测（替换 Phase 12 Task I 的 .canonical-consumer.test.ts 老 fixtures） |
| `packages/creator/test/ToolExecutionBlock.test.ts` | ToolExecutionBlock 渲染 + 折叠交互测 |
| `docs/plans/28-phase12.7-pi-agent-core.md` | 本文件 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/agent/package.json` | 新增 `@earendil-works/pi-agent-core@0.74.0` 锁版本依赖；新增 `migrate:thinking-level` 三个环境 script |
| `packages/agent/src/app.ts` | mount `/api/chat/turn` route：`app.route('/api/chat', chat)` |
| `packages/agent/src/llm/settings.ts` | `ThinkingLevelSchema = z.enum(['off','minimal','low','medium','high','xhigh'])`；`AdvancedAnthropicSchema` / `AdvancedGeminiSchema` / `AdvancedCommonSchema` 字段 `thinkingEnabled` → `thinkingLevel`；`getActiveProviderConfig` 同时兼容 boolean 老 shape（false→off / true→medium）防 migration 未跑炸 |
| `packages/agent/src/llm/migrations.ts` | 加 `migrateThinkingEnabledToLevel(legacy)` helper + 跟 migrate-llm-settings 同款 dist/ + .mjs 调用模式 |
| `packages/agent/src/llm/adapters/pi-ai-adapter.ts` | 不动（继续作为 pi-agent-core `streamFn` 调用） |
| `packages/agent/src/routes/decks.ts` | POST `/api/decks/:id/chats` 保留接收（前端旧版本兼容期）+ 加 `logServerEvent({ category: 'agent', event: 'deprecated-frontend-chat-post' })` 标 deprecated；Phase 13/14 再移除 |
| `packages/shared/src/llm-canonical.ts` | `CanonicalEvent` union 加 5 类：`turn.start` / `turn.end` / `tool_execution.start` / `tool_execution.delta` / `tool_execution.end`；`TokenUsage` 不动 |
| `packages/creator/src/composables/useAIChat.ts` | 大瘦身：1011 → ~300 行。删 tool exec loop / chats POST / arg accumulator。保留 canonical event SSE consumer + 4 ref（streamingContent / thinkingContent / lastUsage / status）+ abort handling。加 tool_execution event 处理（currentToolExecutions Map） |
| `packages/creator/src/components/SettingsModal.vue` | advanced 子区：anthropic / gemini / common 三处 `thinkingEnabled` checkbox 替换为 `thinkingLevel` `<select>` 6 选 1；保留 thinkingBudgetTokens input |
| `packages/creator/src/components/ChatPanel.vue` | 在 assistant bubble 内 tool_call.start 后渲染 `<ToolExecutionBlock>`；tool_execution event 来时更新 |
| `packages/creator/src/api/llm.ts` | `chatStream(...)` 改名 `chatStreamLegacy`（仍供 Settings 健康检查等非 agent 路径用），新建 `chatTurn(...)` 在 `api/chat.ts` |
| `packages/creator/test/SettingsModal.save.test.ts` | thinkingLevel 测试断言（select value 而非 checkbox checked） |
| `packages/creator/test/SettingsModal.provider-switch.test.ts` | thinkingLevel select 渲染断言 |
| `docs/requirements/roadmap.md` | 加 Phase 12.7 条目；Phase 12.5 spec 中关于「pi-agent-core 留 Phase 13 候选」的 framing 修正（Phase 12.7 已落地，Phase 13 仍是 MCP catalog） |
| `CLAUDE.md` | 「LLM / Tool 工程」加 pi-agent-core 相关已知坑（dogfood 期发现的填）；架构图加 agent runtime 层 |

### 不动（关键骨架）

| 文件 | 为什么 |
| ---- | ---- |
| `packages/agent/src/llm/adapters/pi-ai-adapter.ts` | LLM 层；pi-agent-core 通过 streamFn 调用它 |
| `packages/agent/src/llm/types.ts` / `errors.ts` / `provider.ts` / `canonical-sse.ts` | canonical 抽象骨架不动 |
| `packages/agent/src/tools/registry.ts` / `mcp-registry/*` | tool 源不动，agent tool-bridge 现场 wrap |
| `packages/agent/src/db/schema.ts` | DB shape 不动（仅 advanced.thinkingLevel 字段语义变） |
| `packages/agent/src/llm/chat-row.ts` | canonical Block[] ↔ DB row 转换继续用 |
| `packages/agent/src/routes/llm.ts` | `/api/llm/chat/completions` route 保留供非 agent 单轮 LLM call 用 |

### 删除（关闭后清理，本 Phase 不删）

| 文件 / 内容 | 原因 |
| --- | --- |
| `packages/creator/test/useAIChat.canonical-consumer.test.ts` | 被 `useAIChat.thin-consumer.test.ts` 取代（重写后语义变化） |
| `packages/creator/test/useAIChat.tool-loop.test.ts` | 测的是被删的 tool exec loop |

---

## 数据模型变更

### `users.llm_settings` 字段（仅 JSON shape 微变，无 DDL 改动）

旧 shape（Phase 12.5 落地的）：

```ts
{
  activeProvider, providers,
  advanced?: {
    anthropic?: { promptCaching?, thinkingEnabled?: boolean, thinkingBudgetTokens? }
    gemini?: { jsonMode?, longContextStrategy? }
    common?: { temperature?, maxTokens?, topP?, stopSequences? }
  }
}
```

新 shape（Phase 12.7）：

```ts
{
  activeProvider, providers,
  advanced?: {
    anthropic?: { promptCaching?, thinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh', thinkingBudgetTokens? }
    gemini?: { jsonMode?, longContextStrategy?, thinkingLevel?: ThinkingLevel }
    common?: { temperature?, maxTokens?, topP?, stopSequences?, thinkingLevel?: ThinkingLevel }
  }
}
```

迁移策略：一次性脚本 `migrate-thinking-level.mjs`（dev/test/prod 各跑一次）；读取层（`getActiveProviderConfig` + 后续 advanced parser）同时兼容 boolean 老 shape（兜底 `false → 'off'` / `true → 'medium'`），避免 migration 未跑炸。

### `deck_chats` 表

**完全不动**。Phase 12 Task F 的 `canonical_content` LONGTEXT 列继续用，chat-row.ts helper 不动。本 Phase 改的是**写入方**：从 frontend 改成 backend agent。

---

## 阶段拆分

每 Task 一个 commit；每步绿测试 + 当步独立可回退。

### Task A：依赖 + canonical event 扩展 + agent 目录骨架

**目的**：装 pi-agent-core；扩 `CanonicalEvent` union 加 5 新类型；新建 `packages/agent/src/llm/agent/` 目录骨架（empty stubs，type-check 通过）。**最小破坏 commit**，让后续 Task 有地方落代码。

**Files：**
- Modify: `packages/agent/package.json`（依赖）
- Modify: `packages/shared/src/llm-canonical.ts`（CanonicalEvent union 扩 5 类）
- Create: `packages/agent/src/llm/agent/index.ts`（stub: `export async function createAgent() { throw new Error('Task B 实施') }`）
- Create: `packages/agent/src/llm/agent/tool-bridge.ts`（stub）
- Create: `packages/agent/src/llm/agent/persistence.ts`（stub）
- Create: `packages/agent/src/llm/agent/translate-events.ts`（stub）
- Create: `packages/agent/src/llm/agent/agent-message.ts`（stub）

**操作**：

- [ ] **Step 1：装 pi-agent-core + 验证版本稳定**

```bash
pnpm view @earendil-works/pi-agent-core dist-tags
# 期望 latest: 0.74.0(跟 OpenClaw 同款),无 beta/alpha 在 latest dist-tag
pnpm -F @big-ppt/agent add @earendil-works/pi-agent-core@0.74.0
```

确认 `package.json` deps 含 `"@earendil-works/pi-agent-core": "0.74.0"`（exact pin）。

- [ ] **Step 2：扩 CanonicalEvent union**

改 `packages/shared/src/llm-canonical.ts` `CanonicalEvent` union（加 5 类，保留旧 8 类不动）：

```ts
export type CanonicalEvent =
  // Phase 12.7 新增:turn / tool_execution
  | { type: 'turn.start'; turnId: string }
  | { type: 'turn.end'; usage: TokenUsage; reason: FinishReason }
  | { type: 'tool_execution.start'; toolCallId: string; toolName: string }
  | { type: 'tool_execution.delta'; toolCallId: string; partial: unknown }
  | { type: 'tool_execution.end'; toolCallId: string; isError: boolean }
  // 原 8 类保留
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call.start'; id: string; name: string }
  | { type: 'tool_call.delta'; id: string; argsChunk: string }
  | { type: 'tool_call.end'; id: string }
  | { type: 'thinking.delta'; text: string }
  | { type: 'cache.hit'; cachedTokens: number; costTokens: number }
  | { type: 'finish'; reason: FinishReason; usage: TokenUsage }  // 非 agent 单轮调用仍用
  | { type: 'error'; code: string; message: string }
```

- [ ] **Step 3：建 agent 目录 stubs**

```bash
mkdir -p packages/agent/src/llm/agent/__tests__
```

每个 file 写最小 stub 让 type-check 过：

```ts
// packages/agent/src/llm/agent/index.ts
import type { CanonicalEvent } from '../types.js'

export interface CreateAgentOpts {
  userId: number
  deckId: number
  encryptedSettings: string
  signal: AbortSignal
}

export async function createAgent(_opts: CreateAgentOpts): Promise<never> {
  throw new Error('Task C 实施 pi-agent-core Agent 构造')
}

/** Task D translate-events 实施 */
export async function* runAgentTurn(
  _agent: unknown,
  _prompt: string,
): AsyncGenerator<CanonicalEvent> {
  throw new Error('Task D 实施')
  yield* [] as never[]
}
```

```ts
// packages/agent/src/llm/agent/tool-bridge.ts
export async function buildToolsForUser(_userId: number): Promise<unknown[]> {
  throw new Error('Task B 实施')
}
```

```ts
// packages/agent/src/llm/agent/persistence.ts
import type { CanonicalMessage } from '../types.js'

export async function persistTurnToDeckChats(
  _deckId: number,
  _allMessages: CanonicalMessage[],
  _existingCount: number,
): Promise<void> {
  throw new Error('Task E 实施')
}
```

```ts
// packages/agent/src/llm/agent/translate-events.ts
import type { CanonicalEvent } from '../types.js'

export async function* translateAgentStream(
  _agent: unknown,
  _prompt: string,
): AsyncGenerator<CanonicalEvent> {
  throw new Error('Task D 实施')
  yield* [] as never[]
}
```

```ts
// packages/agent/src/llm/agent/agent-message.ts
import type { CanonicalMessage } from '../types.js'

export function agentMessageToCanonical(_m: unknown): CanonicalMessage {
  throw new Error('Task B 实施(配合 tool-bridge)')
}

export function canonicalToAgentMessage(_m: CanonicalMessage): unknown {
  throw new Error('Task B 实施')
}
```

- [ ] **Step 4：跑 type-check 验证**

```bash
pnpm -F @big-ppt/agent type-check 2>&1 | tail -3
pnpm -F @big-ppt/shared type-check 2>&1 | tail -3
pnpm -F @big-ppt/creator type-check 2>&1 | tail -3
```

预期：全过。stub functions throw at runtime 但 type-check 通过。

- [ ] **Step 5：跑全套测试**

```bash
pnpm -F @big-ppt/agent test 2>&1 | tail -5
pnpm -F @big-ppt/creator test 2>&1 | tail -5
```

预期：全过（CanonicalEvent union 扩字段不破坏现有 consumer，因为是 union 加成员）。

- [ ] **Step 6：commit**

```bash
git status  # 确认改动:package.json + lockfile + shared canonical + agent/ 6 个 stub
git add packages/agent/package.json pnpm-lock.yaml \
        packages/shared/src/llm-canonical.ts \
        packages/agent/src/llm/agent/index.ts \
        packages/agent/src/llm/agent/tool-bridge.ts \
        packages/agent/src/llm/agent/persistence.ts \
        packages/agent/src/llm/agent/translate-events.ts \
        packages/agent/src/llm/agent/agent-message.ts
git commit -m "$(cat <<'COMMIT'
feat(phase12.7-A): 装 pi-agent-core@0.74.0 + 扩 canonical event 5 类 + agent 目录骨架

依赖:加 @earendil-works/pi-agent-core@0.74.0(OpenClaw 同款 pin),exact 版本号
避免 npm latest beta 漂移(Phase 12 Task A / Phase 12.5 Task A 同款防御)。

canonical:CanonicalEvent union 加 5 类(turn.start / turn.end /
tool_execution.{start,delta,end}),为 Task D event 映射 + Task G frontend
ToolExecutionBlock 渲染铺路。原 8 类保留不动,finish event 继续供非 agent
单轮 LLM call(rewriteForTemplate / rewriteSinglePageToComponents)用。

目录骨架:packages/agent/src/llm/agent/ 新增 6 个 stub file(index / tool-bridge
/ persistence / translate-events / agent-message + __tests__/),所有 export
function throw 'TaskX 实施' 占位,type-check 通过让后续 Task 增量填充。

全套测试 + type-check 不破坏。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

**验证方法**：

- 3 个 package type-check 全绿
- 全套测试不破坏
- `pnpm view @earendil-works/pi-agent-core dist-tags` 验证 0.74.0 是 stable

**风险**：

- pi-agent-core 0.74.0 可能不是 npm latest（参考 Phase 12.5 Task A 同款检查）—— Step 1 dist-tags 命令必跑

---

### Task B：tool-bridge + AgentMessage 翻译

**目的**：实现 `buildToolsForUser(userId)` —— 从 user-scoped tool registry 拉 tools wrap 成 `AgentTool[]`；实现 `agentMessageToCanonical` / `canonicalToAgentMessage` 双向翻译。带 30+ 单测。

**Files：**
- Modify: `packages/agent/src/llm/agent/tool-bridge.ts`（实现）
- Modify: `packages/agent/src/llm/agent/agent-message.ts`（实现）
- Create: `packages/agent/src/llm/agent/__tests__/tool-bridge.test.ts`
- Create: `packages/agent/src/llm/agent/__tests__/agent-message.test.ts`

**操作**：

- [ ] **Step 1：探索 pi-agent-core 实际 AgentTool / AgentMessage 类型**

```bash
node -e "console.log(Object.keys(await import('@earendil-works/pi-agent-core')).sort().join('\n'))"
cat node_modules/@earendil-works/pi-agent-core/dist/index.d.ts 2>&1 | grep -A 5 'AgentTool\|AgentMessage' | head -60
```

记录实际签名（fields / required vs optional / TypeBox vs raw JSON Schema），跟下面 spec 假设对比调整。

- [ ] **Step 2：实现 tool-bridge**

`packages/agent/src/llm/agent/tool-bridge.ts`：

```ts
/**
 * Phase 12.7 Task B: pi-agent-core AgentTool ↔ 我们 user-scoped tool registry 桥接。
 *
 * per-turn 在 createAgent 里调用,从当前 user 的 tool registry 拉所有 tool
 * (built-in + MCP),wrap 成 AgentTool[] 传给 new Agent({ tools })。
 * 工具执行回调 → executeTool({userId, toolName, args, signal}) 走老链路。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { listToolsForUser, executeTool } from '../../tools/registry.js'
import type { Block } from '../types.js'

export async function buildToolsForUser(userId: number): Promise<AgentTool[]> {
  const tools = listToolsForUser(userId)  // {name, description, inputSchema}[]
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as never,  // pi-agent-core 期望 TSchema, runtime 接 JSON Schema (Phase 12.5 Task B verified)
    execute: async (args: Record<string, unknown>, ctx?: { signal?: AbortSignal }) => {
      const result = await executeTool({
        userId,
        toolName: t.name,
        args,
        signal: ctx?.signal,
      })
      return {
        content: normalizeToolResultBlocks(result),
        isError: result.isError ?? false,
        terminate: result.terminate ?? false,  // 工具 opt-in,pi-agent-core 配套 afterToolCall
      }
    },
  }))
}

function normalizeToolResultBlocks(result: { content?: unknown; data?: unknown }): Block[] {
  // tool registry 返回 shape 多样,统一成 canonical Block[]
  if (Array.isArray(result.content)) return result.content as Block[]
  if (typeof result.content === 'string') return [{ type: 'text', text: result.content }]
  // 兜底:JSON.stringify
  return [{ type: 'text', text: JSON.stringify(result.data ?? result, null, 2) }]
}
```

注意：`listToolsForUser` 实际签名以现有 `packages/agent/src/tools/registry.ts` 为准——Step 1 探索时 grep 确认 export name 是 `listToolsForUser` 还是 `listForUser` 等。若不存在则在 registry.ts 加该 export（拉出现有内部 listing 逻辑成 public function）。同理 `executeTool` 签名。

- [ ] **Step 3：实现 agent-message 翻译**

`packages/agent/src/llm/agent/agent-message.ts`：

```ts
/**
 * Phase 12.7 Task B: pi-agent-core AgentMessage ↔ canonical CanonicalMessage 双向翻译。
 *
 * pi-agent-core role: 'user' | 'assistant' | 'toolResult'
 * canonical role:     'user' | 'assistant' | 'tool' | 'system'
 *
 * Phase 12.7 不引入 system 在 agent message 链路里(systemPrompt 单独走 Agent
 * initialState.systemPrompt 字段)。
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { CanonicalMessage, Block } from '../types.js'

export function agentMessageToCanonical(m: AgentMessage): CanonicalMessage {
  if (m.role === 'user') {
    return {
      role: 'user',
      content: (m.content as { type: string; [k: string]: unknown }[]).map(piContentToCanonical),
    }
  }
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content: (m.content as { type: string; [k: string]: unknown }[]).map(piContentToCanonical),
    }
  }
  // toolResult
  return {
    role: 'tool',
    content: [
      {
        type: 'tool_result',
        toolUseId: (m as { toolCallId: string }).toolCallId,
        content: (m as { content: unknown[] }).content as Block[],
        isError: (m as { isError?: boolean }).isError,
      },
    ],
  }
}

export function canonicalToAgentMessage(m: CanonicalMessage): AgentMessage {
  if (m.role === 'system') {
    throw new Error('canonical system message 不应进入 agent messages 链路;走 Agent.initialState.systemPrompt')
  }
  if (m.role === 'tool') {
    const tr = m.content[0]
    if (!tr || tr.type !== 'tool_result') {
      throw new Error('canonical tool message 缺 tool_result block')
    }
    return {
      role: 'toolResult',
      toolCallId: tr.toolUseId,
      toolName: 'unknown',  // canonical 不存 name;pi-agent-core 多数 provider 不强校验(同 Phase 12.5 Task B 决策)
      content: Array.isArray(tr.content) ? (tr.content as never) : [{ type: 'text', text: tr.content }],
      isError: tr.isError ?? false,
      timestamp: Date.now(),
    } as never
  }
  // user / assistant
  return {
    role: m.role,
    content: m.content.map(canonicalToPiContent),
    timestamp: Date.now(),
  } as never
}

function piContentToCanonical(c: { type: string; [k: string]: unknown }): Block {
  switch (c.type) {
    case 'text':
      return { type: 'text', text: c.text as string }
    case 'image':
      return { type: 'image', mediaType: c.mimeType as string, dataBase64: c.data as string }
    case 'thinking':
      return { type: 'thinking', text: c.text as string }
    case 'toolCall':
      return {
        type: 'tool_use',
        id: c.id as string,
        name: c.name as string,
        input: c.arguments,
      }
    default:
      throw new Error(`unexpected pi-agent-core content type: ${c.type}`)
  }
}

function canonicalToPiContent(b: Block): { type: string; [k: string]: unknown } {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text }
    case 'image':
      return { type: 'image', mimeType: b.mediaType, data: b.dataBase64 }
    case 'thinking':
      return { type: 'thinking', text: b.text }
    case 'tool_use':
      return { type: 'toolCall', id: b.id, name: b.name, arguments: b.input }
    case 'tool_result':
      throw new Error('tool_result block 不应出现在 user/assistant message;走 toolResult role')
  }
}
```

- [ ] **Step 4：写 tool-bridge 单测**

`packages/agent/src/llm/agent/__tests__/tool-bridge.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildToolsForUser } from '../tool-bridge.js'
import * as registry from '../../../tools/registry.js'

describe('tool-bridge: buildToolsForUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('wraps each registry tool as AgentTool with name+description+parameters', async () => {
    vi.spyOn(registry, 'listToolsForUser').mockReturnValue([
      { name: 'write_slides', description: 'Write slides', inputSchema: { type: 'object' } },
      { name: 'mcp__zhipu__search', description: 'Zhipu search', inputSchema: { type: 'object' } },
    ])
    const tools = await buildToolsForUser(42)
    expect(tools).toHaveLength(2)
    expect(tools[0]?.name).toBe('write_slides')
    expect(tools[0]?.description).toBe('Write slides')
    expect(tools[1]?.name).toBe('mcp__zhipu__search')
  })

  it('AgentTool.execute → registry.executeTool with correct args', async () => {
    vi.spyOn(registry, 'listToolsForUser').mockReturnValue([
      { name: 'write_slides', description: '', inputSchema: { type: 'object' } },
    ])
    const execSpy = vi
      .spyOn(registry, 'executeTool')
      .mockResolvedValue({ content: 'ok', isError: false })
    const tools = await buildToolsForUser(42)
    const ctx = { signal: new AbortController().signal }
    await tools[0]!.execute({ key: 'value' }, ctx)
    expect(execSpy).toHaveBeenCalledWith({
      userId: 42,
      toolName: 'write_slides',
      args: { key: 'value' },
      signal: ctx.signal,
    })
  })

  it('normalizes string content to text Block[]', async () => {
    vi.spyOn(registry, 'listToolsForUser').mockReturnValue([
      { name: 't', description: '', inputSchema: { type: 'object' } },
    ])
    vi.spyOn(registry, 'executeTool').mockResolvedValue({ content: 'plain text', isError: false })
    const tools = await buildToolsForUser(1)
    const result = await tools[0]!.execute({}, {})
    expect(result.content).toEqual([{ type: 'text', text: 'plain text' }])
    expect(result.isError).toBe(false)
  })

  it('propagates terminate flag', async () => {
    vi.spyOn(registry, 'listToolsForUser').mockReturnValue([
      { name: 't', description: '', inputSchema: { type: 'object' } },
    ])
    vi.spyOn(registry, 'executeTool').mockResolvedValue({
      content: 'done',
      isError: false,
      terminate: true,
    })
    const tools = await buildToolsForUser(1)
    const result = await tools[0]!.execute({}, {})
    expect(result.terminate).toBe(true)
  })

  it('propagates isError flag', async () => {
    vi.spyOn(registry, 'listToolsForUser').mockReturnValue([
      { name: 't', description: '', inputSchema: { type: 'object' } },
    ])
    vi.spyOn(registry, 'executeTool').mockResolvedValue({
      content: 'oops',
      isError: true,
    })
    const tools = await buildToolsForUser(1)
    const result = await tools[0]!.execute({}, {})
    expect(result.isError).toBe(true)
  })

  it('empty registry returns empty array', async () => {
    vi.spyOn(registry, 'listToolsForUser').mockReturnValue([])
    expect(await buildToolsForUser(99)).toEqual([])
  })
})
```

- [ ] **Step 5：写 agent-message 翻译单测**

`packages/agent/src/llm/agent/__tests__/agent-message.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { agentMessageToCanonical, canonicalToAgentMessage } from '../agent-message.js'

describe('agentMessageToCanonical: user', () => {
  it('text content', () => {
    const r = agentMessageToCanonical({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      timestamp: 0,
    } as never)
    expect(r).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }] })
  })
  it('image content (mimeType/data)', () => {
    const r = agentMessageToCanonical({
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: 'AAA' }],
      timestamp: 0,
    } as never)
    expect(r.content[0]).toEqual({ type: 'image', mediaType: 'image/png', dataBase64: 'AAA' })
  })
})

describe('agentMessageToCanonical: assistant', () => {
  it('text + thinking + toolCall', () => {
    const r = agentMessageToCanonical({
      role: 'assistant',
      content: [
        { type: 'thinking', text: '...' },
        { type: 'text', text: 'answer' },
        { type: 'toolCall', id: 't1', name: 'f', arguments: { a: 1 } },
      ],
      timestamp: 0,
    } as never)
    expect(r.content).toHaveLength(3)
    expect(r.content[0]).toEqual({ type: 'thinking', text: '...' })
    expect(r.content[1]).toEqual({ type: 'text', text: 'answer' })
    expect(r.content[2]).toEqual({ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } })
  })
})

describe('agentMessageToCanonical: toolResult', () => {
  it('text content', () => {
    const r = agentMessageToCanonical({
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'f',
      content: [{ type: 'text', text: 'output' }],
      isError: false,
      timestamp: 0,
    } as never)
    expect(r.role).toBe('tool')
    expect(r.content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 't1',
      content: [{ type: 'text', text: 'output' }],
      isError: false,
    })
  })
})

describe('canonicalToAgentMessage: round-trip', () => {
  it('user round-trip', () => {
    const c = { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }
    const r = agentMessageToCanonical(canonicalToAgentMessage(c) as never)
    expect(r).toEqual(c)
  })
  it('assistant with tool_use round-trip', () => {
    const c = {
      role: 'assistant' as const,
      content: [{ type: 'tool_use' as const, id: 't1', name: 'f', input: { a: 1 } }],
    }
    const r = agentMessageToCanonical(canonicalToAgentMessage(c) as never)
    expect(r).toEqual(c)
  })
  it('tool round-trip', () => {
    const c = {
      role: 'tool' as const,
      content: [
        {
          type: 'tool_result' as const,
          toolUseId: 't1',
          content: [{ type: 'text' as const, text: 'output' }],
          isError: false,
        },
      ],
    }
    const r = agentMessageToCanonical(canonicalToAgentMessage(c) as never)
    expect(r.role).toBe('tool')
    expect(r.content[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 't1',
      isError: false,
    })
  })
})

describe('canonicalToAgentMessage: errors', () => {
  it('rejects system role', () => {
    expect(() =>
      canonicalToAgentMessage({ role: 'system', content: [{ type: 'text', text: 'hi' }] }),
    ).toThrow(/system message 不应进入/)
  })
})
```

- [ ] **Step 6：跑测试 + commit**

```bash
pnpm -F @big-ppt/agent vitest run src/llm/agent/__tests__/tool-bridge.test.ts src/llm/agent/__tests__/agent-message.test.ts 2>&1 | tail -5
pnpm -F @big-ppt/agent type-check 2>&1 | tail -3
```

预期：tool-bridge 6 测 + agent-message 8 测 = 14 测全过；coverage tool-bridge.ts / agent-message.ts ≥ 90 lines / 85 branches per-file。

```bash
git status
git add packages/agent/src/llm/agent/tool-bridge.ts \
        packages/agent/src/llm/agent/agent-message.ts \
        packages/agent/src/llm/agent/__tests__/tool-bridge.test.ts \
        packages/agent/src/llm/agent/__tests__/agent-message.test.ts
git commit -m "$(cat <<'COMMIT'
feat(phase12.7-B): tool-bridge + AgentMessage 双向翻译 + 单测

tool-bridge:
- buildToolsForUser(userId) 从 user-scoped registry 拉所有 tool wrap 成
  pi-agent-core AgentTool[];AgentTool.execute 回调走现有 executeTool 老链路
  (sub: 透传 userId / toolName / args / signal)
- normalizeToolResultBlocks 统一各 tool 返回 shape 成 canonical Block[]
- 透传 isError + terminate flag(为 generate_slide_image 等终态工具铺路)

agent-message:
- agentMessageToCanonical / canonicalToAgentMessage 双向翻译;
  pi-agent-core role 3 种(user/assistant/toolResult) ↔ canonical 4 种
  (user/assistant/tool/system),system 走 Agent.initialState.systemPrompt 不入链
- 5 类 Block(text/image/thinking/tool_use/tool_result)全覆盖

单测:tool-bridge 6 测 + agent-message 8 测 全过,coverage per-file ≥ 90/85。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

**验证方法**：

- 14 测全绿
- coverage 达标
- type-check 干净

**风险**：

- pi-agent-core `AgentTool` / `AgentMessage` 实际 type signature 跟假设可能有偏差（Phase 12.5 Task B 同款踩坑）—— Step 1 探索时打印 actual type 修正
- `listToolsForUser` / `executeTool` 在现有 registry 可能不是公开 export —— Step 2 添加 export 时确保签名一致

---

### Task C：createAgent factory + persistence hook

**目的**：实现 `createAgent` 构造 pi-agent-core Agent 实例（注入 streamFn / tools / sessionId / hooks）；实现 `persistTurnToDeckChats` agent_end 后写 deck_chats。

**Files：**
- Modify: `packages/agent/src/llm/agent/index.ts`
- Modify: `packages/agent/src/llm/agent/persistence.ts`
- Create: `packages/agent/src/llm/agent/__tests__/persistence.test.ts`
- Modify: `packages/agent/src/llm/agent/__tests__/agent.test.ts`

**操作**：

- [ ] **Step 1：实现 createAgent**

`packages/agent/src/llm/agent/index.ts`：

```ts
/**
 * Phase 12.7 Task C: pi-agent-core Agent factory。
 *
 * 构造 Agent 实例,注入:
 * - streamFn: pi-ai.stream 直接传(LLM 调用走 Phase 12.5 layer)
 * - tools: buildToolsForUser(userId) per-turn 现场 wrap
 * - sessionId: `lumideck:user-${id}:deck-${id}` 稳定 key,Anthropic prompt cache 命中率
 * - beforeToolCall / afterToolCall: audit log (不 block)
 * - toolExecution: 'parallel' (default,多 tool 并发)
 * - initialState: systemPrompt + thinkingLevel + 已有 messages
 *
 * 用 agent.subscribe 监听 agent_end 自动写 deck_chats。
 */
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core'
import { stream as piAiStream, type Model } from '@earendil-works/pi-ai'
import { getActiveProviderConfig, parseLlmSettings } from '../settings.js'
import { decryptApiKey } from '../../crypto/apikey.js'
import { resolveModelForProvider } from '../adapters/pi-ai-adapter.js'  // export 自 pi-ai-adapter
import { buildToolsForUser } from './tool-bridge.js'
import { persistTurnToDeckChats } from './persistence.js'
import { agentMessageToCanonical, canonicalToAgentMessage } from './agent-message.js'
import { loadDeckChatHistory } from './history-loader.js'  // helper 拉历史(读 deck_chats)
import { buildSystemPromptForDeck } from '../../prompts/buildSystemPrompt.js'
import { logServerEvent } from '../../logger/server-log.js'

export interface CreateAgentOpts {
  userId: number
  deckId: number
  encryptedSettings: string
  signal: AbortSignal
}

export async function createAgent(opts: CreateAgentOpts) {
  const cfg = getActiveProviderConfig(opts.encryptedSettings)
  if (!cfg) throw new Error('LLM 未配置 active provider 或缺 apiKey')

  // 解析 advanced.thinkingLevel(同时兼容 boolean 老 shape)
  const settings = parseLlmSettings(JSON.parse(decryptApiKey(opts.encryptedSettings)))
  const thinkingLevel = resolveThinkingLevel(settings, cfg.provider)

  const model = resolveModelForProvider(cfg.provider, cfg.model, cfg.baseUrl)
  const tools = await buildToolsForUser(opts.userId)
  const systemPrompt = await buildSystemPromptForDeck(opts.deckId)
  const existingCanonical = await loadDeckChatHistory(opts.deckId)
  const existingAgentMessages = existingCanonical.map(canonicalToAgentMessage)

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
      messages: existingAgentMessages,
    },
    streamFn: piAiStream as never,  // pi-agent-core 期望 streamFn 类型,pi-ai stream 兼容(实施期 verify)
    sessionId: `lumideck:user-${opts.userId}:deck-${opts.deckId}`,
    toolExecution: 'parallel',

    beforeToolCall: async ({ toolCall }) => {
      logServerEvent({
        category: 'agent',
        event: 'tool-call',
        userId: opts.userId,
        deckId: opts.deckId,
        toolName: toolCall.name,
      })
      return undefined  // pass through
    },

    afterToolCall: async ({ toolCall, result, isError }) => {
      logServerEvent({
        category: 'agent',
        event: 'tool-result',
        userId: opts.userId,
        deckId: opts.deckId,
        toolName: toolCall.name,
        isError,
      })
      return undefined  // 不改 result; terminate 由工具 self-return
    },
  })

  // agent_end 写库(turn 边界)
  agent.subscribe(async (event: AgentEvent) => {
    if (event.type === 'agent_end') {
      try {
        const newCanonical = event.messages.map(agentMessageToCanonical)
        await persistTurnToDeckChats(opts.deckId, newCanonical, existingCanonical.length)
      } catch (err) {
        logServerEvent({
          category: 'agent',
          event: 'persist-failed',
          deckId: opts.deckId,
          errorMsg: (err as Error).message,
        })
        // 不抛 — agent_end 已 emit,SSE 已 close,DB fail 用户 refresh 才感知
      }
    }
  })

  return agent
}

function resolveThinkingLevel(
  settings: ReturnType<typeof parseLlmSettings>,
  providerId: string,
): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  // 优先级: provider-specific advanced > common > 默认 'off'
  const a = settings.advanced
  if (!a) return 'off'
  const providerSpec = (a[providerId as keyof typeof a] as { thinkingLevel?: string } | undefined)
  if (providerSpec?.thinkingLevel) return providerSpec.thinkingLevel as never
  if (a.common?.thinkingLevel) return a.common.thinkingLevel as never
  return 'off'
}
```

注意：`resolveModelForProvider` / `loadDeckChatHistory` 需要在依赖里支持：

- `resolveModelForProvider`：在 `pi-ai-adapter.ts` 加 public export，复用 `defaultResolver` 逻辑（含 `PI_AI_PROVIDER_MAP` 翻译 + `getDefaultModel` fallback + baseUrl override）。Phase 12.5 已实现内部 helper，本 Task 拉出来 export。
- `loadDeckChatHistory(deckId)`：新增 helper 文件 `packages/agent/src/llm/agent/history-loader.ts`：从 `deck_chats` 读 `canonicalContent` 列 → 转 `CanonicalMessage[]`。复用 Phase 12 Task F 的 `chat-row.ts:rowToCanonical`。

- [ ] **Step 2：实现 persistence**

`packages/agent/src/llm/agent/persistence.ts`：

```ts
/**
 * Phase 12.7 Task C: agent_end 后 batch 写 deck_chats。
 *
 * 入参 allMessages 是 agent state 全 messages 数组(含已存 + 本 turn 新增);
 * existingCount 是 createAgent 时 load 的历史长度。
 * 取 allMessages.slice(existingCount) 即本 turn 新 messages,转 canonical 入 DB。
 *
 * 单 transaction 批量 insert,失败回滚不影响 SSE 已 emit 的 turn.end 事件。
 */
import { getDb } from '../../db/client.js'
import { deckChats } from '../../db/schema.js'
import type { CanonicalMessage } from '../types.js'
import { canonicalToRow } from '../chat-row.js'

export async function persistTurnToDeckChats(
  deckId: number,
  allMessages: CanonicalMessage[],
  existingCount: number,
): Promise<void> {
  if (allMessages.length <= existingCount) return  // 没新 message,noop

  const newMessages = allMessages.slice(existingCount)
  const db = getDb()

  await db.transaction(async (tx) => {
    for (const m of newMessages) {
      const { content, toolCallId, canonicalContent } = canonicalToRow(m)
      await tx.insert(deckChats).values({
        deckId,
        role: m.role,
        content,
        toolCallId,
        canonicalContent,
      })
    }
  })
}
```

注：drizzle-orm 的 `db.transaction` 在 mysql2 driver 上支持；Phase 12 Task F 的 migration scripts 用过同款 API。

- [ ] **Step 3：写 persistence 集成测**

`packages/agent/src/llm/agent/__tests__/persistence.test.ts`（用 `lumideck_test` 真 DB）：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTestDb } from '../../../../test/_setup/integration.js'
import { getDb } from '../../../db/client.js'
import { deckChats, decks, users } from '../../../db/schema.js'
import { eq } from 'drizzle-orm'
import { persistTurnToDeckChats } from '../persistence.js'
import type { CanonicalMessage } from '../../types.js'

describe('persistence: persistTurnToDeckChats', () => {
  useTestDb()
  let deckId: number

  beforeEach(async () => {
    const db = getDb()
    await db.insert(users).values({
      email: 'p127@test.com',
      passwordHash: 'x',
    })
    const [u] = await db.select().from(users).where(eq(users.email, 'p127@test.com')).limit(1)
    const [d] = await db
      .insert(decks)
      .values({ userId: u!.id, title: 'test', templateId: 'beitou-standard' })
      .$returningId()
    deckId = d!.id
  })

  it('inserts new messages slicing existingCount', async () => {
    const all: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 't1',
            content: [{ type: 'text', text: 'result' }],
            isError: false,
          },
        ],
      },
    ]
    await persistTurnToDeckChats(deckId, all, 0)  // existingCount=0,全 3 条入库
    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(3)
    expect(rows[0]?.role).toBe('user')
    expect(rows[1]?.role).toBe('assistant')
    expect(rows[2]?.role).toBe('tool')
    expect(rows[1]?.canonicalContent).toContain('tool_use')
  })

  it('skips when allMessages.length <= existingCount', async () => {
    await persistTurnToDeckChats(deckId, [], 0)
    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(0)
  })

  it('only persists messages beyond existingCount', async () => {
    const all: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'first turn user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first turn ai' }] },
      { role: 'user', content: [{ type: 'text', text: 'second turn user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'second turn ai' }] },
    ]
    await persistTurnToDeckChats(deckId, all, 2)  // 前 2 条已存,只写后 2 条
    const db = getDb()
    const rows = await db
      .select()
      .from(deckChats)
      .where(eq(deckChats.deckId, deckId))
      .orderBy(deckChats.createdAt)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.content).toContain('second turn user')
    expect(rows[1]?.content).toContain('second turn ai')
  })

  it('transaction rolls back on insert error', async () => {
    // 构造一条非法 message(role 不在 enum 里)触发 DB constraint 失败
    const all: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'ok' }] },
      { role: 'invalid' as never, content: [{ type: 'text', text: 'bad' }] },
    ]
    await expect(persistTurnToDeckChats(deckId, all, 0)).rejects.toThrow()
    // 验证第一条没残留(transaction 回滚)
    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 4：写 createAgent 单测**

`packages/agent/src/llm/agent/__tests__/agent.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAgent } from '../index.js'
import * as toolBridge from '../tool-bridge.js'
import * as historyLoader from '../history-loader.js'
import * as systemPrompt from '../../../prompts/buildSystemPrompt.js'
import { encryptApiKey, __setMasterKeyGetterForTesting } from '../../../crypto/apikey.js'

describe('createAgent', () => {
  beforeAll(() => {
    __setMasterKeyGetterForTesting(() => Buffer.alloc(32, 'a'))
  })
  afterAll(() => __setMasterKeyGetterForTesting(null))
  afterEach(() => vi.restoreAllMocks())

  function makeSettings(opts: { thinkingLevel?: string; provider?: string } = {}) {
    const settings = {
      activeProvider: opts.provider ?? 'anthropic',
      providers: { [opts.provider ?? 'anthropic']: { apiKey: 'sk-test' } },
      advanced: opts.thinkingLevel
        ? {
            [opts.provider ?? 'anthropic']: { thinkingLevel: opts.thinkingLevel },
          }
        : undefined,
    }
    return encryptApiKey(JSON.stringify(settings))
  }

  it('constructs Agent with sessionId formatted as lumideck:user-X:deck-Y', async () => {
    vi.spyOn(toolBridge, 'buildToolsForUser').mockResolvedValue([])
    vi.spyOn(historyLoader, 'loadDeckChatHistory').mockResolvedValue([])
    vi.spyOn(systemPrompt, 'buildSystemPromptForDeck').mockResolvedValue('You are helpful.')
    const agent = await createAgent({
      userId: 42,
      deckId: 7,
      encryptedSettings: makeSettings(),
      signal: new AbortController().signal,
    })
    expect((agent as never as { sessionId: string }).sessionId).toBe('lumideck:user-42:deck-7')
  })

  it('uses parallel tool execution', async () => {
    vi.spyOn(toolBridge, 'buildToolsForUser').mockResolvedValue([])
    vi.spyOn(historyLoader, 'loadDeckChatHistory').mockResolvedValue([])
    vi.spyOn(systemPrompt, 'buildSystemPromptForDeck').mockResolvedValue('')
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings(),
      signal: new AbortController().signal,
    })
    expect((agent as never as { toolExecution: string }).toolExecution).toBe('parallel')
  })

  it('resolves thinkingLevel from advanced.<provider>', async () => {
    vi.spyOn(toolBridge, 'buildToolsForUser').mockResolvedValue([])
    vi.spyOn(historyLoader, 'loadDeckChatHistory').mockResolvedValue([])
    vi.spyOn(systemPrompt, 'buildSystemPromptForDeck').mockResolvedValue('')
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings({ thinkingLevel: 'high', provider: 'anthropic' }),
      signal: new AbortController().signal,
    })
    expect(agent.state.thinkingLevel).toBe('high')
  })

  it('falls back to off when no advanced settings', async () => {
    vi.spyOn(toolBridge, 'buildToolsForUser').mockResolvedValue([])
    vi.spyOn(historyLoader, 'loadDeckChatHistory').mockResolvedValue([])
    vi.spyOn(systemPrompt, 'buildSystemPromptForDeck').mockResolvedValue('')
    const agent = await createAgent({
      userId: 1,
      deckId: 1,
      encryptedSettings: makeSettings(),
      signal: new AbortController().signal,
    })
    expect(agent.state.thinkingLevel).toBe('off')
  })

  it('throws when active provider not configured', async () => {
    const broken = encryptApiKey(JSON.stringify({ activeProvider: 'anthropic', providers: {} }))
    await expect(
      createAgent({
        userId: 1,
        deckId: 1,
        encryptedSettings: broken,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/LLM 未配置/)
  })
})
```

- [ ] **Step 5：跑测 + commit**

```bash
pnpm -F @big-ppt/agent vitest run src/llm/agent/__tests__/ 2>&1 | tail -10
pnpm -F @big-ppt/agent type-check 2>&1 | tail -3
```

预期：persistence 4 + createAgent 5 + 前 Task 14 = 23 测全过。

```bash
git status
git add packages/agent/src/llm/agent/index.ts \
        packages/agent/src/llm/agent/persistence.ts \
        packages/agent/src/llm/agent/history-loader.ts \
        packages/agent/src/llm/agent/__tests__/persistence.test.ts \
        packages/agent/src/llm/agent/__tests__/agent.test.ts \
        packages/agent/src/llm/adapters/pi-ai-adapter.ts
git commit -m "$(cat <<'COMMIT'
feat(phase12.7-C): createAgent factory + persistence hook + 9 测

createAgent:
- 构造 pi-agent-core Agent 实例:streamFn=piAi.stream / tools=buildToolsForUser /
  sessionId=`lumideck:user-${id}:deck-${id}` / toolExecution='parallel'
- beforeToolCall / afterToolCall hooks 落 audit log(logServerEvent
  category='agent'),不 block
- initialState 含 systemPrompt(复用 prompts/buildSystemPrompt) + thinkingLevel
  (从 advanced 解析,fallback 'off') + 已有 messages(loadDeckChatHistory)
- agent.subscribe('agent_end') 自动 persistTurnToDeckChats

persistence:
- agent_end 后 batch 写 deck_chats(canonical Block[] JSON 列 + 旧 content
  字段兼容期保留),单 transaction 失败回滚
- existingCount slice 计算 turn 增量,避免重复写历史

history-loader: 新 helper 从 deck_chats 读 canonical messages 给 Agent
initialState.messages。

pi-ai-adapter.ts: export resolveModelForProvider 公开内部 helper 给 createAgent
复用(含 provider id 翻译 + baseUrl override),Phase 12.5 时为 internal。

单测 9 测(4 persistence 真 DB 集成 + 5 createAgent unit)全过。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

**验证方法**：

- 9 新测 + 前 14 测 = 23 全绿
- coverage createAgent / persistence / history-loader ≥ 90/85
- type-check 干净

**风险**：

- pi-agent-core Agent constructor 签名实际跟 spec 假设可能偏（initialState shape / streamFn 函数签名）—— 实施期看 dist/types.d.ts 修正
- `db.transaction` 在 drizzle mysql2 driver 上的语法（block 形式还是 callback 形式） —— 实施期确认
- `resolveModelForProvider` export 名跟 Phase 12.5 内部命名可能不一致 —— 看实际代码改 export

---

### Task D：translate-events（pi-agent-core event → canonical event）

**目的**：实现 `translateAgentStream(agent, prompt)` async generator，把 pi-agent-core subscribe-based event 转 pull-based canonical event 流。

**Files：**
- Modify: `packages/agent/src/llm/agent/translate-events.ts`
- Create: `packages/agent/src/llm/agent/__tests__/translate-events.test.ts`

**操作**：

- [ ] **Step 1：实现 translateAgentStream**

`packages/agent/src/llm/agent/translate-events.ts`：

```ts
/**
 * Phase 12.7 Task D: pi-agent-core push-based event → canonical pull-based async generator。
 *
 * pi-agent-core 用 agent.subscribe(handler) 推事件,我们要 yield 给 SSE。
 * 用 buffer queue + promise resolve 模式:subscribe 把事件推 queue,generator
 * await queue.shift() 拉。结束信号:agent_end / error。
 *
 * 11 类 pi-agent-core event → 13 类 canonical event 映射(见 spec §5)。
 */
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { CanonicalEvent } from '../types.js'

export async function* translateAgentStream(
  agent: Agent,
  prompt: string,
): AsyncGenerator<CanonicalEvent> {
  // buffer queue:subscribe 推 events,generator 拉
  const queue: AgentEvent[] = []
  let resolveNext: (() => void) | null = null
  let ended = false
  let errored: Error | null = null

  const unsubscribe = agent.subscribe(async (event) => {
    queue.push(event)
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  })

  // 触发 agent.prompt(注意:不 await,让事件流通过 subscribe push)
  agent.prompt(prompt).catch((err: Error) => {
    errored = err
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  })

  try {
    let turnId: string | null = null
    const toolCallNameById = new Map<string, string>()

    while (!ended) {
      if (queue.length === 0) {
        if (errored) throw errored
        await new Promise<void>((resolve) => {
          resolveNext = resolve
        })
        if (errored) throw errored
      }
      const event = queue.shift()
      if (!event) continue

      // 映射逻辑
      yield* mapEvent(event, { turnIdRef: { current: turnId }, toolCallNameById })

      // 更新 turnId 引用
      if (event.type === 'agent_start') turnId = generateTurnId()

      // 终结条件
      if (event.type === 'agent_end') {
        ended = true
        break
      }
    }
  } finally {
    unsubscribe()
  }
}

function generateTurnId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function* mapEvent(
  event: AgentEvent,
  state: { turnIdRef: { current: string | null }; toolCallNameById: Map<string, string> },
): Generator<CanonicalEvent> {
  switch (event.type) {
    case 'agent_start': {
      const id = generateTurnId()
      state.turnIdRef.current = id
      yield { type: 'turn.start', turnId: id }
      return
    }

    case 'turn_start':
    case 'turn_end':
    case 'message_start':
    case 'message_end':
      return  // drop(内部 turn/message 边界,canonical 用 agent 维度的 turn.start/end)

    case 'message_update': {
      const inner = event.assistantMessageEvent
      if (!inner) return
      switch (inner.type) {
        case 'text_delta':
          yield { type: 'text.delta', text: inner.delta }
          return
        case 'thinking_delta':
          yield { type: 'thinking.delta', text: inner.delta }
          return
        case 'toolcall_start': {
          // partial.content[contentIndex] 取 id+name
          const partial = (inner as { partial?: { content?: { type: string; id?: string; name?: string }[] } }).partial
          const item = partial?.content?.[(inner as { contentIndex: number }).contentIndex]
          if (item?.type !== 'toolCall' || !item.id || !item.name) return
          state.toolCallNameById.set(item.id, item.name)
          yield { type: 'tool_call.start', id: item.id, name: item.name }
          return
        }
        case 'toolcall_delta': {
          const partial = (inner as { partial?: { content?: { type: string; id?: string }[] } }).partial
          const item = partial?.content?.[(inner as { contentIndex: number }).contentIndex]
          if (item?.type !== 'toolCall' || !item.id) return
          yield { type: 'tool_call.delta', id: item.id, argsChunk: (inner as { delta: string }).delta }
          return
        }
        case 'toolcall_end': {
          const partial = (inner as { partial?: { content?: { type: string; id?: string }[] } }).partial
          const item = partial?.content?.[(inner as { contentIndex: number }).contentIndex]
          if (item?.type !== 'toolCall' || !item.id) return
          yield { type: 'tool_call.end', id: item.id }
          return
        }
        default:
          return
      }
    }

    case 'tool_execution_start':
      yield {
        type: 'tool_execution.start',
        toolCallId: (event as { toolCallId: string }).toolCallId,
        toolName: (event as { toolName: string }).toolName,
      }
      return

    case 'tool_execution_update':
      yield {
        type: 'tool_execution.delta',
        toolCallId: (event as { toolCallId: string }).toolCallId,
        partial: (event as { partialResult: unknown }).partialResult,
      }
      return

    case 'tool_execution_end':
      yield {
        type: 'tool_execution.end',
        toolCallId: (event as { toolCallId: string }).toolCallId,
        isError: (event as { isError?: boolean }).isError ?? false,
      }
      return

    case 'agent_end': {
      // 提取 final usage / cache.hit
      const lastMsg = (event as { messages: { usage?: { cacheRead?: number; input?: number } }[] }).messages.at(-1)
      const usage = lastMsg?.usage
      if (usage && usage.cacheRead && usage.cacheRead > 0) {
        yield {
          type: 'cache.hit',
          cachedTokens: usage.cacheRead,
          costTokens: usage.input ?? 0,
        }
      }
      yield {
        type: 'turn.end',
        usage: {
          input: usage?.input ?? 0,
          output: (usage as { output?: number } | undefined)?.output ?? 0,
          ...(usage?.cacheRead ? { cached: usage.cacheRead } : {}),
          ...((usage as { cost?: unknown } | undefined)?.cost
            ? { cost: (usage as { cost: never }).cost }
            : {}),
        },
        reason: 'stop',  // pi-agent-core 没显式 finishReason at agent_end;默认 stop,真 reason 由 message_end 携带,可后续提取
      }
      return
    }

    case 'error': {
      const inner = (event as { error?: { errorMessage?: string }; reason?: string }).error
      yield {
        type: 'error',
        code: 'unknown',
        message: inner?.errorMessage ?? `agent error: ${(event as { reason?: string }).reason ?? 'unknown'}`,
      }
      return
    }
  }
}
```

- [ ] **Step 2：写 translate-events 单测**

`packages/agent/src/llm/agent/__tests__/translate-events.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { translateAgentStream } from '../translate-events.js'
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'

/** 构造 fake Agent: subscribe 注册 handler,prompt 调用时按脚本同步推事件 */
function fakeAgent(scriptedEvents: AgentEvent[]): Agent {
  const handlers: ((e: AgentEvent) => void)[] = []
  return {
    subscribe: (handler) => {
      handlers.push(handler as never)
      return () => {
        const i = handlers.indexOf(handler as never)
        if (i >= 0) handlers.splice(i, 1)
      }
    },
    prompt: async () => {
      for (const e of scriptedEvents) {
        for (const h of handlers) h(e)
        await new Promise((r) => setTimeout(r, 0))  // yield event loop
      }
    },
  } as never
}

async function collect(stream: AsyncGenerator<unknown>) {
  const events: unknown[] = []
  for await (const e of stream) events.push(e)
  return events
}

describe('translateAgentStream: simple text', () => {
  it('agent_start → turn.start; message_update.text_delta → text.delta; agent_end → turn.end', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' } as never,
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as never,
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: ' world' },
      } as never,
      { type: 'agent_end', messages: [] } as never,
    ])
    const events = await collect(translateAgentStream(agent, 'hi'))
    const types = events.map((e: never) => (e as { type: string }).type)
    expect(types).toEqual(['turn.start', 'text.delta', 'text.delta', 'turn.end'])
  })
})

describe('translateAgentStream: tool call + tool execution', () => {
  it('emits tool_call + tool_execution event pairs', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' } as never,
      {
        type: 'message_update',
        contentIndex: 0,
        assistantMessageEvent: {
          type: 'toolcall_start',
          partial: { content: [{ type: 'toolCall', id: 'call_1', name: 'get_weather' }] },
        },
      } as never,
      {
        type: 'message_update',
        contentIndex: 0,
        assistantMessageEvent: {
          type: 'toolcall_delta',
          delta: '{"loc":',
          partial: { content: [{ type: 'toolCall', id: 'call_1' }] },
        },
      } as never,
      {
        type: 'message_update',
        contentIndex: 0,
        assistantMessageEvent: {
          type: 'toolcall_end',
          partial: { content: [{ type: 'toolCall', id: 'call_1' }] },
        },
      } as never,
      { type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'get_weather' } as never,
      { type: 'tool_execution_end', toolCallId: 'call_1', isError: false } as never,
      { type: 'agent_end', messages: [] } as never,
    ])
    const events = await collect(translateAgentStream(agent, 'weather?'))
    const types = events.map((e: never) => (e as { type: string }).type)
    expect(types).toContain('tool_call.start')
    expect(types).toContain('tool_call.delta')
    expect(types).toContain('tool_call.end')
    expect(types).toContain('tool_execution.start')
    expect(types).toContain('tool_execution.end')
  })
})

describe('translateAgentStream: thinking', () => {
  it('thinking_delta → thinking.delta', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' } as never,
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'pondering...' },
      } as never,
      { type: 'agent_end', messages: [] } as never,
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    expect((events[1] as { type: string }).type).toBe('thinking.delta')
    expect((events[1] as { text: string }).text).toBe('pondering...')
  })
})

describe('translateAgentStream: cache hit', () => {
  it('agent_end with usage.cacheRead > 0 emits cache.hit before turn.end', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' } as never,
      {
        type: 'agent_end',
        messages: [{ usage: { cacheRead: 1500, input: 200, output: 50 } }],
      } as never,
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    const types = events.map((e: never) => (e as { type: string }).type)
    expect(types).toEqual(['turn.start', 'cache.hit', 'turn.end'])
    const cacheHit = events[1] as { cachedTokens: number; costTokens: number }
    expect(cacheHit.cachedTokens).toBe(1500)
    expect(cacheHit.costTokens).toBe(200)
  })
})

describe('translateAgentStream: error', () => {
  it('error event → canonical error', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' } as never,
      { type: 'error', reason: 'error', error: { errorMessage: 'rate limited' } } as never,
      { type: 'agent_end', messages: [] } as never,
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    const errorEvt = events.find((e: never) => (e as { type: string }).type === 'error')
    expect(errorEvt).toBeDefined()
    expect((errorEvt as { message: string }).message).toBe('rate limited')
  })
})

describe('translateAgentStream: prompt() rejection', () => {
  it('agent.prompt throw → generator throws', async () => {
    const agent = {
      subscribe: () => () => {},
      prompt: async () => {
        throw new Error('boom')
      },
    } as never
    await expect(collect(translateAgentStream(agent, 'q'))).rejects.toThrow('boom')
  })
})

describe('translateAgentStream: drop internal turn/message events', () => {
  it('turn_start / turn_end / message_start / message_end all dropped', async () => {
    const agent = fakeAgent([
      { type: 'agent_start' } as never,
      { type: 'turn_start' } as never,
      { type: 'message_start' } as never,
      { type: 'message_end' } as never,
      { type: 'turn_end', toolResults: [] } as never,
      { type: 'agent_end', messages: [] } as never,
    ])
    const events = await collect(translateAgentStream(agent, 'q'))
    const types = events.map((e: never) => (e as { type: string }).type)
    expect(types).toEqual(['turn.start', 'turn.end'])  // 内部全部 drop
  })
})
```

- [ ] **Step 3：跑测 + commit**

```bash
pnpm -F @big-ppt/agent vitest run src/llm/agent/__tests__/translate-events.test.ts 2>&1 | tail -5
```

预期：7 测全过。

```bash
git status
git add packages/agent/src/llm/agent/translate-events.ts \
        packages/agent/src/llm/agent/__tests__/translate-events.test.ts
git commit -m "$(cat <<'COMMIT'
feat(phase12.7-D): translate-events pi-agent-core → canonical event 映射 + 7 测

translateAgentStream:
- 用 buffer queue + promise resolve pattern 把 pi-agent-core subscribe push
  转 async generator pull,适配 eventsToSSEStream 上游
- agent_start → turn.start(生成 turnId);agent_end → cache.hit (if cacheRead>0)
  + turn.end(usage 提取);message_update.{text,thinking,toolcall}_delta →
  对应 canonical event;tool_execution_{start,update,end} → canonical 同类
- 内部 turn_start / turn_end / message_start / message_end / done event 全 drop
  (canonical 用 agent 维度的 turn.start/end 表达)
- error event in-stream 直接转 canonical error

7 测覆盖:simple text / tool call + execution / thinking / cache hit /
error in-stream / prompt() reject / internal event drop。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

**风险**：

- pi-agent-core `assistantMessageEvent` 字段结构跟 spec 假设可能偏 —— 实施期看真实 type 改 mapping
- agent.prompt() 同步触发还是 async 返 promise —— spec 假设是 async，若是同步阻塞需要在 helper 内 wrap

---

### Task E：thinkingLevel schema migration + Settings UI

**目的**：扩 `LlmSettingsSchema` 加 `ThinkingLevelSchema`，写一次性 migration script + 兼容期 helper；改 Settings UI 三处 thinkingEnabled checkbox 为 thinkingLevel select 6 选 1。

**Files：**
- Modify: `packages/agent/src/llm/settings.ts`
- Modify: `packages/agent/src/llm/migrations.ts`
- Create: `packages/agent/scripts/migrate-thinking-level.mjs`
- Create: `packages/agent/test/integration/migrate-thinking-level.test.ts`
- Modify: `packages/agent/src/llm/__tests__/settings.test.ts`（加 thinkingLevel 校验测）
- Modify: `packages/creator/src/components/SettingsModal.vue`
- Modify: `packages/creator/test/SettingsModal.save.test.ts`
- Modify: `packages/agent/package.json`（加 migrate:thinking-level 3 env script）

**操作**（关键点列举，code 量类比 Phase 12 Task F，不重复完整 paste）：

- [ ] **Step 1：扩 settings.ts schema**

加 `ThinkingLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])`；`AdvancedAnthropicSchema` / `AdvancedGeminiSchema` / `AdvancedCommonSchema` 字段 `thinkingEnabled` → `thinkingLevel`（optional）；`getActiveProviderConfig` 内部 normalize 时若读到 boolean `thinkingEnabled` 兜底转 `'off'` / `'medium'`（兼容期防 migration 未跑炸）。

- [ ] **Step 2：写 migrateThinkingEnabledToLevel helper + script**

类比 Phase 12 Task F 的 `migrateLegacySettings`，写一次性脚本（dist/ + .mjs wrapper）+ 集成测真 DB 跑全链路。

- [ ] **Step 3：跑 dev / test 库 migration**

```bash
pnpm -F @big-ppt/agent build  # 编译 dist/
pnpm -F @big-ppt/agent migrate:thinking-level  # dev
pnpm -F @big-ppt/agent migrate:thinking-level:test  # test
```

预期：所有 user.llm_settings 老 boolean shape 转 enum shape。

- [ ] **Step 4：Settings UI 三处 checkbox 改 select**

`packages/creator/src/components/SettingsModal.vue` advanced 子区：

- 之前：`<input type="checkbox" v-model="form.advanced.anthropic.thinkingEnabled">`
- 之后：

```vue
<label>
  Thinking 级别
  <select v-model="form.advanced.anthropic.thinkingLevel">
    <option value="off">关闭</option>
    <option value="minimal">最少</option>
    <option value="low">低</option>
    <option value="medium">中等</option>
    <option value="high">高</option>
    <option value="xhigh">极高</option>
  </select>
</label>
```

同样改造 Gemini / common 区。

- [ ] **Step 5：测试 + commit**

更新 `SettingsModal.save.test.ts` 断言 select value；加 settings.test.ts 的 6 个新 thinkingLevel zod 校验测；跑 agent 全测 + creator 全测。

```bash
git add packages/agent/src/llm/settings.ts packages/agent/src/llm/migrations.ts \
        packages/agent/scripts/migrate-thinking-level.mjs \
        packages/agent/test/integration/migrate-thinking-level.test.ts \
        packages/agent/src/llm/__tests__/settings.test.ts \
        packages/creator/src/components/SettingsModal.vue \
        packages/creator/test/SettingsModal.save.test.ts \
        packages/agent/package.json
git commit -m "feat(phase12.7-E): thinkingLevel 6 档替换 thinkingEnabled boolean..."
```

**验证方法**：

- settings.test 新增 6 测 + migration 集成测 4 测 + SettingsModal.save 调整 6 测全过
- dev + test 库 migration 跑通
- 全 agent / creator 测套不破坏

**风险**：

- 同时打开多个 dev session 时一边跑 migration 一边用户编辑 settings → 写冲突 —— migration 设计幂等 + 用 SELECT FOR UPDATE 锁单 row
- 老 boolean shape 兼容期 helper 漏读某条路径 → Settings UI 显示空 thinkingLevel 默认 'off'（接受 fallback）

---

### Task F：POST /api/chat/turn route + runAgentAsGenerator

**目的**：实现 `POST /api/chat/turn` route 端到端；mount 进 app.ts；写集成测（fake agent 注入）。

**Files：**
- Modify: `packages/agent/src/llm/agent/index.ts`（加 testing seam `__setCreateAgentForTesting`）
- Create: `packages/agent/src/routes/chat.ts`
- Modify: `packages/agent/src/app.ts`（mount）
- Create: `packages/agent/test/integration/chat-turn.test.ts`

**操作**：

- [ ] **Step 1：实现 routes/chat.ts**

```ts
// packages/agent/src/routes/chat.ts
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import type { AuthVars } from '../middleware/auth.js'
import { acquireLlmSlot, LlmConcurrencyTimeoutError } from '../middleware/llm-semaphore.js'
import { createAgent } from '../llm/agent/index.js'
import { translateAgentStream } from '../llm/agent/translate-events.js'
import { eventsToSSEStream } from '../llm/canonical-sse.js'
import { LLMError } from '../llm/errors.js'
import { getDb } from '../db/client.js'
import { decks } from '../db/schema.js'
import { logServerEvent } from '../logger/server-log.js'

export const chat = new Hono<{ Variables: AuthVars }>()

chat.post('/turn', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)
  if (!user.llmSettings) {
    return c.json({ error: { message: '请先在设置中配置 LLM API Key' } }, 400)
  }

  const body = (await c.req.json()) as { deckId: number; message: string }
  const deckId = Number(body.deckId)
  if (!deckId || isNaN(deckId)) return c.json({ error: { message: 'deckId 必填' } }, 400)
  if (!body.message?.trim()) return c.json({ error: { message: 'message 必填' } }, 400)

  // 验权:用户拥有该 deck
  const [deck] = await getDb()
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, user.id)))
    .limit(1)
  if (!deck) return c.json({ error: { message: 'deck not found' } }, 404)

  let release: () => void
  try {
    release = await acquireLlmSlot(user.id)
  } catch (e) {
    if (e instanceof LlmConcurrencyTimeoutError) return c.json({ error: { message: e.message } }, 503)
    throw e
  }

  const clientSignal = c.req.raw.signal
  let agent
  try {
    agent = await createAgent({
      userId: user.id,
      deckId,
      encryptedSettings: user.llmSettings,
      signal: clientSignal,
    })
  } catch (e) {
    release()
    return c.json({ error: { message: (e as Error).message } }, 400)
  }

  // signal abort → agent.abort()
  clientSignal.addEventListener('abort', () => agent.abort())

  const events = (async function* () {
    try {
      yield* translateAgentStream(agent, body.message)
    } catch (e) {
      logServerEvent({
        category: 'agent',
        event: 'turn-failed',
        userId: user.id,
        deckId,
        code: e instanceof LLMError ? e.code : 'unknown',
        errorMsg: (e as Error).message,
      })
      throw e
    } finally {
      release()
    }
  })()

  const stream = eventsToSSEStream(events)
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
})

// testing seam
let _createAgent = createAgent
export function __setCreateAgentForTesting(fn: typeof createAgent | null): void {
  _createAgent = fn ?? createAgent
}
```

注意：`__setCreateAgentForTesting` 需 export 出去让 integration test 注入 fake agent；`chat.post` 内调用 `_createAgent` 而非直接 `createAgent`。

- [ ] **Step 2：mount in app.ts**

```ts
// packages/agent/src/app.ts
import { chat } from './routes/chat.js'
// ...
app.route('/api/chat', chat)
```

- [ ] **Step 3：写集成测**

集成测 9 个 case（类比 Phase 12 Task E 的 llm-route 9 测）：401 / 400 missing settings / 400 missing message / 400 missing deckId / 404 wrong deck owner / 503 concurrency / happy path SSE / abort 释放 slot / persistTurnToDeckChats 触发。

- [ ] **Step 4：跑测 + commit**

```bash
pnpm -F @big-ppt/agent vitest run test/integration/chat-turn.test.ts
```

预期：9 测全过。

```bash
git add packages/agent/src/routes/chat.ts \
        packages/agent/src/app.ts \
        packages/agent/test/integration/chat-turn.test.ts \
        packages/agent/src/llm/agent/index.ts
git commit -m "feat(phase12.7-F): POST /api/chat/turn route + 9 集成测..."
```

---

### Task G：frontend useAIChat 瘦身 + ToolExecutionBlock + chat.ts API

**目的**：frontend 1011 行重写到 ~300 行；新建 ToolExecutionBlock 组件；新建 `api/chat.ts` 取代部分 `api/llm.ts` 功能。

**Files：**
- Modify: `packages/creator/src/composables/useAIChat.ts`（大瘦身）
- Create: `packages/creator/src/components/ToolExecutionBlock.vue`
- Create: `packages/creator/src/api/chat.ts`
- Modify: `packages/creator/src/components/ChatPanel.vue`
- Modify: `packages/creator/src/api/llm.ts`（chatStream → chatStreamLegacy 重命名供 Settings 等非 agent 路径）
- Modify: `packages/creator/test/useAIChat.tool-loop.test.ts`（删/改）
- Create: `packages/creator/test/useAIChat.thin-consumer.test.ts`
- Create: `packages/creator/test/ToolExecutionBlock.test.ts`
- Modify: `packages/creator/test/ChatPanel.thinking-block.test.ts`（更新 tool_execution 测试）

**操作**（核心逻辑展示）：

- [ ] **Step 1：实现 `api/chat.ts`**

```ts
// packages/creator/src/api/chat.ts
import type { CanonicalChatRequest } from '@big-ppt/shared'

export async function chatTurn(
  req: { deckId: number; message: string },
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  const res = await fetch('/api/chat/turn', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: options.signal,
  })
  if (!res.ok && res.status !== 200) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `chat/turn failed: ${res.status}`)
  }
  return res
}
```

- [ ] **Step 2：实现 `ToolExecutionBlock.vue`**

```vue
<template>
  <div class="tool-execution-block" :class="{ pending: state === 'pending', running: state === 'running', done: state === 'done', error: state === 'error' }">
    <div class="tool-exec-header">
      <span class="tool-name">{{ toolName }}</span>
      <span class="tool-state">{{ stateLabel }}</span>
    </div>
    <details v-if="hasDetails" class="tool-exec-details">
      <summary>查看详情</summary>
      <pre v-if="argsPreview">{{ argsPreview }}</pre>
      <pre v-if="resultPreview">{{ resultPreview }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  toolName: string
  state: 'pending' | 'running' | 'done' | 'error'
  argsPreview?: string
  resultPreview?: string
}>()

const stateLabel = computed(() => ({
  pending: '排队中',
  running: '执行中',
  done: '完成',
  error: '失败',
}[props.state]))

const hasDetails = computed(() => Boolean(props.argsPreview || props.resultPreview))
</script>

<style scoped>
.tool-execution-block {
  font-size: var(--ld-font-size-xs, 12px);
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--ld-bg-subtle, #f5f5f5);
  margin: 4px 0;
}
.tool-execution-block.running { background: var(--ld-bg-info, #e8f4ff); }
.tool-execution-block.done { background: var(--ld-bg-success, #e8ffe8); }
.tool-execution-block.error { background: var(--ld-bg-danger, #ffe8e8); }
.tool-exec-header { display: flex; gap: 8px; align-items: center; }
.tool-name { font-weight: 500; }
.tool-state { color: var(--ld-color-text-muted, #888); }
.tool-exec-details pre { font-size: 11px; overflow-x: auto; }
</style>
```

- [ ] **Step 3：useAIChat 大瘦身**

完整重写到 ~300 行。结构：

```ts
// packages/creator/src/composables/useAIChat.ts (核心结构, ~300 行)
import { ref, computed, shallowRef } from 'vue'
import { decodeSSEStream } from '@big-ppt/shared'
import type { CanonicalEvent } from '@big-ppt/shared'
import { chatTurn } from '../api/chat.js'
import { useDecks } from './useDecks.js'

export function useAIChat() {
  const status = ref<'idle' | 'sending' | 'streaming' | 'error'>('idle')
  const streamingContent = ref('')
  const thinkingContent = ref('')
  const lastUsage = ref<TokenUsage | null>(null)
  const lastTurnId = ref<string | null>(null)
  const currentToolExecutions = shallowRef<Map<string, ToolExecutionState>>(new Map())
  const abortController = ref<AbortController | null>(null)
  const { refreshChats } = useDecks()

  async function sendMessage(deckId: number, message: string): Promise<void> {
    if (status.value !== 'idle') return  // 拒重入

    status.value = 'sending'
    streamingContent.value = ''
    thinkingContent.value = ''
    currentToolExecutions.value = new Map()
    lastUsage.value = null

    abortController.value = new AbortController()
    try {
      const res = await chatTurn({ deckId, message }, { signal: abortController.value.signal })
      if (!res.body) throw new Error('no response body')
      status.value = 'streaming'

      for await (const event of decodeSSEStream(res.body)) {
        consumeEvent(event)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        status.value = 'idle'  // user cancel,silent
      } else {
        status.value = 'error'
        throw e
      }
    } finally {
      // 不管成功失败,刷历史(backend 已写 deck_chats)
      await refreshChats(deckId)
      abortController.value = null
    }
  }

  function consumeEvent(event: CanonicalEvent) {
    switch (event.type) {
      case 'turn.start':
        lastTurnId.value = event.turnId
        break
      case 'text.delta':
        streamingContent.value += event.text
        break
      case 'thinking.delta':
        thinkingContent.value += event.text
        break
      case 'tool_call.start':
      case 'tool_call.delta':
      case 'tool_call.end':
        // 这些 event 在 backend agent 内部组成 toolCall(message_update),frontend 不再累积 args
        // 仅用于流式 UI 提示;真 tool execution event 是下面 tool_execution.*
        break
      case 'tool_execution.start': {
        const map = new Map(currentToolExecutions.value)
        map.set(event.toolCallId, { toolName: event.toolName, state: 'running' })
        currentToolExecutions.value = map
        break
      }
      case 'tool_execution.delta': {
        // 可选:更新 partial result 预览
        break
      }
      case 'tool_execution.end': {
        const map = new Map(currentToolExecutions.value)
        const existing = map.get(event.toolCallId)
        if (existing) {
          map.set(event.toolCallId, { ...existing, state: event.isError ? 'error' : 'done' })
          currentToolExecutions.value = map
        }
        break
      }
      case 'cache.hit':
        // 跟随 lastUsage 一起 surface;cache.hit 在 turn.end 之前到
        break
      case 'turn.end':
        lastUsage.value = event.usage
        status.value = 'idle'
        break
      case 'finish':
        // 非 agent 单轮调用兼容(本组件不应该收到,但兼容旧路径)
        lastUsage.value = event.usage
        status.value = 'idle'
        break
      case 'error':
        throw new Error(`agent error [${event.code}]: ${event.message}`)
    }
  }

  function cancel() {
    abortController.value?.abort()
  }

  return {
    status: computed(() => status.value),
    streamingContent: computed(() => streamingContent.value),
    thinkingContent: computed(() => thinkingContent.value),
    lastUsage: computed(() => lastUsage.value),
    currentToolExecutions: computed(() => currentToolExecutions.value),
    sendMessage,
    cancel,
  }
}

interface ToolExecutionState {
  toolName: string
  state: 'pending' | 'running' | 'done' | 'error'
  argsPreview?: string
  resultPreview?: string
}
```

注意：删 873 行的 OpenAI delta accumulator / arg buffer / finalizedToolCalls / executeTool / POST /api/decks/:id/chats 等所有 Phase 12 Task I 留下的 tool execution loop 内容。

- [ ] **Step 4：单测**

`useAIChat.thin-consumer.test.ts`：mock `chatTurn` 返一个 fake ReadableStream（包含编码后的 canonical events），验状态机正确处理 turn.start / text.delta / tool_execution.* / turn.end。

`ToolExecutionBlock.test.ts`：4 个状态渲染 + 折叠交互。

- [ ] **Step 5：删旧测试 + 集成测调整 + commit**

```bash
git rm packages/creator/test/useAIChat.tool-loop.test.ts
git rm packages/creator/test/useAIChat.canonical-consumer.test.ts  # 被 thin-consumer 取代
git add packages/creator/src/composables/useAIChat.ts \
        packages/creator/src/api/chat.ts \
        packages/creator/src/components/ToolExecutionBlock.vue \
        packages/creator/src/components/ChatPanel.vue \
        packages/creator/src/api/llm.ts \
        packages/creator/test/useAIChat.thin-consumer.test.ts \
        packages/creator/test/ToolExecutionBlock.test.ts \
        packages/creator/test/ChatPanel.thinking-block.test.ts
git commit -m "feat(phase12.7-G): frontend useAIChat 1011→300 行瘦身 + ToolExecutionBlock + api/chat.ts..."
```

**验证方法**：

- creator 全套测试不破坏（数量调整后大约 130+5（新 ToolExecutionBlock）-4（删的 useAIChat 老测）= 131+ 测）
- 浏览器手验：dev 启动 → 发消息看 streaming + tool_execution 渲染

**风险**：

- frontend useAIChat 大重写一旦 broken 影响用户主链路 —— Mock 单测覆盖 + 单 git commit 整体 revert 可行
- chat history 刷新时机：refreshChats 调早了可能没拿到刚写的 turn —— 在 turn.end 之后再 refresh

---

### Task H：dogfood + close-out + roadmap 更新

**目的**：本地多场景 dogfood；plan 28 close-out 三章节（执行期偏离 / 踩坑 / 测试数量）；roadmap Phase 12.7 状态更新；CLAUDE.md 已知坑同步。

**Files：**
- Modify: `docs/plans/28-phase12.7-pi-agent-core.md`（close-out）
- Modify: `docs/requirements/roadmap.md`（Phase 12.7 ✅）
- Modify: `CLAUDE.md`（pi-agent-core 已知坑提炼）

**操作**：

- [ ] **Step 1：本地 dogfood 场景**

跑：

```bash
pnpm dev
```

浏览器：
1. 创建 deck → 「生成 5 页 AI 历史 deck」→ 看多 tool 并发（dev terminal grep 'agent' / 'tool-call' / 'tool-result' 看 parallel）
2. 切模板 → 看 rewriteForTemplate 用 chatStreamLegacy（旧路径）跑通
3. 切 active provider 到 Anthropic + 连续 2 轮对话 → 看 cache.hit event 出现，frontend UsageStatsHint 显示「缓存命中 X tokens」
4. Settings thinkingLevel 切到 'high' + 再问一个复杂问题 → 看 thinking.delta 内容更多（vs 'off' 时几乎没有）
5. 故意触发工具失败（删 deck.id 后台改） → 看 ToolExecutionBlock 显示 error state

- [ ] **Step 2：填 plan 28 close-out 三章节**

记录 dogfood 期发现的：
- 执行期偏离（Task A-G 哪些 plan 说一样实施做另一样）
- 踩坑与解决（按「症状 / 根因 / 修复 / 防再犯」记）
- 测试数量落地表（agent / creator / shared / smoke 起点 vs 终点）

- [ ] **Step 3：roadmap 更新**

Phase 12.7 单独条目（参考 Phase 12.5 close-out 后 roadmap 怎么写的）：交付物 + 状态 ✅ + 依赖 + 不做什么 + 后续候选。

- [ ] **Step 4：CLAUDE.md 已知坑提炼**

dogfood 期发现的工具链 / 测试基建 / SDK 通用坑加进「LLM / Tool 工程」/「测试基建」章节。Phase 12.7 特定的（如 backend SSE + agent state 同步）按 plan 26 / 27 同款格式 phrasing。

- [ ] **Step 5：commit close-out**

```bash
git status
git add docs/plans/28-phase12.7-pi-agent-core.md \
        docs/requirements/roadmap.md \
        CLAUDE.md
git commit -m "docs(phase12.7-H): plan 28 close-out — 偏离 / 踩坑 / 测试数量 + CLAUDE.md 提炼 + roadmap..."
```

**验证方法**：

- 本地 dev 跑通 5 dogfood 场景
- 全量 `pnpm test` + `pnpm type-check` + `pnpm lint` + `pnpm build` 全绿
- git log `--oneline 2600f48..HEAD` 显示完整 Phase 12 + 12.5 + 12.7 commit 链

---

## 验收条件（roadmap.md Phase 12.7 清单映射）

- [ ] `@earendil-works/pi-agent-core@0.74.0` 装好（exact pin）
- [ ] `POST /api/chat/turn` route 端到端跑通（含 401 / 400 / 503 / abort）
- [ ] `packages/agent/src/llm/agent/` 5 个 source file + 4 个 test file 全部落地
- [ ] frontend `useAIChat.ts` ≤ 350 行（瘦身验收）
- [ ] backend agent on `agent_end` 写 `deck_chats`；frontend 不再 POST `/api/decks/:id/chats`（GET 仍正常）
- [ ] parallel tool execution 验证：多 tool 调用 dev log 显示并发起跑
- [ ] sessionId stable 验证：连续两 turn 同一 user/deck 看 Anthropic prompt cache 命中（`cache.hit` event 出现）
- [ ] beforeToolCall audit log 落 `logs/server-YYYY-MM-DD.jsonl`，grep `'tool-call'` 能找到
- [ ] terminate flag 路径验证：`generate_slide_image` 工具实现 `return { terminate: true }`，dev log 显示 turn 提前结束
- [ ] thinkingLevel 6 档：Settings UI select 切换 + DB migration 跑过 + 单测 + 集成测全过
- [ ] canonical event 5 类新加 + 13 类全套 round-trip 测过（含 SSE encode/decode）
- [ ] Mock 单测覆盖率：pi-agent-core 适配层 / tool-bridge / persistence / translate-events / agent-message 全部 ≥ 90 lines / 85 branches per-file
- [ ] 全套：agent ~820 tests + creator ~140 tests + shared 3 tests
- [ ] type-check / lint / build 全绿
- [ ] 浏览器手验「Claude 生成 5 页 deck（多 tool 并发可见）+ 切 Gemini 编辑 + thinkingLevel 切换 + cache.hit 显示」端到端 OK
- [ ] plan 28 close-out 三章节填完 + CLAUDE.md 已知坑同步 + roadmap Phase 12.7 ✅

---

## 不做什么（范围围栏）

- ❌ **transformContext compaction**：留候选（当前 chat 极少超 64K，无痛点）
- ❌ **steering UI**：留 Phase 13.x 候选独立 UI 设计
- ❌ **cross-provider handoff UI**：留 Phase 13.x 候选
- ❌ **Custom AgentMessage 类型**：纯重构无新价值
- ❌ **OAuth providers**：**永不做**——平台 ToS 禁止第三方 agent 集成
- ❌ **MCP catalog 扩展**：Phase 13 主体
- ❌ **删 `/api/decks/:id/chats` POST route**：兼容期保留 + log deprecated，Phase 14/15 再清理
- ❌ **删 `chatStreamLegacy`**：`rewriteForTemplate` / `rewriteSinglePageToComponents` 等非 agent 单轮 LLM call 仍依赖

---

## 执行期偏离（关闭后追加）

> 实际跑下来与 plan 不一致的点，写清"原 plan 怎么说 / 实际怎么做 / 为什么改"。

### Task A 偏离：扩 canonical event union 牵动 2 个 exhaustiveness site

- **原 plan**：Task A 是「最小破坏 commit」，只装依赖 + 加 5 个 event type + 落骨架
- **实际**：union 一扩 → `packages/agent/src/llm/__tests__/types.test.ts` 的 `assertNever` exhaustive 测试 + frontend `useAIChat.ts` 的 `consumeCanonicalEventStream` switch 必须同步加 5 个 case，否则 type-check 红测
- **why**：discriminated union 在 TypeScript 里 *任何* 显式 exhaustive 都会编译期红测，找全所有相关 site 一起改是必要前置工作；plan 假设 union 扩张「非破坏」是错的

### Task B 偏离：pi-agent-core 实际类型签名跟 plan 假设 7 处偏差

实施期发现 `@earendil-works/pi-agent-core@0.74.0` API 跟 plan 假设有以下 mismatch（沿用 Phase 12.5 Task B 「读 dist/types.d.ts」教训），逐条修：

1. `AgentMessage` role 用 camelCase `'toolResult'`，不是 plan 假设的 snake_case `'tool_result'`；canonical 端用 snake_case `'tool'`
2. ThinkingBlock 字段 pi 端是 `{thinking, thinkingSignature?, redacted?}`，canonical 端是 `{text}`（双向丢弃 signature/redacted）
3. ToolUseBlock 类型名 pi 用 `'toolCall'` (camelCase) + `arguments`，canonical 用 `'tool_use'` + `input`
4. `AgentTool.parameters` 声明 TSchema (typebox) 但 runtime 接 JSON Schema → `as unknown as TSchema` cast
5. `ToolResultMessage.toolName` 是 required 字段，但 canonical `tool_result` block 无 toolName 承载位置 → 翻译时占位空串（pi 用 toolCallId 配对足够）
6. registry 现有 `ToolDef.exec` 只接 args 返回 string，没有 plan 假设的 `{content, isError, terminate}` 三件套 → wrap 老接口而非改造 registry signature；ToolDef.exec 抛错由 pi-agent-core loop 内部翻译成 isError=true
7. tool-registry 公开 export 改名 `listToolDefsForUser` / `executeToolForUser`（plan 假设 `listToolsForUser` / `executeTool`），跟 `/api/tools` 路由现有公开 helper 区分（前者返完整 ToolDef 含 exec callback 给 agent 内部用，后者返 schema-only 给前端 UI）

### Task C 偏离 #1：集成测路径从 sibling __tests__ 挪到 test/integration/

- **原 plan**：单测 + 集成测都放 `packages/agent/src/llm/agent/__tests__/`
- **实际**：单测在 sibling __tests__，集成测（`agent-persistence.test.ts`）放 `packages/agent/test/integration/`
- **why**：tsconfig rootDir=`./src`，sibling __tests__ 无法 `import { useTestDb } from '../../../../test/_setup/test-db.js'`（rootDir 越界 → TS6059）；跟 `migrate-deck-chats.test.ts` / `migrate-llm-settings.test.ts` 同位

### Task C 偏离 #2：pi-agent-core API 跟 plan 假设 4 处偏差

- **原 plan**：`new Agent({ stream, tools, sessionId, beforeToolCall, ... })`
- **实际**: 
  1. `AgentOptions.initialState` 是 `Partial<Omit<AgentState, 'pendingToolCalls'|...>>`，thinkingLevel 直接走 ThinkingLevel union (`'off'|'minimal'|'low'|'medium'|'high'|'xhigh'`)
  2. `Agent.subscribe(listener)` listener 收 AgentEvent union（不是 plan 假设的 `(event, signal)` 2 参数）
  3. Agent 顶层 public 字段 `sessionId` / `toolExecution` / `state` (getter) 可直接读
  4. `streamFn` 跟 pi-ai `streamSimple` 签名对齐（不是 `stream`），`cast as StreamFn` 即可
- **why**：pi-agent-core 0.74.0 实际签名只能读 dist/types.d.ts 才准确；README 是 high-level 文档不到字段层

### Task C 偏离 #3：`buildSystemPromptForDeck` 签名

- **原 plan**：复用现有 `prompts/buildSystemPrompt` 的统一入口
- **实际**：现有 `buildSystemPrompt(deckId, mcpBadges?)` 是单参数，需要 `templateId` + image LLM 配置；新加 `buildSystemPromptForDeck(deckId, userId, mcpBadges?)` 入口包装查 decks.templateId + image-llm-settings 后调原函数
- **why**：纯前 commit 时漏想 createAgent 还需要 userId 作 ownership check + image-llm-settings 是 user-scoped；分两层（高层入口 query DB → 低层组装 prompt）保持低层纯

### Task D 偏离：error 走嵌套不是 top-level AgentEvent

- **原 plan**：plan 推断 pi-agent-core 有 top-level `'error'` AgentEvent type
- **实际**：error 走 `message_update.assistantMessageEvent.error`（嵌套）；`toolcall_end` 直接 carry toolCall 不需要后扫
- **why**：pi-agent-core 0.74.0 实际 event union 只有 11 类（不含 top-level error）；需要 assertNever 加 default guard 兜底
- **修**：commit `4c5b18c` 加 default 分支 + 重测 error scenario 走嵌套路径

### Task E 偏离 #1：grep all readers 漏 createAgent 路径

- **原 plan**：thinkingEnabled → thinkingLevel schema 升级 + 3 处 safeParse 点 plumb normalizeThinkingFields
- **实际**：Task C 已落地的 createAgent 内部 `resolveThinkingLevel(rawSettings.advanced)` 直接读老 boolean 字段，**绕过** schema 入口 → 老用户 `thinkingEnabled=true` 会被误判 `'off'` 直到 migration 跑完
- **修**：commit `a92254f` 在 resolveThinkingLevel 前补 `normalizeThinkingFields(rawSettings)` 兜底；2 测覆盖 legacy shape 入 createAgent
- **why**：memory `remove-session-field-grep-readers` 教训沿用——schema 字段语义改时必须全包 grep 字段名两次（reader + writer），Phase 12.5 Task F 已踩过同一坑这次又中

### Task E 偏离 #2：UI 域从 1 处扩到 3 处

- **原 plan**：SettingsModal 替换 anthropic `thinkingEnabled` 一处
- **实际**：spec §6 实际要求 3 域（anthropic / gemini / common）都给 thinkingLevel UI；UI scope 从 1 个 `<select>` 扩到 3 个独立字段（`thinkingLevelAnthropic` / `thinkingLevelGemini` / `thinkingLevelCommon`），buildPayload + loadSettings 共用 `resolveLegacyThinkingLevel` helper
- **修**：commit `6eeeb76` 补 Gemini + common 域 UI
- **why**：spec / plan 不同步——spec §6 后期加的，plan 没刷新

### Task F 偏离 #1：abort 路径单测改成验「agent.abort() 触发」

- **原 plan**：Test 8 abort 触发 → agent.abort() + slot 释放，断言「slot 已释放」
- **实际**：in-process `app.fetch(req)` 跟生产 undici fetch 在 stream cancel 时序上偏差大，slot 释放走 finally 但断言难稳定 → 改成只验 agent.abort() 被调用 + 走 wire（不再断言 slot 状态）
- **why**：plan 已知坑「in-process app.fetch 测 SSE abort 时序跟生产 undici 偏」沿用 Phase 12 Task E 教训；abort 路径单测只验 wire，slot 释放走 happy path 隐式覆盖

### Task F 偏离 #2：createAgent 错文案脱敏

- **原 plan**：createAgent throw → 400 + 原 e.message
- **实际**：code review 指出 `e.message` 可能含 crypto / SDK 实现细节（如「AES-GCM decryption failed」），改回 generic 「创建 AI 会话失败,请检查 LLM 配置」；raw error 走 logServerEvent('create-failed') 留服务端追踪
- **修**：commit `2656bfb`
- **why**：error message 直接回吐给前端属信息泄露，对应防御编码原则

### Task G 偏离 #1：image-gen 异步 polling 必须 frontend 接桥

- **原 plan**：useAIChat 大重写删 Phase 11.5 image polling，pi-agent-core canonical tool_execution.end 当工具完成
- **实际**：generate_slide_image 工具同步返 jobId 后 tool_execution.end 立即触发「done」状态，但 worker 异步还在跑、slide 图没出来 → 用户看到 chat 显示完成但 deck 仍空白
- **修**：commit `adae75b` 走 Option B (post-turn-refresh + 扫 deck_chats `success:true && jobId:string` 起 `useGenerateImageJob.start`)；`trackedImageJobIds` 跨 turn dedup
- **why**：扩 canonical event schema 影响所有 adapter 成本高；frontend 接桥是最小路径

### Task G 偏离 #2：useAIChat 最终 322 行（plan 目标 300）

- **原 plan**：1011 → ≤350 行
- **实际**：13f40c3 落地时 258 行（达成）；adae75b image-gen polling re-wire +53 行 → 311 行；3f844bb code review fix +11 行 → 322 行
- **why**：plan 350 行上限是 ballpark，322 行内含 polling 接桥 + dedup + 状态机 + audit logging，已是合理收敛；上 350 目标也是达成

### Task G 偏离 #3：删 api/llm.ts 整文件（plan 说改名 + 保留 chatStreamLegacy）

- **原 plan**：`chatStream` → `chatStreamLegacy` 改名，保留给「Settings 健康检查等非 agent 路径」未来使用
- **实际**：grep 全包发现 chatStreamLegacy **零调用方**（JSDoc 声称的 Settings 健康检查 caller 实际不存在），唯一活跃 export 就是这个改名 stub，整文件删干净不留死代码
- **修**：commit `3f844bb`
- **why**：code review 抓的「死 export 别留」原则；rewriteForTemplate 等非 agent 单轮 LLM call 走 backend `/api/llm/chat/completions` route 不依赖此 frontend helper

### Task G 偏离 #4：CSS token 用 `--color-*` 不是 `--ld-*`

- **原 plan / code review 反馈**：用 `--ld-*` Lumideck 设计 token
- **实际**：creator SPA 自身的 design token 在 `src/styles/tokens.css` 叫 `--color-*` / `--space-*` / `--fs-*`；`--ld-*` 是 Slidev 模板色板，仅在 `.slidev-layout` 子树 resolve（chat panel 渲染时不会命中）
- **修**：commit `adae75b` 用两层 fallback `--color-* → --ld-*`，跟 ThinkingBlock / UsageStatsHint 等 peer 一致

### Task H 偏离：单测 + 集成测的 master key 注入未还原（pre-existing flakiness）

- **原 plan**：Task H 只做 close-out / verification，不动测试代码
- **实际**：完整跑 `pnpm -F @big-ppt/agent test` 时观察到 routes-auth / mcp-server-repo / llm-models 等 2-9 个 case 偶发失败；定位是 `test/integration/chat-turn.test.ts` `beforeAll(__setMasterKeyGetterForTesting(FIXED_KEY))` 缺 `afterAll(... null)` 复位 → 模块级 `_keyGetter` 被污染漏到后续测试文件
- **修**：本 Task H 补 chat-turn.test.ts 的 `afterAll(() => __setMasterKeyGetterForTesting(null))`；附带修 `packages/creator/src/components/ToolExecutionBlock.vue` `vue/return-in-computed-property` lint 红测（switch 缺 default 返回值）
- **why**：Phase 12.7 新加的 chat-turn integration test 是 first new test 用此 testing seam 后**没有同文件再覆盖回**（之前的 routes-auth / db-image-llm-settings / tools-generate-slide-image 等都用 0xab/0xcd/0xef 各自的 FIXED_KEY 但没还原，碰巧后续测试也不调 decryptApiKey 所以隐式 OK）
- **防再犯**：见踩坑 6

---

## 踩坑与解决（实施期 / 关闭后追加）

> 按「症状 / 根因 / 修复 / 防再犯」四段记完整故事。
> **判断要不要提炼到 [CLAUDE.md 已知坑](../../CLAUDE.md#已知坑)**：换 Phase 还会撞的工具链 / 测试基建 / 构建系统坑才提炼。

### 坑 1：pi-agent-core 0.74.0 跟 README 字段名 / event 名 7 处偏差

- **症状**：Task B / C / D 按 spec & README 写完 tool-bridge / agent-message / createAgent / translate-events，type-check 红一片 + 运行时拿 undefined / 错字段
- **根因**：pi-agent-core 0.74.0 README 是 high-level 文档，确切签名要看 `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts`；同样的 lesson Phase 12.5 Task B 已踩过（pi-ai 8 处偏差，已上 CLAUDE.md），这次 pi-agent-core 又栽
- **修复**：Task B / C / D 逐条修—— `'toolResult'` (camelCase) / ThinkingBlock 字段名 `thinking` 不是 `text` / `'toolCall'` (camelCase) / TSchema cast / ToolResultMessage.toolName required / public sessionId/toolExecution/state getter / no top-level error event（走 message_update.assistantMessageEvent.error）
- **防再犯**：**已提炼到 CLAUDE.md「LLM / Tool 工程」**——升级任何 pi-* / @earendil-works/* 系列 SDK 前必读 `dist/types.d.ts`；README 仅作 hint，不作字段层契约

### 坑 2：thinkingLevel schema 升级漏 grep `createAgent` 这条 reader

- **症状**：Task E migration 跑过的老用户 + Task C 已 wire 的 createAgent 路径，运行时 `thinkingEnabled=true` 被误判 `'off'`（thinking 不触发）
- **根因**：Task E 已 plumb normalizeThinkingFields 到 `parseLlmSettings` + `GET /llm-settings` + `PUT /llm-settings` 三处 safeParse 入口；但 Task C 已落地的 createAgent 内部直接读 `rawSettings.advanced.<provider>.thinkingEnabled` 不走 schema → 老 boolean 不被 normalize 路径 catch
- **修复**：commit `a92254f` 在 createAgent `resolveThinkingLevel(rawSettings.advanced)` **前**补 `normalizeThinkingFields(rawSettings)`；2 测覆盖 legacy shape 入 createAgent
- **防再犯**：memory `remove-session-field-grep-readers` 教训沿用——schema 字段语义改时全包 grep 字段名两次（reader + writer），单测过不代表 HTTP 路径过。Phase 12.5 Task F 已踩过（llm_settings shape）这次 thinkingEnabled 再中，**已在 CLAUDE.md「LLM / Tool 工程」存档**

### 坑 3：discriminated union 扩张不是「非破坏」commit

- **症状**：Task A plan 自称「最小破坏 commit」装依赖 + 加 5 个 canonical event type，但提交后 type-check 立刻红 2 处（types.test.ts assertNever + useAIChat 的 consumeCanonicalEventStream switch）
- **根因**：TypeScript discriminated union exhaustive 检查在任何 `switch (event.type) { case ... default: assertNever(...) }` 都会强制要求所有成员覆盖；plan 把「加新 case」当成非破坏，但 default 分支的 type narrow 让旧编译期红测
- **修复**：commit `79550f1` 加新 case 时**同时**更新 2 个 exhaustiveness site；frontend useAIChat 给 5 个 fallthrough case 静默跳过（agent path 跑 turn / tool_execution event，单轮 path 不会见到）
- **防再犯**：**已提炼到 CLAUDE.md「LLM / Tool 工程」**——下次扩任何 discriminated union 必先全包 grep `assertNever` / `case never` / `default:`，找全所有 exhaustiveness site 算入 PR 总改动量

### 坑 4：in-process `app.fetch(req)` 测 SSE abort 时序跟生产 undici 偏

- **症状**：Task F Test 8「客户端 abort 触发 agent.abort() + slot 释放」原计划用 fixed 50ms sleep 等待 → CI 时序抖动假阳
- **根因**：in-process Hono `app.fetch(req)` 在 stream cancellation 路径上跟真实 undici fetch 不一致——前者 `req.signal.abort()` 跟 stream backpressure 释放是同步的，后者跟 OS socket / event loop 解耦；agent.abort() 调到了，但 slot 释放发生在 finally 里跟 fetch 解 stream 的时机间有 race
- **修复**：commit `2656bfb` Test 9 用 `fake agent` 暴露 `promptDone` Promise，`await promptDone` 取代 `sleep(50)`；Test 8 改成只断言「agent.abort() 已调用」+ 走 wire，slot 释放走 happy path 隐式覆盖
- **防再犯**：**已提炼到 CLAUDE.md「测试基建」**——in-process `app.fetch()` 测 SSE abort + cancel 时序跟生产 undici 偏；Phase 12 Task E + Phase 12.7 Task F 均踩；abort 路径单测只验 wire（agent.abort 触发），slot 释放走 happy path 隐式覆盖

### 坑 5：image-gen 异步工具 tool_execution.end fires on jobId return 不是 image ready

- **症状**：Task G 大瘦身后跑「生成 5 页 AI 历史 deck」dogfood，chat 显示「generate_slide_image 完成」但 deck 仍空白—— worker 后台还在跑，frontend 把 jobId-return 当 image-ready
- **根因**：pi-agent-core canonical `tool_execution.end` 在 tool callback `return` 后立即 fire；`generate_slide_image` 工具设计就是 sync return jobId + 异步落地，pi-agent-core 拿不到「真完成」信号；扩 canonical event schema 反向影响所有 adapter，成本太高
- **修复**：commit `adae75b` 走 Option B——`refreshFromBackend` 后扫 `deck_chats` 所有 tool 行 content（JSON），凡 `success:true && jobId:string` 且未见过的 jobId 就启 `useGenerateImageJob.start(jobId)`；`trackedImageJobIds` 跨多 turn dedup；`clearHistory` 清空
- **防再犯**：**已提炼到 CLAUDE.md「前端约定」**——异步工具（jobId-return + worker 异步）必须 frontend 接桥 polling（backend SSE 不延续 turn 边界）；post-turn-refresh + dedup Set + 扫 deck_chats jobId 是 canonical 模式

### 坑 6：模块级 mutable state testing seam 不还原会跨文件污染

- **症状**：完整跑 agent 全套 `pnpm -F @big-ppt/agent test` 偶发 2-9 个 case 失败（routes-auth `login: 成功 → 200` / mcp-server-repo `两个 user list 各自独立` / llm-models `未知 provider → 400` 等），失败 case 在单独跑同文件时全过；DB truncate 后再跑全套又全过——典型 order-dependent flakiness
- **根因**：`packages/agent/src/crypto/apikey.ts` 的 `_keyGetter` 是 module-level mutable variable；`test/integration/chat-turn.test.ts` `beforeAll(__setMasterKeyGetterForTesting(FIXED_KEY))` 注入后 **无 `afterAll(... null)` 复位**，模块缓存让 FIXED_KEY 漏到后续文件（之前的 routes-auth.test.ts 等也漏复位但碰巧后续不调 decryptApiKey 所以隐式 OK；Phase 12.7 Task F 新加的 chat-turn 是 first new test 用此 seam 让漏洞暴露）
- **修复**：本 Task H commit 给 chat-turn.test.ts 加 `afterAll(() => __setMasterKeyGetterForTesting(null))`；附带修 `ToolExecutionBlock.vue` `vue/return-in-computed-property` lint 红测
- **防再犯**：**已提炼到 CLAUDE.md「测试基建」**——任何 `__set*ForTesting` testing seam 用 module-level mutable state 的，使用方**必须**配 afterAll/afterEach 清空回 null（或默认值）；同 Phase 12.5 Task B 教训沿用，这条比 testing seam 设计本身更通用

---

## 测试数量落地（关闭后追加）

> 测试运行口径：`pnpm -F @big-ppt/<pkg> test`（不含 smoke）；agent 含 `lumideck_test` 真 MySQL 集成测。
> **DB 状态前置**：跑前手动 TRUNCATE 7 表（同 `resetDb`），避免之前失败留 stale 行影响（Phase 12.7 Task H 期间踩到 + 提炼到 CLAUDE.md）。

| 指标             | 起点 (Phase 12.5 + UX hotfix 后) | 终点 (Phase 12.7 完) | 增量 |
| ---------------- | ---- | ---- | ---- |
| agent unit (含集成) | 811 (~74 files) | **878 (76 files, +6 skipped 智谱图像 smoke = 884 total)** | **+67** |
| creator unit     | 140 (22 files) | **159 (17 files)** | **+19** |
| shared unit      | 3 (1 file) | 3 (1 file) | 0 |
| smoke test       | 6 tests (3 files, 默认 skipIf 跳) | 6 tests (3 files) | 0 |
| coverage lines   | agent 90 / creator 75 | 同 | 维持 |
| coverage branch  | agent 80 / creator 65 | 同 | 维持 |
| agent runtime adapter (per-file) | — | **agent-message / tool-bridge / persistence / translate-events / index ≥ 90 lines / 85 branches**（plan §"验收条件"达成） | — |
| frontend useAIChat 行数 | 1011 | **322** (Task G 258 → +53 image-gen polling re-wire → +11 code review fix) | 瘦身 -689 |

**agent 测试数 +67 说明**：
- +15 tool-bridge + agent-message (Task B)
- +9 agent (sibling __tests__) + 4 agent-persistence (integration) (Task C)
- +7 translate-events (Task D)
- +14 settings 单测 + 5 migrate-thinking-level 真 DB 集成 + 2 createAgent legacy compat (Task E fix)
- +10 chat-turn integration (Task F + Task F-fix 1 + Task H stability fix)
- +2 retry-from-error path (Task G code-review M-3)

**creator 测试数 +19 说明**：
- +15 useAIChat thin-consumer (Task G; 删 18 老 tool-loop / canonical-consumer / spec 测)
- +8 ToolExecutionBlock (Task G)
- +5 image-gen polling integration (Task G adae75b)
- +2 SettingsModal advanced thinkingLevel + 2 SettingsModal save (Task E)
- +6 SettingsModal model dropdown (Task E side-effect, save / provider-switch)
- −18 删 useAIChat.tool-loop / canonical-consumer / spec (old fixtures retired)
- net +19

**Phase 12.7 commit chain（17 commits）**：

- spec: `f93c7fb` + plan: `3ab9955`
- Task A: `79550f1`
- Task B: `0abaa78` → `e70420e`（code review nits）
- Task C: `307c0c7` → `f80b8fd`（code review 重要项）
- Task D: `1b43242` → `4c5b18c`（code review 重要项）
- Task E: `50d79bc` → `6eeeb76`（UI 补 Gemini/common）→ `a92254f`（createAgent compat fix）
- Task F: `6ae87c4` → `2656bfb`（code review）
- Task G: `13f40c3` → `adae75b`（image-gen polling re-wire）→ `3f844bb`（code review）
- Task H: 本 commit（close-out + 2 个小修：chat-turn afterAll + ToolExecutionBlock switch default）

---

## Dogfood 状态

**自动化已通过**：
- agent / creator / shared 单测 + 集成测全绿
- type-check 干净
- lint 干净
- build 干净
- Task F 9 个集成测验过 SSE wire / DB persistence / abort / 503 / 401 / 400 / 404 等契约
- Task G 28 个新单测覆盖 useAIChat 状态机 13 类 event + image polling dedup

**浏览器手验由用户在合并前完成**，验收脚本：

1. 创建 deck → 「生成 5 页 AI 历史 deck」→ 多 tool 并发（`tail -f logs/server-*.jsonl | grep "tool-call"` 看 parallel）
2. 切模板 → `rewriteForTemplate` 走非 agent 单轮 LLM call 路径（`POST /api/llm/chat/completions`）仍可用
3. Settings active provider 切到 Anthropic + 连续 2 轮对话 → 看 `cache.hit` event 出现，UsageStatsHint 显示「缓存命中 X tokens」
4. Settings advanced thinkingLevel='high' + 复杂问题 → 看 `thinking.delta` 内容充实（vs 'off' 时几乎没有）
5. 故意触发工具失败（删 deck 后后台改 LLM 设置触发 400）→ 看 ToolExecutionBlock 显示 error state + 红色边框
