# Phase 2.1 — 对话 UI 修复 + 思维链可视化 实施文档

> **状态**：✅ 已关闭（2026-04-20 前后，作为 Phase 2 收尾的 bug 修复轨道）
> **前置阶段**：Phase 2 主轨（[02-ai-integration.md](02-ai-integration.md)）
> **后续阶段**：Phase 2 关闭报告（[05-phase2-closeout.md](05-phase2-closeout.md)）
> **路线图**：[roadmap.md Phase 2](../requirements/roadmap.md)
> **执行子技能**：`superpowers:executing-plans` — 改动集中在 `creator/src/components/ChatPanel.vue` 与 `creator/src/composables/useAIChat.ts`，适合 inline 顺序执行。

**Goal**：修复对话 UI 的 3 个可用性 bug，并把"思考 / 工具调用"过程从顶部状态栏升级为消息流内的思维链可视化。

**Architecture**：保持纯前端，不引入新依赖。复用 `@antdv-next/x` 已装的 `ThoughtChain` 组件；消息列表支持三种气泡类型（user / assistant 文本 / assistant 思维链）。

**Tech Stack**：Vue 3 Composition API、`@antdv-next/x` (Bubble / Sender / ThoughtChain)、TypeScript。

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- 本 Phase 不引入新环境变量
- 每次 `git commit` 前 `git status` 人工检查，禁用 `git add -A`

---

## 背景：Phase 2 遗留问题

Phase 2 交付的 [ChatPanel.vue](../../creator/src/components/ChatPanel.vue) 有三处问题，用户反馈"太简陋"：

| #   | 现象                                     | 根因                                                                                                                                       |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 发送后输入框不清空                       | `Sender` 的 `triggerSend` 只调 `onSubmit`，不清 `innerValue`。父组件既没 `v-model:value` 也没通过 ref 调 `clear()`。                       |
| 2   | "思考中"状态栏亮了，但消息区空白直到首字 | `bubbleItems` 只在 `streamingContent` 非空时插入气泡，`thinking` / `calling_tool` 阶段没任何气泡。                                         |
| 3   | `roles.ai.loading` 不随状态变化          | `const roles = { ai: { loading: status.value === 'thinking' } }`——`roles` 是普通对象，setup 只求值一次，后续 `status` 变化不会触发重渲染。 |

另外工具调用链路（read_slides / write_slides 等）只存进 LLM messages，**用户完全看不到 AI 在做什么工具调用**——需要可视化。

---

## 技术选型

| 决策             | 选择                                 | 理由                                                             |
| ---------------- | ------------------------------------ | ---------------------------------------------------------------- |
| 输入框清空       | 方式 A：`ref` + `sender.clear()`     | Sender 已 `expose({ clear })`，一行调用，无需维护 `v-model` 状态 |
| 进度反馈         | `@antdv-next/x` 的 `ThoughtChain`    | 已装依赖，原生支持 `loading/success/error/abort` 四种状态 + 折叠 |
| 工具调用日志位置 | 放进 `chatMessages` 作为独立气泡类型 | 保留在消息流中，滚动不丢；比状态栏更像正常 AI 产品               |
| `roles` 响应式   | `computed` 包裹                      | 最小改动                                                         |

---

## File Structure

- Modify: `creator/src/composables/useAIChat.ts` — 暴露 `toolSteps` 状态（思维链节点数组），工具调用时增删。
- Modify: `creator/src/components/ChatPanel.vue` — Sender ref 清空；`roles` 改 `computed`；bubbleItems 支持 `thought-chain` 类型。

---

## Task 1: useAIChat 暴露工具调用步骤

**Files:**

- Modify: [creator/src/composables/useAIChat.ts](../../creator/src/composables/useAIChat.ts)

- [ ] **Step 1.1 — 新增类型与状态**

在文件顶部类型区添加 `ToolStep`，在 `useAIChat()` 内部声明 `toolSteps`：

```ts
// 放在第 20 行左右、ChatBubble 之后
export interface ToolStep {
  key: string // tc.id
  name: string // tc.function.name
  label: string // TOOL_STATUS_MAP[name] ?? name
  status: 'loading' | 'success' | 'error'
  argsPreview?: string // 参数 JSON 前 80 字符
  error?: string
}

// 放在 streamingContent 声明后
const toolSteps = ref<ToolStep[]>([])
```

- [ ] **Step 1.2 — 在工具调用前 push、完成后更新状态**

替换现有 `for (const tc of toolCalls)` 循环（约 300-316 行）：

