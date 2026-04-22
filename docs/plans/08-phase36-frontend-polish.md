# Phase 3.6 — 前端美化（Lumideck · 幻光千叶）实施计划

> **For agentic workers:** 本阶段以视觉重塑为主，CSS 为核心产物。所有 step 使用 `- [ ]` checkbox 语法跟踪进度。

**状态**：已完成（2026-04-22）
**关联**：路线图 [Phase 3.5 关闭](07-mcp-integration.md) · 本计划由 brainstorming 对话产出（plan 文件：`.claude/plans/docs-chatui-mcp-design-md-chromedevtool-humble-swan.md`）

**Goal**：给 `packages/creator` 引入暖赤陶色系 Design Tokens + DESIGN.md，并据此重做产品头、分割线、预览外框、MCP 设置卡片等关键组件，让项目从"Big-PPT Creator"正式换装为 **Lumideck · 幻光千叶**，在进入 Phase 4 的编辑能力之前补齐视觉层。

**Style Reference**：Claude DESIGN.md（warm terracotta accent, clean editorial layout）

**Tech Stack**：Vue 3.5 + Vite + antdv-next + Scoped CSS + CSS Variables；**不引入** Tailwind / UnoCSS。

---

## Context

[07-mcp-integration.md](07-mcp-integration.md) 关闭后功能完整但视觉底座缺失，三个具体触发点：

1. **产品身份缺席**：`index.html` / `App.vue` 仍是工程名 `Big-PPT Creator`
2. **分割线看不见**：`App.vue` 的 `.divider { background: #e8e8e8 }` 与 `SlidePreview.vue` 的 `.preview-panel { background: #e8e8e8 }` 撞色，6px 拖拽把手视觉消失
3. **MCP 卡片丑挤**：`MCPCatalogItem.vue` 全线偏紧（padding 12/14、gap 8、badge/input/status 11-13px），且 status 用 Ant Design 冷艳绿 `#52c41a` / 红 `#ff4d4f`

在功能层不改动的前提下把 creator 视觉重铸成"看起来是成品"。清零范围限定 creator 自身的硬编码色值；[99-tech-debt.md](99-tech-debt.md) 里的 **P2-3（slidev templates tokens）不在本阶段范围**，留给 Phase 4 P1-5 架构升级时做；两套 token 命名空间独立（creator 用 `--color-*` / slidev 沿用 `--brand-*`）。

## 架构决策（2026-04-22）

| 决策            | 选择                                                                        | 理由                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Token 载体      | CSS Variables 在 `:root`                                                    | 全部消费方是 Scoped CSS，`var()` 零胶水；TS export 需 `v-bind()`/inline style，侵入大                                                           |
| CSS 引擎        | 维持原生 Scoped CSS                                                         | antdv-next reset.css 与 Tailwind preflight 潜在冲突；slidev 已因 UnoCSS 66.x bug 走离线图标预生成（P3-7），creator 再引 UnoCSS 会拉进同一风险面 |
| antdv-next 主题 | 在 `App.vue` 用 `<ConfigProvider :theme>` 包裹根节点                        | `@antdv-next/x` 的 Bubble/Sender 跟随变色，免去手写 `:deep()`                                                                                   |
| DESIGN.md 位置  | `packages/creator/DESIGN.md`                                                | 设计消费者是 creator；与 `src/styles/tokens.css` 共存；AI 编码代理在 creator 上下文里能直接读到                                                 |
| 字体策略        | System font stack（Inter → PingFang SC → Microsoft YaHei 回退；标题 serif） | 不自托管字体（见新 P3-NEW）                                                                                                                     |
| 状态色          | 暖橄榄绿 `#6B8E4E` / 陶土红 `#B4472C`（非 `#52c41a` / `#ff4d4f`）           | 与 terracotta accent 协调                                                                                                                       |
| 卡片状态指示    | 左侧 3px `inset box-shadow`，不染整圈 border                                | 整圈染色让卡片"看起来坏了"                                                                                                                      |

## 不做什么（范围围栏）

- ❌ `packages/slidev` 任何改动
- ❌ 新 UI 库（Tailwind / UnoCSS / shadcn-vue）
- ❌ 字体自托管
- ❌ 响应式断点实装（只在 DESIGN.md 预留约定）
- ❌ 深色模式切换

## File Structure

### Created

| 操作   | 文件                                                                                     | 责任                                                                    |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Create | [`packages/creator/src/styles/tokens.css`](../../packages/creator/src/styles/tokens.css) | Color / Spacing / Radius / Shadow / Typography / Motion 全套 token 声明 |
| Create | [`packages/creator/DESIGN.md`](../../packages/creator/DESIGN.md)                         | Stitch 9-section 设计规范                                               |
| Create | [`docs/plans/08-phase36-frontend-polish.md`](08-phase36-frontend-polish.md)              | 本文件                                                                  |

### Modified

