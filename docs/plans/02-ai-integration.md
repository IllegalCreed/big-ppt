# Phase 2 实施计划：AI 集成 + 对话 UI

## Context

项目已完成模板体系（Phase 1），现需构建 AI 对话界面，让用户通过自然语言生成幻灯片。目标是纯前端验证原型，不引入后端服务。

### 用户核心疑问解答

| 问题 | 结论 |
|------|------|
| 需要服务端吗？ | **不需要**。浏览器直接调用 LLM API |
| API Key 安全？ | 存 localStorage，纯个人工具可接受 |
| 模板怎么给 LLM？ | Vite `?raw` 导入，打包进 system prompt |
| 提示词工程？ | 将 skill 逻辑转为结构化 system prompt |
| CORS 问题？ | **用 Vite dev server 代理解决**，无需担心跨域，支持任意 LLM 提供商 |

---

## 技术选型

| 决策 | 选择 | 理由 |
|------|------|------|
| 聊天 UI | **@antdv-next/x** | antdv-next 生态的 AI 组件库，长期维护方向对，支持流式渲染 |
| UI 框架 | **antdv-next** | ant-design-vue 的接替者，基于 Ant Design v6，活跃维护 |
| LLM 调用 | **原生 fetch + ReadableStream** | 零依赖，轻量，足够原型使用 |
| API 代理 | **Vite dev server proxy** | 浏览器请求同源 `/api/`，Vite 转发到实际 LLM API，彻底解决 CORS |
| API 提供商 | **用户自定义**（默认智谱） | 通过代理支持任意 OpenAI 兼容接口（智谱、DeepSeek、OpenAI 等） |
| 幻灯片预览 | **Slidev iframe** | 嵌入 Slidev dev server，100% 准确渲染，支持所有组件和布局 |
| 状态管理 | **Vue 3 响应式** | 原型阶段不需要 Pinia |

---

## 架构设计

### 双模式项目

```
pnpm slidev      → 仅启动 Slidev 演示
pnpm creator     → 同时启动 Creator + Slidev（通过 concurrently）
```

Creator 通过 iframe 嵌入 Slidev 实现精确预览。两个 dev server 同时运行：
- Creator Vite: `localhost:3030`
- Slidev: `localhost:3031`

### 文件结构

```
big-ppt/
├── creator/                        # 新增：Creator 应用
│   ├── index.html                  # 入口 HTML
│   └── src/
│       ├── main.ts                 # 应用入口
│       ├── App.vue                 # 主布局（左聊天 + 右预览iframe）
│       ├── composables/
│       │   ├── useAIChat.ts        # LLM API 调用 + SSE 流式
│       │   └── useSlideStore.ts    # 幻灯片状态管理 + 文件写入
│       ├── components/
│       │   ├── ChatPanel.vue       # AI 对话面板（@antdv-next/x）
│       │   ├── SlidePreview.vue    # Slidev iframe 预览面板
│       │   └── SettingsModal.vue   # API Key 配置弹窗
│       └── prompts/
│           └── buildSystemPrompt.ts # 构建 system prompt
├── vite.config.creator.ts          # 新增：Creator Vite 配置（含代理 + 文件写入中间件）
├── templates/                      # 共用：模板文件
├── components/                     # 共用：Vue 组件
├── public/                         # 共用：静态资源
├── slides.md                       # Slidev 演示文件
└── package.json                    # 更新：添加依赖和脚本
```

### 核心流程：Function Calling（工具调用）

通过 OpenAI Function Calling 让 LLM 主动调用工具，实现类似 VS Code AI Agent 的体验：

```
用户输入："把第二页标题改成项目总结"
       ↓
ChatPanel → useAIChat → 发送到 LLM API（携带 tools 定义）
       ↓
LLM 返回 tool_calls: [{ name: "read_slides" }]
       ↓
Creator 调用 GET /api/read-slides（Vite 中间件读取 slides.md）
       ↓
将文件内容作为 tool result 返回给 LLM
       ↓
LLM 分析内容，返回 tool_calls: [{ name: "edit_slides", args: { old: "旧标题", new: "项目总结" } }]
       ↓
Creator 调用 POST /api/edit-slides（Vite 中间件精确替换）
       ↓
Slidev 热更新 → iframe 预览刷新
       ↓
LLM 回复："已将第二页标题修改为'项目总结'" → 显示在聊天气泡
```

