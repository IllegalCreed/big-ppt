# Phase 10.5 Spike 报告

> **关联 plan**：[24-phase10.5-spike.md](./24-phase10.5-spike.md)
> **执行日期**：2026-05-12
> **结论**：**✅ GO** — 正式立 plan 25 落地 Phase 10.5

---

## 一句话总结

DeckRenderer Vue 组件方案在工程上**完全可行**，spike 用 ~200 行新代码（parse-deck 85 + DeckRenderer 80 + register-components 50）就在 creator SPA 内还原出与 Slidev iframe **肉眼无差** 的渲染结果。Phase 11 进程池方案因此可以废弃，Phase 11 范围缩水到「细化 deck-level 锁 + 分享链接 + 容量 spike」。

---

## 实施背景：Phase 7.5 模板分层的复利

spike 之所以小、快、稳，本质是吃了 Phase 7.5 当年的架构红利：

| Phase 7.5 当年的设计决策 | Phase 10.5 spike 收到的红利 |
| ----------------------- | ------------------------- |
| layouts 用 `<style scoped>` + CSS 变量（`--ld-* / --bt-* / --jyd-*`），不写死颜色 | DeckRenderer 直接 import 现有 layout，零改动渲染出正确视觉 |
| 公共组件库（grid 6 + decoration 2 + block 6）全是纯 Vue SFC | `app.component()` 一次性注册 19 个，替代 Slidev 的 unplugin-vue-components |
| 模板私有装饰组件统一 `L*` 前缀放 `components/private/`，跟 layout 紧耦合 | 4 个 private 组件 grep 即得，注册逻辑 100% 显式 |
| logo / 图片走 `${BASE_URL}/templates/<id>/x.png` | creator 端 `public/templates` 软链一次到位，资源 200 |
| 全仓零 Slidev runtime API 依赖（Task A 已验证 0/278 命中） | 不需要 mock 任何 `$slidev / $nav / useNav`，layout 拿过来就能用 |

**结论**：架构投资的复利。Phase 7.5 当时是为「公共组件库跨模板复用」做的，没想到 1 年后给 Phase 10.5 spike 直接铺平了路。

---

## L1：单测覆盖

- `packages/slidev/test/no-slidev-runtime-api.test.ts`：9 tests 全绿，扫 layouts + 4 个 components 子目录共 ≥20 文件，断言 8 类 Slidev runtime 注入 pattern 均无命中
- `packages/creator/src/spike/parse-deck.test.ts`：5 tests 全绿，含两套真实 starter.md fixture

---

## L2：computed style spot check（与 Slidev iframe 数值对照）

> 由用户在浏览器 devtools 实测，**两侧数值完全一致**（用户原话「完全一样」）。

抽样元素：
- `h1` (mainTitle) fontSize
- `.slidev-layout` 计算后的 `--ld-color-brand-primary`
- `.cover-root` backgroundColor
- 图片资源加载状态

**结果**：DeckRenderer 与 Slidev iframe 所有抽样数值对齐，无 token 路径解析错误，无 utility class 行为偏差。

---

## L3：肉眼并排对比

> 用户判定：**完全一样**。

跨 5 页 starter.md（cover / toc / section-title / content / back-cover）每页对比：
- ✅ cover：logo + mainTitle + subtitle + 汇报人 + 日期 全部对齐
- ✅ toc：编号 + 标题 + 装饰一致
- ✅ section-title：章节号 + 章节名 + 大色块定位一致
- ✅ content：layout 框架 / 标题 / `<slot />` 槽位呈现正确（body 内 `<TwoCol>` 嵌套 markdown 解析见下面 Gap）
- ✅ back-cover：结束语 + 页脚一致

---

## 已知 Gap（Phase 10.5 落地时必须解决）

### Gap 1：body markdown 编译

**现状**：spike 把 body 当 raw string `v-html` 塞进 `<slot />`，markdown 不转 HTML，Vue 标签（如 `<TwoCol>`）不参与运行时编译。

**对正式渲染的影响**：content / image-content 类 layout 的 body 区域字段会丢嵌套结构（标题/列表/Vue 组件用法）。

**Phase 10.5 落地方案**：用 `@vue/compiler-sfc` 或 `vue/dist/vue.esm-bundler` 接 runtime template compiler，把 markdown body 先经 `marked`/`unified` → 含 Vue 标签的 HTML 字符串 → 用 Vue 的 `compile()` 编译成 render 函数挂到动态组件。预计工作量 1 天。

### Gap 2：跨模板 layout 切换的「未注册 layout」提示

**现状**：starter 与 templateId 不匹配时（如喂 beitou starter 给竞业达模板），layout 字段是 `beitou-*` 落不到 jingyeda 表里，DeckRenderer 渲染 unknown 提示框。