| 文件                                                                                                               | 改动要点                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| [`packages/creator/index.html`](../../packages/creator/index.html)                                                 | title → `Lumideck · 幻光千叶`                                                                                                |
| [`packages/creator/src/main.ts`](../../packages/creator/src/main.ts)                                               | 在 reset.css 后 `import './styles/tokens.css'`                                                                               |
| [`packages/creator/src/components/App.vue`](../../packages/creator/src/components/App.vue)                         | 引入 `ConfigProvider + theme`；header 改中英双行品牌；toolbar / title / btn / divider 全部 token 化；divider 加 3-dot handle |
| [`packages/creator/src/components/SlidePreview.vue`](../../packages/creator/src/components/SlidePreview.vue)       | `.preview-panel` bg → `--color-bg-surface-2`（卡纸色，解除撞色）；按钮 + iframe 外框全 token 化                              |
| [`packages/creator/src/components/ChatPanel.vue`](../../packages/creator/src/components/ChatPanel.vue)             | bg、status-bar、cancel-btn、VNode 内联 style（斜杠候选 + 工具错误）全 token 化                                               |
| [`packages/creator/src/components/SettingsModal.vue`](../../packages/creator/src/components/SettingsModal.vue)     | overlay 改暖调、modal shadow token 化、tabs accent 下划线、modal-body gap 20、form / btn 全 token 化                         |
| [`packages/creator/src/components/MCPCatalogItem.vue`](../../packages/creator/src/components/MCPCatalogItem.vue)   | 卡片 padding 16/20 + gap 12；badge / input / status 字号与间距放宽；状态条用 inset shadow；状态色用暖语义                    |
| [`packages/creator/src/components/MCPCustomServer.vue`](../../packages/creator/src/components/MCPCustomServer.vue) | 与 MCPCatalogItem 同 token 集；submit 用 accent                                                                              |
| [`README.md`](../../README.md)                                                                                     | 同步 Lumideck · 幻光千叶 品牌头，更新为 monorepo 结构说明                                                                    |
| [`docs/plans/99-tech-debt.md`](99-tech-debt.md)                                                                    | 变更记录 + 新增 P3-NEW（字体自托管）与 P2-NEW 占位                                                                           |

## 实施步骤

- [x] **Step 1 · tokens + DESIGN.md**：创建 tokens.css + DESIGN.md，main.ts import；build 过
- [x] **Step 2 · 品牌头换装**：index.html title + App.vue header + README
- [x] **Step 3 · divider + preview 外框**：解除 `#e8e8e8` 撞色，divider 加 handle
- [x] **Step 4 · MCPCatalogItem 重做**：核心槽点修复，状态用 inset shadow
- [x] **Step 5 · ChatPanel token 化**：含 VNode 内联 style
- [x] **Step 6 · SettingsModal + MCPCustomServer token 化**
- [x] **Step 7 · antdv-next ConfigProvider**：theme.token 覆盖 colorPrimary 等
- [x] **Step 8 · build / lint / test 回归 + 收尾文档**

## 验收条件

1. ✅ `packages/creator/src/styles/tokens.css` 存在并被 `main.ts` import（顺序在 `antdv-next/dist/reset.css` 之后）
2. ✅ `packages/creator/DESIGN.md` 存在，包含 Stitch 9 个 section
3. ✅ `grep -rn "#1677ff\|#4096ff\|#e6f4ff\|#91caff\|#52c41a\|#ff4d4f"` 在 `packages/creator/src` 下为空
4. ✅ 浏览器 tab 标题为 `Lumideck · 幻光千叶`；App header 显示中英组合（serif 英文 + sans 中文）
5. ✅ `.divider` 与 `.preview-panel` 使用不同 token（`--color-border-strong` vs `--color-bg-surface-2`）
6. ✅ MCPCatalogItem：padding `var(--space-4) var(--space-5)` = 16/20；gap `var(--space-3)` = 12；badge/input/status 字号 ≥ 12px
7. ✅ `pnpm exec turbo run lint test --filter=@big-ppt/creator` 全绿（0 errors；14 warnings 全是 P3-6 遗留 `any`，非本阶段引入）
8. ✅ `pnpm --filter @big-ppt/creator build` 过
9. ⏭ chrome-devtools MCP 截图回归：因本会话未接入 chrome-devtools MCP，推迟到下一次用户本地启动 dev server 时肉眼验证；在 99-tech-debt 记录为 P3-NEW-2

## 风险与后续债务

- 本次未跑**视觉回归截图**。用户手动验证时如发现 antdv-next 内部子组件（如 Bubble / Sender 的 menu / tooltip）颜色仍冷，登记为 **P2-NEW**，修法是在 ChatPanel.vue 用 `:deep()` 覆盖，或等 antdv-next 0.4+ 升级
- 字体目前走 system font stack（Inter / Source Serif 4 / Noto Serif SC），离线场景 / 部分 Windows 用户可能看不到理想字体；登记为 **P3-NEW**，Phase 5 部署前评估 `@fontsource` 自托管

## Critical Files

- [packages/creator/src/styles/tokens.css](../../packages/creator/src/styles/tokens.css)
- [packages/creator/DESIGN.md](../../packages/creator/DESIGN.md)
- [packages/creator/src/components/App.vue](../../packages/creator/src/components/App.vue)
- [packages/creator/src/components/SlidePreview.vue](../../packages/creator/src/components/SlidePreview.vue)
- [packages/creator/src/components/MCPCatalogItem.vue](../../packages/creator/src/components/MCPCatalogItem.vue)