### LLM 可用工具定义

```typescript
const tools = [
  {
    name: "read_slides",
    description: "读取当前 slides.md 的完整内容",
    parameters: {} // 无参数
  },
  {
    name: "write_slides",
    description: "用新内容完全替换 slides.md（用于首次生成）",
    parameters: { content: "完整的 slides markdown 内容" }
  },
  {
    name: "edit_slides",
    description: "精确替换 slides.md 中的某段内容（用于局部修改）",
    parameters: {
      old_string: "要替换的原文",
      new_string: "替换后的新内容"
    }
  },
  {
    name: "read_template",
    description: "读取指定模板文件的内容",
    parameters: { template_name: "模板文件名，如 cover.md" }
  },
  {
    name: "list_templates",
    description: "列出所有可用的页面模板",
    parameters: {}
  }
]
```

### 多轮工具调用循环

```typescript
// Agent 主循环
const MAX_ITERATIONS = 20

for (let i = 0; i < MAX_ITERATIONS; i++) {
  const response = await callLLM(messages, { tools, signal })

  if (response.tool_calls) {
    for (const toolCall of response.tool_calls) {
      try {
        const result = await executeTool(toolCall)  // 调用 Vite 中间件
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
      } catch (err) {
        // 工具执行失败，把错误信息喂回 LLM 让它自行调整策略
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `工具执行失败：${err.message}` })
      }
    }
    continue  // 继续循环，让 LLM 根据工具结果推理
  }

  // 无 tool_calls → LLM 给出自然语言回复（可能是回答、提问确认细节、或告知完成）
  messages.push({ role: 'assistant', content: response.content })
  return response.content
}

// 超过最大轮次，强制中断
return '生成超时，请尝试简化需求或重新开始'
```

### 循环终止条件

| 条件 | 场景 | 处理 |
|------|------|------|
| 无 tool_calls | LLM 回复用户 / 提问确认细节 / 告知完成 | 正常结束，显示在聊天气泡 |
| 超过最大轮次（20轮） | LLM 反复调工具停不下来 | 强制中断，提示用户 |
| 工具执行失败 | edit_slides 找不到原文等 | 错误信息喂回 LLM，让它重试或换方案 |
| 用户主动取消 | 点击取消按钮 | AbortController 中断 fetch 请求 |

**提问确认场景**：LLM 问"你需要几页？"时不会调用工具，直接返回自然语言，循环正常结束。用户回答后带着完整历史开启新一轮循环。

### Vite 中间件提供的工具接口

| 接口 | 方法 | 功能 |
|------|------|------|
| `/api/read-slides` | GET | 读取 slides.md 内容 |
| `/api/write-slides` | POST | 全量写入 slides.md（首次生成） |
| `/api/edit-slides` | POST | 精确替换（old_string → new_string） |
| `/api/read-template` | POST | 读取模板文件（如 cover.md） |
| `/api/list-templates` | GET | 列出可用模板 |

### 用户体验

- **聊天气泡**：只显示 LLM 的自然语言回复（"已修改第二页"），不显示 markdown 代码
- **预览面板**：Slidev iframe 实时显示修改结果
- **首次生成**：LLM 调用 list_templates → read_template → write_slides
- **局部修改**：LLM 调用 read_slides → edit_slides（精确替换）
- **纯聊天**：LLM 不调用任何工具，直接回复文字

### 预览方案：Slidev iframe

Creator 右侧面板嵌入 `<iframe src="http://localhost:3031" />`，直接显示 Slidev 渲染结果。
- 生成完成后通过 Vite 中间件写入 slides.md，Slidev 自动热更新
- 支持所有 Slidev 特性：Vue 组件（BarChart）、动画、自定义 CSS 等
- 预览效果与最终演示完全一致

---

## Harness 详细设计