**Phase 10.5 落地不在意**：实际使用场景 templateId 永远跟 layout 前缀一致；切模板由 `switch_template` 工具改写 markdown 解决，而非 DeckRenderer 自适应。

### Gap 3：`<v-clicks>` / `<v-click>` 渐进点击动画

**现状**：spike 完全不支持。

**Phase 10.5 落地策略**：roadmap 已写明可放弃或自写 ~30 行；内部汇报场景几乎不用。落地优先级 P3。

### Gap 4：手工 `app.component()` 注册 → 换 unplugin-vue-components + auto-import

**现状**：`packages/creator/src/spike/register-slidev-components.ts` 硬编码 19 个组件名。

**为什么 spike 这么写**：unplugin-vue-components 在 monorepo 跨包扫描配置（`dirs: ['../slidev/components/**']` + dts 路径 + resolvers）需要调试；spike 2 小时跑通比配 plugin 半小时更划算。Hand-list 显式可读，spike 报告里能直接 grep 看到所有依赖。

**代价**：加新组件改两处（slidev 加 + creator spike 加一行）；跟 Slidev 内部栈不对齐（Slidev 自己用 unplugin-vue-components）。

**Phase 10.5 落地方案**：creator 接 `unplugin-vue-components` + `unplugin-auto-import`，对齐 Slidev 内部栈，新组件自动发现。同时 `defineProps / ref / computed` 等 Vue API 走 auto-import 省掉显式 import。预计工作量 0.5 天，含 dts 路径 + monorepo 跨包 dirs glob 调试。

### Gap 5：演讲者模式 / 录制 / 黑板 / 浏览全屏

**现状**：spike 不实现。

**Phase 10.5 落地策略**：roadmap 已写明这些 Slidev 专属功能不做替代。我们是编辑器不是演讲软件。需要演讲时仍然走 Slidev 静态构建（plan 25 范围内会保留 build-time Slidev 用于「分享链接」场景的静态托管）。

---

## Phase 10.5 落地工作量重估

roadmap 原估「5-8 天」。基于 spike 的实际进展，重估如下：

| Task | 估时 | 备注 |
| ---- | ---- | ---- |
| Gap 1 修复（body markdown + Vue 标签运行时编译） | 1.5 天 | 关键路径 |
| Gap 4 修复（unplugin-vue-components + auto-import 替手工注册） | 0.5 天 | 对齐 Slidev 内部栈 |
| 接 DeckEditorPage / SlidePreview 替换 iframe | 2 天 | 涉及 useSlideStore / 反应式 prop 更新代替 HMR |
| ChatPanel busy 状态与 DeckRenderer 交互 / 异常态 UI | 0.5 天 | |
| 删除 agent slidev-lock / slidev-proxy-auth / slidev-restart 路由 | 0.5 天 | 简化部署架构 |
| 删除 lumideck-slidev pm2 进程 + nginx 反代条目 | 0.5 天 | plan 19 部署收敛 |
| L4 截图自动对比基线（Playwright × 12 layout） | 1 天 | 落地必须，spike 跳过 |
| 全量回归 + E2E 改造（不再依赖 Slidev iframe selector） | 1 天 | |
| 文档更新（CLAUDE.md 已知坑收敛 / plan 25 关闭报告） | 0.5 天 | |
| **总计** | **7.5 天** | 略超 roadmap 估计上限（多 Gap 4 的 0.5 天） |

**额外收益**：
- 部署架构大幅简化（Slidev 进程 + agent 反代 + WebSocket upgrade 全删，nginx 配置缩一半）
- long session HMR 缓存错位问题根治（Phase 11.6 dogfood 踩坑 13）
- Phase 11 范围缩水：进程池 + LRU + 崩溃重拉 全部废弃，剩 deck-level 锁 + 分享链接 + 容量 spike

---

## 不可接受差异点（合规要求中需展示的失败判据）

**0 项命中**。本 spike 未触发以下任一硬失败：
- ❌ markdown 解析需 >200 行额外代码绕开 Slidev 特殊指令 → 实际 85 行
- ❌ UnoCSS rule 行为不一致 → 实际整步跳过（layouts 不用 UnoCSS utility）
- ❌ token 路径解析错误 → 用户 L2 + L3 双确认无差异

---

## 后续动作

1. **本 spike 分支 `spike/phase10.5-deck-renderer` archive**（不合并到 main）— spike 代码（`packages/creator/src/spike/*`、`packages/creator/public/templates` 软链）整体会被 plan 25 正式实现覆盖重写，仓库里留在 spike 分支供日后回看
2. **roadmap.md Phase 10.5 状态改为「spike 已通过（2026-05-12），待落地 plan 25」**
3. **下一步**：跟用户对齐 plan 25 启动时机 —— 是接着做（spike 余温还在），还是先解决其他优先级
