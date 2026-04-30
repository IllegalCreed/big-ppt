# Phase 11.7 — 栅格组件库收敛（按内容数量定组件）

> **状态**：进行中
> **前置阶段**：[plan 21-phase11.6-image-first.md](21-phase11.6-image-first.md) ✅
> **后续阶段**：Phase 11
> **路线图**：[roadmap.md Phase 11.7](../requirements/roadmap.md#phase-117栅格组件库收敛按内容数量定组件)
> **执行子技能**：`superpowers:executing-plans`（与用户对齐 + 5 commit 串行落地）

**Goal**：把 grid 类组件从"按形状区分"的 7 个收敛成按"内容数量分桶"的 5 个。LLM 数完页面要承载几个平级元素就直接选对应组件，决策面更窄、语义更清晰。

---

## 关键设计抉择（2026-04-30 与用户对齐）

1. **按内容数量分桶**：2-4 平级走 EqualSplit / 1 主 3 从走 OneVsThree / 田字格 4 等格走 TwoColumnsTwoRows / 5-6 平级走 SixGrid / 8-9 平级走 NineGrid。Why：原"按形状"分（TwoCol vs ThreeCol vs FourCol）让 LLM 反复 grep 决策树；按数量直接对应，LLM 数完即选。

2. **EqualSplit 用 `count + direction` 而非 `rows + cols`**：`count: 2|3|4` + `direction?: 'row'|'col'` (default 'row')。Why：直观对话语义（"3 列" → `count=3` 明显于 `cols=3 rows=1`），LLM 更容易稳定生成。`rows+cols` 灵活但需 LLM 推理 default。

3. **TwoColumnsTwoRows 田字格保留独立**：不并入 EqualSplit。Why：田字格语义"4 维度对比"（SWOT 类）跟 EqualSplit 的"4 平铺阶段"不同；slot 容量也不一样（田字格每格更大）。两组件并存让 LLM 按语义而非数量选。

4. **SixGrid 用 `layout: '2x3' | '3x2'` 双字符串**：default `'3x2'`。Why：双字符串直接表达拓扑，比 `cols=2/3 + rows 倒推`更直白；LLM 看 prompt 一眼对应。

5. **NineGrid 中央装饰用显式 prop**：加 `:show-center-decoration?: boolean` (default false) + `#decoration` slot。Why：slot 推断（用户传 #decoration 自动切模式）容易歧义；显式 prop 让 LLM 选 8/9 模式时意图明确。

6. **OneVsThree direction 扩 4 方向**：`'left' | 'right' | 'top' | 'bottom'` (default 'left')。Why：取代 OneTopThreeBottom，垂直主从同框架。

7. **不做向后兼容 wrapper**：旧标签 `<TwoCol>` / `<ThreeCol>` / `<OneTopThreeBottom>` 直接删，沿用 Phase 11.6 Commit 10 同款策略（切模板时 LLM 自动重写到新组件）。Why：wrapper 维护负担大，且旧 deck 切模板本来就要 rewrite。

---

## ⚠️ Secrets 安全红线

- 本 Phase 不引入新环境变量
- 本 Phase 不动 `.gitignore`、不入新机密
- commit 全部走 `git add` 显式列文件

---

## 组件结构变更对照表

### 新增

| 文件 | 职责 |
| ---- | ---- |
| `packages/slidev/components/grid/EqualSplit.{vue,test.ts,meta.ts}` | 2-4 平级元素，`count + direction` 控制单行多列 / 单列多行 |
| `packages/slidev/components/grid/SixGrid.{vue,test.ts,meta.ts}` | 5-6 平级元素，`layout: '2x3' \| '3x2'` 控制拓扑 |

### 修改

| 文件 | 改动摘要 |
| ---- | -------- |
| `packages/slidev/components/grid/OneVsThree.{vue,test.ts,meta.ts}` | direction 类型 `'left' \| 'right'` 扩到 `'left' \| 'right' \| 'top' \| 'bottom'`，纵向主从用 `grid-template-rows` |
| `packages/slidev/components/grid/NineGrid.{vue,test.ts,meta.ts}` | 加 `showCenterDecoration?: boolean` prop + `#decoration` slot；true 时 slot1..slot8 围 + 中央装饰 |
| `packages/slidev/components/_catalog/index.ts` | grid 列表去掉 TwoCol/ThreeCol/OneTopThreeBottom，加 EqualSplit/SixGrid |
| `packages/slidev/templates/{beitou,jingyeda}-standard/manifest.json` | commonComponents 列表 + bodyGuidance 文本同步 |
| `packages/agent/test/prompts-ab-contract.test.ts` | 栅格类组件清单断言更新（7 → 6 grid 名） |
| `packages/slidev/components/COMPONENTS.md` | 文档同步 |

### 删除

| 文件 | 原因 |
| ---- | ---- |
| `packages/slidev/components/grid/TwoCol.{vue,test.ts,meta.ts}` | 被 EqualSplit(count=2) 取代 |
| `packages/slidev/components/grid/ThreeCol.{vue,test.ts,meta.ts}` | 被 EqualSplit(count=3) 取代 |
| `packages/slidev/components/grid/OneTopThreeBottom.{vue,test.ts,meta.ts}` | 被 OneVsThree(direction='top') 取代 |

---

## 阶段拆分

5 个 commit 串行落地：

### Commit A：立项 Phase 11.7 + plan 22 + roadmap

本文档 + roadmap.md 11.7 段。

### Commit B：EqualSplit 新组件取代 TwoCol + ThreeCol

新建 EqualSplit 三件套（.vue / .test.ts / .meta.ts）；删 TwoCol + ThreeCol 各三件套；catalog index + 两个 manifest 同步；contract 测试断言更新。

**验证**：slidev test 39 → 40+pass（新组件 5+ 测试，删 4 个老测试）；agent prompts-ab-contract 断言更新后 pass。

### Commit C：OneVsThree direction 扩 4 方向 + 删 OneTopThreeBottom

OneVsThree 加 'top' | 'bottom' direction 支持（用 grid-template-rows 控制纵向主从）；删 OneTopThreeBottom 三件套；catalog + manifest 同步。

**验证**：OneVsThree.test.ts 加 4 方向断言全 pass；slidev/agent suite 全绿。

### Commit D：SixGrid 新组件 + NineGrid 加中央装饰 mode

新建 SixGrid 三件套（layout '2x3'/'3x2'）；NineGrid 加 `showCenterDecoration` prop + `#decoration` slot；catalog + manifest + contract 测试同步。

**验证**：SixGrid 新测试 + NineGrid 扩展测试全 pass；agent prompts-ab-contract 断言更新后 pass。

### Commit E：COMPONENTS.md 文档收敛

更新组件文档，删旧组件段，加新组件段。

---

## 验收条件

- [ ] grid 7 → 6 个（EqualSplit / OneVsThree / TwoColumnsTwoRows / SixGrid / NineGrid / ImageText）
- [ ] 旧标签 `<TwoCol>` / `<ThreeCol>` / `<OneTopThreeBottom>` 在 catalog / manifest 全清
- [ ] OneVsThree 4 方向（left/right/top/bottom）单测覆盖
- [ ] SixGrid 两种 layout（2x3/3x2）单测覆盖
- [ ] NineGrid 双 mode（9 slot 平铺 / 8 slot + center 装饰）单测覆盖
- [ ] agent prompts-ab-contract 全绿
- [ ] slidev components 套全绿（每新组件 ≥ 4 个测试覆盖 default + props 各分支）

---

## 不做什么（范围围栏）

- ❌ TwoColumnsTwoRows 合并到 EqualSplit（用户明确说保留）
- ❌ 旧组件 thin wrapper 兼容（切模板 LLM 重写已经够）
- ❌ ImageText 重构（语义独立）
- ❌ 给老 deck 写迁移脚本（数据库里 slides.md 用旧标签的 deck 由用户主动切模板触发 rewriteForTemplate 自动迁移）