### 流式输出与 Tool Calling

Tool calling 轮次和最终回复的流式策略不同：

| 阶段 | 流式 | 原因 |
|------|------|------|
| Tool call 轮次 | **非流式** | 需要完整解析 `tool_calls` JSON 才能执行工具 |
| 最终自然语言回复 | **流式** | 逐字显示，用户体验好 |
| LLM 回复中提问确认 | **流式** | 同最终回复 |

```typescript
// 简化方案：始终用 stream: true，按需处理
const response = await fetch('/api/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ messages, tools, stream: true }),
})

// 用 ReadableStream 逐块读取
const reader = response.body.getReader()
let buffer = ''

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += new TextDecoder().decode(value)

  // 解析 SSE 事件
  const lines = buffer.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = JSON.parse(line.slice(6))
    const delta = data.choices[0].delta

    if (delta.tool_calls) {
      // 累积 tool_calls 片段 → 全部收齐后执行工具
      accumulateToolCalls(delta.tool_calls)
    } else if (delta.content) {
      // 流式输出到聊天界面
      appendToChat(delta.content)
    }
  }
}
```

### 上下文窗口管理

read_slides 返回完整 slides.md，可能很长。多轮对话后 messages 数组会超过模型 token 限制。

**策略：滑动窗口 + 摘要**

```typescript
const MAX_CONTEXT_MESSAGES = 20  // 保留最近 20 条消息

function trimMessages(messages: Message[]): Message[] {
  // 永远保留 system prompt（第一条）
  const system = messages[0]

  // 保留最近 N 条消息
  const recent = messages.slice(-MAX_CONTEXT_MESSAGES)

  // 如果截断了，插入一条摘要提醒 LLM
  if (messages.length > MAX_CONTEXT_MESSAGES + 1) {
    const summary = {
      role: 'system',
      content: '[ Earlier conversation history has been trimmed. The current slides.md is available via read_slides tool. ]'
    }
    return [system, summary, ...recent]
  }

  return [system, ...recent]
}
```

原型阶段先用简单的截断策略，Phase 3 再考虑智能摘要。

### 工具执行边界情况

#### edit_slides

| 情况 | 处理 |
|------|------|
| `old_string` 未找到 | 返回错误 + 最近似匹配建议，让 LLM 重新尝试 |
| `old_string` 匹配到多处 | 返回错误 + 列出所有匹配位置，要求 LLM 提供更长上下文以唯一定位 |
| `old_string` 为空字符串 | 直接拒绝，返回错误 |
| `new_string` 与 `old_string` 相同 | 返回成功但提示无实际变更 |

```typescript
// edit-slides 中间件实现核心逻辑
function handleEditSlides(body: { old_string: string, new_string: string }) {
  const content = fs.readFileSync('slides.md', 'utf-8')

  // 空字符串检查
  if (!body.old_string) {
    return { success: false, error: 'old_string 不能为空' }
  }

  // 计算匹配次数
  const count = content.split(body.old_string).length - 1

  if (count === 0) {
    // 未找到 → 提供上下文帮助 LLM 定位
    const lines = content.split('\n')
    const suggestions = findSimilarLines(body.old_string, lines)
    return { success: false, error: `未找到指定内容。相似内容：${suggestions.join('\n')}` }
  }

  if (count > 1) {
    // 多处匹配 → 列出位置
    const positions = findAllPositions(content, body.old_string)
    return {
      success: false,
      error: `找到 ${count} 处匹配，请提供更长的上下文以唯一定位。匹配位置：${positions.map(p => `第${p.line}行`).join(', ')}`
    }
  }

  // 唯一匹配 → 执行替换
  const newContent = content.replace(body.old_string, body.new_string)
  fs.writeFileSync('slides.md', newContent)
  return { success: true }
}
```

#### read_template 路径安全