```ts
for (const tc of toolCalls) {
  const step: ToolStep = {
    key: tc.id || `${tc.function.name}-${Date.now()}`,
    name: tc.function.name,
    label: TOOL_STATUS_MAP[tc.function.name] || `调用工具：${tc.function.name}`,
    status: 'loading',
    argsPreview: (tc.function.arguments || '').slice(0, 80),
  }
  toolSteps.value.push(step)

  status.value = 'calling_tool'
  statusText.value = step.label

  let result: string
  try {
    result = await executeTool(tc)
    // 更新状态，Vue 需要替换引用触发响应
    const idx = toolSteps.value.findIndex((s) => s.key === step.key)
    if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'success' }
  } catch (err: any) {
    result = JSON.stringify({ success: false, error: err.message })
    const idx = toolSteps.value.findIndex((s) => s.key === step.key)
    if (idx >= 0) toolSteps.value[idx] = { ...step, status: 'error', error: err.message }
  }

  messages.value.push({
    role: 'tool',
    tool_call_id: tc.id,
    content: result,
  })
}
```

- [ ] **Step 1.3 — 回复完成 / 取消 / 出错时把步骤归档进 chatMessages**

找到"LLM 最终自然语言回复"分支（约 321-328 行），改为：

```ts
// LLM 最终自然语言回复
if (fullContent || toolSteps.value.length > 0) {
  chatMessages.value.push({
    role: 'assistant',
    content: fullContent,
    toolSteps: toolSteps.value.length > 0 ? toolSteps.value : undefined,
  })
  messages.value.push({ role: 'assistant', content: fullContent })
}
toolSteps.value = []
streamingContent.value = ''
status.value = 'idle'
statusText.value = ''
return
```

`ChatBubble` 类型同步扩展：

```ts
interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  toolSteps?: ToolStep[]
}
```

错误分支里同样把未完成步骤标 `error` 后归档，避免遗失：

```ts
} catch (err: any) {
  // 未完成步骤全部标记为 error/abort
  toolSteps.value = toolSteps.value.map(s =>
    s.status === 'loading'
      ? { ...s, status: err.name === 'AbortError' ? 'error' : 'error', error: s.error ?? '已中断' }
      : s
  )
  if (toolSteps.value.length > 0) {
    chatMessages.value.push({ role: 'assistant', content: '', toolSteps: toolSteps.value })
    toolSteps.value = []
  }
  // …保留原 AbortError / 其它错误处理
}
```

- [ ] **Step 1.4 — return 块暴露新状态**

```ts
return {
  chatMessages,
  streamingContent,
  toolSteps, // ← 新增
  status,
  statusText,
  isGenerating,
  sendMessage,
  cancel,
  clearHistory,
  getSettings,
}
```

- [ ] **Step 1.5 — 提交**

```bash
git add creator/src/composables/useAIChat.ts
git commit -m "feat(chat): useAIChat 暴露 toolSteps 供思维链可视化"
```

---

## Task 2: ChatPanel 修复三个 UI bug

**Files:**

- Modify: [creator/src/components/ChatPanel.vue](../../creator/src/components/ChatPanel.vue)

- [ ] **Step 2.1 — import ThoughtChain + Sender ref + computed**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bubble, Sender, ThoughtChain } from '@antdv-next/x'
import { useAIChat } from '../composables/useAIChat'

const {
  chatMessages,
  streamingContent,
  toolSteps,
  status,
  statusText,
  isGenerating,
  sendMessage,
  cancel,
} = useAIChat()

const senderRef = ref<InstanceType<typeof Sender> | null>(null)
</script>
```

- [ ] **Step 2.2 — bubbleItems 支持 toolSteps**

```ts
const bubbleItems = computed(() => {
  const items: any[] = []

  for (const [i, msg] of chatMessages.value.entries()) {
    if (msg.role === 'user') {
      items.push({ key: `u-${i}`, role: 'user', content: msg.content })
      continue
    }
    // assistant：若有 toolSteps 先插一个思维链气泡，再插文本气泡
    if (msg.toolSteps?.length) {
      items.push({
        key: `a-${i}-chain`,
        role: 'ai-chain',
        content: { steps: msg.toolSteps },
      })
    }
    if (msg.content) {
      items.push({ key: `a-${i}`, role: 'ai', content: msg.content })
    }
  }

  // 进行中：当前轮的思维链
  if (toolSteps.value.length > 0) {
    items.push({
      key: 'live-chain',
      role: 'ai-chain',
      content: { steps: toolSteps.value },
    })
  }

  // 进行中：流式文本
  if (streamingContent.value) {
    items.push({ key: 'live-text', role: 'ai', content: streamingContent.value })
  } else if (status.value === 'thinking') {
    // 还没开始流式、也没工具调用 —— 显示思考占位
    items.push({ key: 'live-think', role: 'ai', content: '', loading: true })
  }

  return items
})
```

- [ ] **Step 2.3 — roles 改为 computed（修 bug 3），并新增 ai-chain 自定义渲染**

```ts
const roles = computed(() => ({
  user: {
    placement: 'end' as const,
    variant: 'filled' as const,
    shape: 'round' as const,
  },
  ai: {
    placement: 'start' as const,
    variant: 'outlined' as const,
    shape: 'round' as const,
  },
  'ai-chain': {
    placement: 'start' as const,
    variant: 'borderless' as const,
    messageRender: (content: any) => renderToolChain(content.steps),
  },
}))

