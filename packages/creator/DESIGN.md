# Lumideck · 幻光千叶 — DESIGN.md

> 本文件供人类设计者 **和** AI 编码代理共同消费。格式参考 [VoltAgent / awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的 Stitch 9-section 约定。实现侧的 CSS Variables 见 [`src/styles/tokens.css`](src/styles/tokens.css)；修改本文件时必须同步 tokens 文件，反之亦然。

## 1. Visual Theme

**Warm terracotta editorial.** 暖米底 + 陶土色点缀 + 编辑器式克制排版。灵感来源 Claude（Anthropic）的视觉语言——适合需要长时间阅读与思考的 AI 协作界面：没有冷蓝色的紧迫感，没有纯黑的刚硬，留白充裕、层级清晰、节奏从容。

- 左侧 ChatPanel 是"案头工作区"，暖米底 + 舒展间距；
- 中间分割线是"书脊"，可见但不抢戏；
- 右侧 SlidePreview 外框是"卡纸衬底"，把 Slidev 黑色幻灯片包住作为过渡，避免冷暖直接冲撞；
- 强调色（terracotta）只用在少数交互要点上：主 CTA、accent 选中态、斜杠命令名、活动 tab 下划线。

## 2. Color Palette

### 背景层（暖米白 off-white）

| Token                  | Hex       | 用法                                |
| ---------------------- | --------- | ----------------------------------- |
| `--color-bg-app`       | `#F7F4EC` | 应用最外层底色                      |
| `--color-bg-surface`   | `#FBF9F2` | 卡片 / 面板 / ChatPanel             |
| `--color-bg-surface-2` | `#F1ECDF` | SlidePreview 外框卡纸色（核心过渡） |
| `--color-bg-elevated`  | `#FFFFFF` | Modal 内容区（需纯净白底处）        |
| `--color-bg-subtle`    | `#EDE7D7` | Hover 浮层 / input 悬浮底           |

### 文字层

| Token                  | Hex       | 用法                            |
| ---------------------- | --------- | ------------------------------- |
| `--color-fg-primary`   | `#1F1E1B` | 主标题（不用纯黑）              |
| `--color-fg-secondary` | `#3D3929` | 正文                            |
| `--color-fg-tertiary`  | `#6F6A5A` | 次要说明（替代原 `#666`）       |
| `--color-fg-muted`     | `#9A9383` | 弱提示、分隔符（替代原 `#999`） |

### 边框

| Token                   | Hex       | 用法                                  |
| ----------------------- | --------- | ------------------------------------- |
| `--color-border`        | `#E3DCC8` | 常态卡片 / input 边框                 |
| `--color-border-strong` | `#CFC6AE` | **Divider 专用**——需更可见的分隔      |
| `--color-border-subtle` | `#EDE7D7` | 最弱分隔（tab 底 / modal section 线） |

### Accent（terracotta，替代 Ant Design 蓝 `#1677ff`）

| Token                  | Hex       | 用法                             |
| ---------------------- | --------- | -------------------------------- |
| `--color-accent`       | `#C15F3C` | 主强调：按钮、激活态、斜杠命令名 |
| `--color-accent-hover` | `#A94E2E` | Hover / pressed                  |
| `--color-accent-soft`  | `#F3DACE` | Badge 底、选中态 light bg        |
| `--color-accent-fg`    | `#FFFFFF` | Accent 色上的文字                |

### 语义状态（暖调，禁用 `#52c41a` / `#ff4d4f`）

| Token                  | Hex       | 用法               |
| ---------------------- | --------- | ------------------ |
| `--color-success`      | `#6B8E4E` | 暖橄榄绿（已连接） |
| `--color-success-soft` | `#E4E9D5` | 成功 soft bg       |
| `--color-warning`      | `#C98A2B` | 暖琥珀             |
| `--color-warning-soft` | `#F4E5C5` | 警告 soft bg       |
| `--color-danger`       | `#B4472C` | 陶土红（错误）     |
| `--color-danger-soft`  | `#F1D5C9` | 错误 soft bg       |

## 3. Typography

- **Sans (UI 主力)**：`Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif`
- **Serif (标题 / 品牌)**：`'Source Serif 4', 'Noto Serif SC', Georgia, serif`
- **Mono (代码 / URL)**：`ui-monospace, 'SF Mono', Menlo, monospace`

字号阶梯（`--fs-*`）：`11 / 12 / 13 / 14 / 16 / 20 / 24`。正文基准 13，UI 控件 14，段落标题 16，页面标题 20-24。

字重（`--fw-*`）：`400 regular / 500 medium / 600 semibold`。**不使用 700 及以上**——和暖色系的沉稳气质冲突。

行高（`--lh-*`）：紧凑 1.25（UI 单行）/ 常规 1.5（正文）/ 舒展 1.7（长段落）。

## 4. Component Stylings

### Button

| 类型          | 背景                 | 文字                   | 边框                       | Hover                               |
| ------------- | -------------------- | ---------------------- | -------------------------- | ----------------------------------- |
| Primary (CTA) | `--color-accent`     | `--color-accent-fg`    | 无                         | bg → `--color-accent-hover`         |
| Secondary     | `--color-bg-surface` | `--color-fg-secondary` | `1px solid --color-border` | border → `--color-accent`，文字同色 |
| Ghost         | transparent          | `--color-fg-tertiary`  | 无                         | bg → `--color-bg-subtle`            |

所有按钮：`border-radius: var(--radius-md)`；`padding: var(--space-2) var(--space-4)`（8/16）；`font-size: var(--fs-md)`；`transition: all var(--dur-fast) var(--ease-out)`。

### Input

`padding: var(--space-2) var(--space-3)`（8/12）；`border: 1px solid var(--color-border)`；`border-radius: var(--radius-md)`；`font-size: var(--fs-md)`；focus 态 `border-color: var(--color-accent)` + `outline: 2px solid var(--color-accent-soft)`。

### Card

`background: var(--color-bg-surface)`；`border: 1px solid var(--color-border)`；`border-radius: var(--radius-md)`；`padding: var(--space-4) var(--space-5)`（16/20）；`gap: var(--space-3)`（12）；hover 加 `box-shadow: var(--shadow-xs)`。

状态卡片（如 MCP）：用 `box-shadow: inset 3px 0 0 <status-color>` 做左侧状态条，**不要**把整个 border 染色——整圈染色会让卡片看起来"坏掉"。

### Badge

`padding: var(--space-1) var(--space-2)`（4/8）；`font-size: var(--fs-sm)`；`border-radius: var(--radius-sm)`；默认 `background: var(--color-accent-soft)` + `color: var(--color-accent-hover)`。

### Tab

常态：`color: var(--color-fg-tertiary)`，下方无边框；
激活：`color: var(--color-accent)` + `border-bottom: 2px solid var(--color-accent)`；
hover：`color: var(--color-fg-secondary)`。

### Modal

Overlay：`background: rgba(70, 54, 30, 0.35)`（暖调半透明，非 `rgba(0,0,0,*)`）；
Content：`background: var(--color-bg-elevated)`；`border-radius: var(--radius-lg)`；`box-shadow: var(--shadow-md)`；
Header / Footer 用 `border-color: var(--color-border-subtle)` 分隔。

### Divider（App 级拖拽分割线）

宽 6px；`background: var(--color-border-strong)`（`#CFC6AE`）；中央加 3-dot handle（`::before` 绝对定位 3 个 2×2px 圆点纵向排列，色 `var(--color-fg-muted)`）；
hover / active 时 background → `var(--color-accent)`，handle 色 → `var(--color-accent-fg)`；
transition：`background var(--dur-base) var(--ease-out)`。

## 5. Layout Principles

- **左右分屏黄金比**：ChatPanel 40% / SlidePreview 60% 起步，拖拽范围 20%-70%（保持现有约束）
- **Header 刚性 48px 高**：暖米底 surface；标题左对齐，工具按钮右对齐；底 border `--color-border-subtle`
- **Editorial 留白**：面板 padding 最小 `--space-4`（16px），卡片内最小 `--space-4 --space-5`（16/20），不吝惜空间
- **信息密度**：同一面板内不超过 3 个主层级；卡片列表 `gap: var(--space-5)`（20px），比常规 12-14px 更舒展
- **iframe 过渡**：黑色 Slidev 幻灯片外必须套 1px 细边（`--color-border`）+ 至少 `--space-4` 的 padding，避免黑色直贴暖色底

## 6. Depth & Elevation

三层阴影映射（都是暖 rgba，不用纯黑）：

| Token         | 值                                  | 语义                                 |
| ------------- | ----------------------------------- | ------------------------------------ |
| `--shadow-xs` | `0 1px 2px rgba(70, 54, 30, 0.06)`  | 卡片 hover 浮起 / input focus        |
| `--shadow-sm` | `0 2px 6px rgba(70, 54, 30, 0.08)`  | 浮层（tooltip / dropdown / preview） |
| `--shadow-md` | `0 8px 24px rgba(70, 54, 30, 0.12)` | Modal / popover                      |

不要叠加超过 `--shadow-md` 的深度——整体应保持"纸面"感而非"玻璃"感。

## 7. Do's

✅ **用 accent 做强交互点**：主 CTA、激活 tab、斜杠命令高亮、focus ring
✅ **用暖灰而非冷灰**：文字 / border / muted 全部走 warm scale（`#6F6A5A` 而非 `#666`）
✅ **status 用暖语义色**：橄榄绿 / 陶土红 / 琥珀黄
✅ **分割线 / 边框弱化**：除 divider 外，border 都用最弱的 `--color-border-subtle`
✅ **行距宽松**：正文至少 1.5，长段落 1.7
✅ **过渡用 `--ease-out` + `--dur-fast`**：感觉"回弹一下就停"，不拖沓

## 8. Don'ts

❌ **不用冷蓝** `#1677ff`、`#4096ff`、`#e6f4ff`、`#91caff`
❌ **不用鲜艳绿 / 红** `#52c41a`、`#ff4d4f`（Ant Design 默认）
❌ **不用纯黑文字** `#000` / `#111`；最深用 `--color-fg-primary` `#1F1E1B`
❌ **不用纯白背景**（除 Modal）——会破坏整体暖色氛围
❌ **不在 accent 上叠 accent**（terracotta 按钮里放 terracotta badge）
❌ **不把整圈 border 染色**表示状态；用左侧 3px inset shadow 代替
❌ **不用 700+ 字重**——与克制气质冲突

## 9. Responsive Behavior

本阶段 Lumideck creator **桌面优先**（`>= 1024px`）。

预留断点约定（Phase 4/5 时实装）：

- `sm`: `>= 640px` — 单列对话，隐藏预览区
- `md`: `>= 768px` — 左右分屏但 ChatPanel 最小 320px
- `lg`: `>= 1024px` — 当前完整布局
- `xl`: `>= 1440px` — 预览区可 cap 到 1200px 固定宽，居中

触摸设备：divider 加宽至 12px（命中区）；hover 态失效时用 active pressed 状态替代。

---

## 参考实现

- Tokens: [`src/styles/tokens.css`](src/styles/tokens.css)
- 组件消费示例：参见 [`src/components/MCPCatalogItem.vue`](src/components/MCPCatalogItem.vue) 中的 card styling
- 上游灵感：[Claude DESIGN.md @ getdesign.md](https://getdesign.md/claude/design-md)