```typescript
function handleReadTemplate(name: string) {
  // 路径穿越防护：只允许字母、数字、横线、点
  const safeName = name.replace(/[^a-zA-Z0-9\-.]/g, '')

  // 只允许 .md 文件
  if (!safeName.endsWith('.md')) {
    return { success: false, error: '只支持 .md 模板文件' }
  }

  // 限制在 templates 目录内
  const templatePath = path.resolve('templates/company-standard', safeName)
  if (!templatePath.startsWith(path.resolve('templates/'))) {
    return { success: false, error: '非法路径' }
  }

  if (!fs.existsSync(templatePath)) {
    return { success: false, error: `模板 ${safeName} 不存在` }
  }

  return { success: true, content: fs.readFileSync(templatePath, 'utf-8') }
}
```

### API 容错与重试

```typescript
async function callLLM(messages, options, retries = 3) {
  try {
    const response = await fetch('/api/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: getModel(),
        messages,
        tools: options.tools,
        stream: true,
      }),
      signal: options.signal,
    })

    if (response.ok) return response

    // 根据状态码处理
    switch (response.status) {
      case 401:
        throw new Error('API Key 无效，请在设置中重新配置')
      case 429: {
        // 限流：等待后重试
        const retryAfter = response.headers.get('Retry-After')
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000
        if (retries > 0) {
          await sleep(waitMs)
          return callLLM(messages, options, retries - 1)
        }
        throw new Error('请求过于频繁，请稍后重试')
      }
      case 500:
      case 502:
      case 503:
        if (retries > 0) {
          await sleep(2000)
          return callLLM(messages, options, retries - 1)
        }
        throw new Error('LLM 服务暂时不可用，请稍后重试')
      default:
        throw new Error(`请求失败：${response.status} ${response.statusText}`)
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err  // 用户取消，不重试
    if (retries > 0 && !err.message.includes('API Key')) {
      await sleep(1000)
      return callLLM(messages, options, retries - 1)
    }
    throw err
  }
}
```

### 中间状态展示（用户等待时的反馈）

Agent 工作时，用户需要看到当前在做什么：

```typescript
// 状态类型
type AgentStatus =
  | 'idle'                    // 空闲
  | 'thinking'                // LLM 正在推理
  | 'calling_tool'            // 正在调用工具
  | 'streaming'               // 正在流式输出回复
  | 'error'                   // 出错
  | 'cancelled'               // 用户取消

// 工具状态映射 → 用户看到的文字
const TOOL_STATUS_MAP: Record<string, string> = {
  read_slides:    '正在读取当前幻灯片...',
  write_slides:   '正在生成幻灯片...',
  edit_slides:    '正在修改幻灯片...',
  read_template:  '正在读取模板...',
  list_templates: '正在查询可用模板...',
}
```

UI 层根据 `AgentStatus` 显示：
- `thinking` → 旋转 loading 动画
- `calling_tool` + 工具名 → 显示对应中文提示（如"正在生成幻灯片..."）
- `streaming` → 打字机效果逐字显示
- `error` → 红色错误提示

### System Prompt 完整内容

```markdown
你是一个专业的幻灯片生成助手，帮助用户使用 Slidev 框架创建商务演示文稿。

## 你的工作方式

1. **首次生成**：先调用 list_templates 了解可用模板，按需 read_template 查看模板内容，最后用 write_slides 写入完整幻灯片
2. **局部修改**：先调用 read_slides 读取当前内容，找到需要修改的部分，用 edit_slides 精确替换
3. **提问确认**：如果用户的需求不够明确（如主题、页数、受众），先提问再生成，不要猜测
4. **纯回答**：如果用户只是询问，不需要调用任何工具，直接回答

## Slidev 语法规则

1. 每页幻灯片用 `---` 分隔
2. 第一页是 YAML frontmatter：
   ```yaml
   ---
   theme: seriph
   title: 演示标题
   ---
   ```
3. 可用布局（通过 `layout: xxx` 指定）：
   - `cover` — 封面页
   - `section` — 章节分隔页
   - `content` — 正文内容页
   - `two-cols` — 双栏布局
   - `image-right` — 左文右图
   - `center` — 居中文字页
   - `end` — 结束页
4. 可用组件：
   - `<BarChart :data="[{ name: 'Q1', value: 100 }, ...]" />`
   - `<LineChart :data="[{ name: '1月', value: 200 }, ...]" />`
5. 页面级 CSS：`<style>` 标签或 `class` 属性
6. 支持 Vue 模板语法和插槽

## 组装规则

- 按顺序：封面 → 目录（可选）→ 内容页（1-N页）→ 结束页
- 内容页之间使用一致的布局风格
- 数据可视化优先使用 BarChart / LineChart 组件
- 中文内容，专业但简洁的措辞

## 输出约束

- 必须输出合法的 Slidev markdown
- 不要输出 ```markdown 代码块标记，直接输出内容
- 组件语法必须正确闭合
- YAML frontmatter 必须在最开头
```

### 日志与调试

开发阶段需要看到 Agent 的完整执行过程：

```typescript
// 开发模式日志（console.group 可折叠）
function logAgentStep(step: string, data?: unknown) {
  if (import.meta.env.DEV) {
    console.group(`🔄 Agent: ${step}`)
    if (data) console.log(data)
    console.groupEnd()
  }
}