function renderToolChain(steps: any[]) {
  return h(ThoughtChain, {
    items: steps.map((s) => ({
      key: s.key,
      title: s.label,
      description: s.argsPreview ? s.argsPreview : undefined,
      content: s.error ? h('div', { style: 'color: #ff4d4f' }, s.error) : undefined,
      status: s.status,
      collapsible: !!s.error,
    })),
    size: 'small',
  })
}
```

别忘了 `import { h } from 'vue'`。

- [ ] **Step 2.4 — handleSubmit 调 Sender.clear()（修 bug 1）**

```ts
function handleSubmit(message: string) {
  if (!message.trim()) return
  sendMessage(message.trim())
  senderRef.value?.clear()
}
```

template 里把 ref 绑上：

```vue
<Sender
  ref="senderRef"
  :loading="isGenerating"
  placeholder="描述你想要的幻灯片..."
  :submit-type="'enter'"
  @submit="handleSubmit"
  @cancel="handleCancel"
/>
```

- [ ] **Step 2.5 — 验证 dev server**

```bash
cd creator && pnpm dev
```

手动验收：

1. 发送"生成一页关于 Vue 的介绍幻灯片"，按 Enter 后输入框应立即清空。
2. 等待期间顶部出现"正在思考..."，消息区出现 **带脉冲动画的空气泡**（loading）。
3. LLM 返回 tool_calls 时，消息区出现 ThoughtChain，节点随调用一个个亮起（loading→success 图标变化）。
4. 工具执行完 LLM 产出文字时，思维链和最终文本气泡同屏可见。
5. 连续发送两条，上一轮思维链应留在历史中，新一轮思维链出现在底部。
6. 点"取消"按钮，进行中节点状态变红色 error。

- [ ] **Step 2.6 — 提交**

```bash
git add creator/src/components/ChatPanel.vue
git commit -m "fix(chat): 修复输入框不清空、roles 响应式与思考阶段无反馈，接入 ThoughtChain 可视化工具调用"
```

---

## 验证清单（执行完所有任务后）

- [ ] Vite build 通过：`cd creator && pnpm build` 无报错
- [ ] 手动复现用户报告的两个问题，确认均已修复
- [ ] 无新增依赖（仅使用已装的 `@antdv-next/x`）

---

## 风险 & 回滚

- `ThoughtChain` 在 Bubble 的 `messageRender` 中是 h(VNode) 渲染，若样式溢出气泡容器，需要给 `.chat-panel .ant-bubble-content` 放宽 `max-width`（观察后再调）。
- 若 Sender 的 `expose.clear()` 在 0.3.0 版本行为异常，回退为 `v-model:value` 受控模式。

回滚：两个文件各一次 commit，`git revert` 即可。

---

## 踩坑与解决

### 坑 1：Vue setup() 内普通对象不响应

- **症状**：`roles.ai.loading` 跟着 `status` 变化但 UI 不重渲染
- **根因**：`const roles = { ai: { loading: status.value === 'thinking' } }` 是 setup 一次求值的普通对象，后续 `status` 变化不触发 `roles` 重算
- **修复**：改 `computed(() => ({ ai: { loading: status.value === 'thinking' } }))`
- **防再犯**：CLAUDE.md 已记一句"setup 内派生对象一律 `computed`"
- **已提炼到 CLAUDE.md**：是

### 坑 2：Sender 输入框发送后不清空

- **症状**：发送消息后 textarea 内容残留
- **根因**：`Sender` 的 `triggerSend` 只调 `onSubmit`，不清 `innerValue`；父组件没用 `v-model:value` 也没 `ref.clear()`
- **修复**：用 `senderRef = ref(null)` + 在 `handleSubmit` 后调 `senderRef.value?.clear()`（Sender 已 `expose({ clear })`）
- **防再犯**：组件交互手册——非受控输入组件的清空必须显式调 expose 的 clear，不能依赖 onSubmit 副作用

---

## 测试数量落地

> 本 Phase 是 bug 修复轨道，未引入新测试（Phase 3 才落地测试基建）。Phase 4 起 useSlashCommands 抽出后才有针对性单测。