// 示例输出：
// 🔄 Agent: 发送请求 → LLM
// 🔄 Agent: 收到 tool_calls: [read_slides]
// 🔄 Agent: 工具结果 → 1250 字符
// 🔄 Agent: 发送请求 → LLM
// 🔄 Agent: 收到 tool_calls: [edit_slides]
// 🔄 Agent: 工具结果 → 替换成功
// 🔄 Agent: 发送请求 → LLM
// 🔄 Agent: 最终回复 → "已将第二页标题修改为..."
```

UI 上可选显示调试面板（开关切换），展示每次工具调用的输入输出。

---

## 实施步骤

### Step 1：安装依赖

**修改文件**: `package.json`

新增依赖：
- `antdv-next` — UI 框架（ant-design-vue 接替者，基于 Ant Design v6）
- `@antdv-next/x` — AI 聊天组件（antdv-next 生态的 AI 组件库）
- `concurrently` — 同时启动 Creator + Slidev 两个 dev server

新增脚本：
- `"creator": "concurrently \"vite --config vite.config.creator.ts --port 3030\" \"slidev --port 3031\""`

### Step 2：创建 Vite 配置

**新建文件**: `vite.config.creator.ts`

- 入口：`creator/index.html`
- 根目录：项目根（这样才能用 `?raw` 导入 templates/）
- 别名：`@` → `creator/src`
- **Vite 插件：Agent 工具中间件** — 提供 LLM 工具调用所需的文件操作接口：

```typescript
function slidesToolPlugin() {
  return {
    name: 'slides-tools',
    configureServer(server) {
      // 读取 slides.md
      server.middlewares.use('/api/read-slides', (req, res) => {
        const content = fs.readFileSync('slides.md', 'utf-8')
        res.end(content)
      })
      // 全量写入 slides.md（首次生成）
      server.middlewares.use('/api/write-slides', (req, res) => {
        // 读取请求体 → fs.writeFileSync('slides.md', content)
      })
      // 精确替换 slides.md 中的内容（局部修改）
      server.middlewares.use('/api/edit-slides', (req, res) => {
        // 读取 { old_string, new_string } → 在文件中找到并替换
      })
      // 读取模板文件
      server.middlewares.use('/api/read-template', (req, res) => {
        // 读取 templates/company-standard/{name} 的内容
      })
      // 列出可用模板
      server.middlewares.use('/api/list-templates', (req, res) => {
        // 扫描 templates/ 目录，返回模板列表
      })
    }
  }
}
```

- **API 代理配置** — 代理到用户选择的 LLM 提供商：

```typescript
// 预置提供商列表（均为 OpenAI 兼容接口）
const PROVIDERS = {
  zhipu:    { name: '智谱 (GLM)',     baseURL: 'https://open.bigmodel.cn/api/paas/v4',            defaultModel: 'glm-4-flash' },
  deepseek: { name: 'DeepSeek',       baseURL: 'https://api.deepseek.com/v1',                      defaultModel: 'deepseek-chat' },
  openai:   { name: 'OpenAI',         baseURL: 'https://api.openai.com/v1',                        defaultModel: 'gpt-4o' },
  moonshot: { name: 'Moonshot(Kimi)', baseURL: 'https://api.moonshot.cn/v1',                       defaultModel: 'moonshot-v1-8k' },
  qwen:     { name: '千问 (Qwen)',    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  custom:   { name: '自定义',          baseURL: '',                                                 defaultModel: '' },
}

// Vite proxy 配置 — 代理到用户选择的提供商
server: {
  proxy: {
    '/api': {
      target: PROVIDERS[selectedProvider].baseURL,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    }
  }
}
```

所有预置提供商均为 OpenAI 兼容接口，统一请求格式。
如需接入 Claude/Gemini 等非兼容接口，选择"自定义"填入 OpenAI 兼容代理地址（如 one-api）即可。
浏览器请求 `localhost:5173/api/chat/completions`，Vite 代理到实际 LLM API，零 CORS 问题。
用户只需选厂家 + 填 API key，不用管接口地址。

### Step 3：构建 system prompt + tools 定义

**新建文件**: `creator/src/prompts/buildSystemPrompt.ts`

System prompt 不再嵌入完整模板文件（改为通过工具动态读取），只包含：
1. **角色定义** — "你是一个幻灯片生成助手..."
2. **工具使用指引** — 指导 LLM 何时调用哪个工具
3. **组装规则** — 封面→目录→内容→封底，`---` 分隔
4. **组件说明** — BarChart/LineChart 的 props 用法
5. **输出格式** — 必须输出合法 Slidev markdown

**新建文件**: `creator/src/prompts/tools.ts`

OpenAI Function Calling 的 tools 定义：
```typescript
export const tools = [
  {
    type: 'function',
    function: {
      name: 'read_slides',
      description: '读取当前 slides.md 的完整内容',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_slides',
      description: '用新内容完全替换 slides.md（首次生成时使用）',
      parameters: {
        type: 'object',
        properties: { content: { type: 'string', description: '完整的 slides markdown' } },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_slides',
      description: '精确替换 slides.md 中的某段内容（局部修改时使用）',
      parameters: {
        type: 'object',
        properties: {
          old_string: { type: 'string', description: '要被替换的原文' },
          new_string: { type: 'string', description: '替换后的新内容' }
        },
        required: ['old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_template',
      description: '读取指定模板文件的 markdown 内容',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '模板名，如 cover.md、content.md' } },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_templates',
      description: '列出所有可用的页面模板',
      parameters: { type: 'object', properties: {} }
    }
  }
]
```

### Step 4：实现 Agent 循环核心

**新建文件**: `creator/src/composables/useAIChat.ts`

功能：
- 从 localStorage 读取 API key、model
- 请求发送到 `/api/chat/completions`（Vite 代理到实际 LLM API）
- **Agent 循环**：检测 LLM 返回的 tool_calls → 调用本地中间件 → 将结果返回给 LLM → 循环直到 LLM 不再调用工具
- 支持 tool calling 的多轮调用
- LLM 最终的自然语言回复 → 显示在聊天气泡
- 支持取消请求

```typescript
// 核心流程
async function sendMessage(userMessage: string) {
  messages.push({ role: 'user', content: userMessage })

  while (true) {
    const response = await callLLM(messages, { tools })  // 发送给 LLM

    if (response.hasToolCalls) {
      // LLM 要求调用工具
      for (const toolCall of response.toolCalls) {
        const result = await executeToolLocally(toolCall)  // 调用 Vite 中间件
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
      }
      // 继续循环，让 LLM 根据工具结果继续推理
      continue
    }

    // LLM 返回自然语言回复 → 显示在聊天气泡
    messages.push({ role: 'assistant', content: response.content })
    break
  }
}

// 执行工具调用（请求 Vite 中间件）
async function executeToolLocally(toolCall) {
  switch (toolCall.name) {
    case 'read_slides':   return await fetch('/api/read-slides')
    case 'write_slides':  return await fetch('/api/write-slides', { method: 'POST', body: ... })
    case 'edit_slides':   return await fetch('/api/edit-slides', { method: 'POST', body: ... })
    case 'read_template': return await fetch('/api/read-template', { method: 'POST', body: ... })
    case 'list_templates': return await fetch('/api/list-templates')
  }
}
```

**新建文件**: `creator/src/composables/useSlideStore.ts`

功能：
- 存储当前生成的 slides.md 内容
- 解析 markdown（按 `---` 分页）
- 提供当前页码、总页数
- 导出为 .md 文件下载

### Step 5：实现 UI 组件

**新建文件**: `creator/src/App.vue`

布局：
- 左侧 40%：聊天面板
- 右侧 60%：幻灯片预览
- 顶部工具栏：模板选择、设置按钮、导出按钮

**新建文件**: `creator/src/components/ChatPanel.vue`

使用 @antdv-next/x 的 AI 组件（Bubble、Sender、Prompts 等），参考 https://x.antdv-next.com/ 文档

**新建文件**: `creator/src/components/SlidePreview.vue`

Slidev iframe 预览面板：
- 嵌入 `<iframe src="http://localhost:3031" />`
- 生成完成后通过 `/api/write-slides` 写入 slides.md
- Slidev 自动热更新，iframe 实时刷新
- 100% 准确渲染（包括 BarChart 等 Vue 组件、自定义 CSS、动画）

**新建文件**: `creator/src/components/SettingsModal.vue`

功能：
- **API 提供商下拉选择**（预置智谱、DeepSeek、OpenAI、Moonshot、千问 + 自定义）
- API Key 输入（密码类型，选厂家后填对应 key）
- Model 名称（随提供商自动切换默认值，如智谱→glm-4-flash，DeepSeek→deepseek-chat，千问→qwen-plus）
- 保存到 localStorage

### Step 6：应用入口

**新建文件**: `creator/index.html`

标准 Vite 入口 HTML，引用 `creator/src/main.ts`。

**新建文件**: `creator/src/main.ts`

- 创建 Vue app
- 注册 antdv-next
- 注册 @antdv-next/x
- 挂载到 `#app`

---

## 关键设计决策

### 为什么用 @antdv-next/x 而不是 ant-design-x-vue？
- ant-design-vue 维护已放缓，antdv-next 是其接替者（基于 Ant Design v6）
- @antdv-next/x 与 antdv-next 生态一致，长期方向对
- ant-design-x-vue 依赖即将过时的 ant-design-vue
- 虽然目前 @antdv-next/x 较新（25 star），但原型阶段功能够用
- 原型阶段不需要 SDK 的类型系统
- 减少包体积
- SSE 流式用 fetch + ReadableStream 就够了
- 后续需要时可以轻松切换到 SDK

### 为什么用 Vite 代理而不是直接调用 / OpenRouter？
- Vite dev server 是 Node 进程，不受浏览器 CORS 限制
- 浏览器请求同源 `/api/`，Vite 转发到实际 LLM API — 零 CORS 问题
- 支持任意 OpenAI 兼容提供商（智谱、DeepSeek、OpenAI、本地 Ollama 等）
- 不需要引入第三方中间服务（如 OpenRouter）
- 代价：仅开发模式有效，生产部署时需要换成自己的服务端代理或直连

### 迭代能力如何实现？
对话历史中包含之前生成的完整 slides.md，当用户说"修改第二页"时，LLM 可以看到当前所有幻灯片内容并输出修改后的版本。这是最简单的"agent"能力，无需 tool calling。

---

## 验证方式

1. `pnpm install` — 确认依赖安装成功
2. `pnpm creator` — 启动 Creator 应用，浏览器打开
3. 配置 API Key（智谱 / DeepSeek / OpenAI 等）
4. 输入"帮我生成一份述职报告" — 确认 AI 流式生成 slides markdown
5. 右侧预览实时更新 — 确认幻灯片正确渲染
6. 点击导出 — 确认下载的 .md 文件可以用 Slidev 正常打开
7. 测试迭代：输入"增加一页关于项目成果的介绍" — 确认 AI 能在已有基础上修改
8. `pnpm slidev` — 用导出的 slides.md 确认 Slidev 渲染效果一致
