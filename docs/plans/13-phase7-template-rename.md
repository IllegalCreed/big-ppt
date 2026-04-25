# Phase 7 — 模板系统完善 实施文档

> **状态**：进行中（2026-04-25 启动）
> **前置阶段**：Phase 6 模板系统架构（2026-04-24 关闭，见 [12](12-phase6-template-architecture.md)）
> **后续阶段**：Phase 8 依赖全量升级
> **路线图**：[roadmap.md Phase 7](../requirements/roadmap.md)
> **执行子技能**：参考 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按 task 推进；step 用 checkbox 跟踪。

**Goal**：(1) 把 Phase 6 交付的临时通用模板 `company-standard` 重命名为真实公司 id `beitou-standard`（北投集团），含文件系统 / CSS 命名空间 / DB schema / 代码引用 / 资源路径全套对齐；(2) 完成 Phase 7B 已落地的 jingyeda 视觉骨架对应的工程化对齐；(3) 落地前端选择/切换 UI 与 3 条 E2E spec。

---

## 关键设计抉择（与 brainstorming 期间用户对齐）

1. **拆 4 子步**：7A 重命名 / 7B jingyeda 视觉骨架 / 7C 前端选择切换 UI / 7D 3 条新 E2E spec。**串行增量，每步独立 commit + 测试**。
2. **命名约定**：`<公司 slug>-<用途>`（全拼音 + 小写 slug）。为同一公司未来"festival / product-launch"扩展预留对称结构。
3. **不留 alias**：A 模板硬切，不保留 `company-standard` legacy id。`deck_versions.message` 历史字串"从模板 company-standard 初始化"**保持不动**（append-only 历史事实）。
4. **执行顺序偏离原计划**：原 plan 顺序是 7A→7B→7C→7D 串行，实际执行 **7B→7A→7C→7D**——用户明确要求"先把模板调好再做后面的"，先把 jingyeda 视觉骨架做出来 + 用户在前端预览迭代视觉，再做工程化重命名。
5. **layouts/components 子目录化**：与 jingyeda 当前的 `layouts/jingyeda/` 子目录结构对齐，beitou 的 7 个 layout 也搬到 `layouts/beitou/` 子目录并加 `beitou-` 前缀。共用组件 `LCoverLogo` / `LTitleBlock` / `LMetricCard` 加 `LBeitou` 前缀，components 仍平铺（与 LJydHeader 风格一致）。
6. **CSS 变量命名空间**：beitou 的 `--c-*` / `--ff-*` / `--logo-red-filter` 全部改为 `--bt-*` 前缀，与 jingyeda 的 `--jyd-*` 对称。
7. **DB 迁移**：复用 `scripts/backfill-template-id.ts` 的同样模式新增 `scripts/rename-template-id.ts` 一次性脚本（幂等：第二次运行 affectedRows = 0），同时 schema DEFAULT 用 `drizzle-kit push` 落地。
8. **public/templates/ 副本**：经探查（见 7A-8 task），评估 vite 是否真用 `templates/` alias 还是 public 副本，决定彻底删 / 整体搬迁。
9. **chart 组件 fallback 优化**：当前 chart 组件硬编码红色 fallback（兼容 beitou），7A 后让 beitou-data 也注入 CSS 变量，去掉硬编码。

---

## ⚠️ Secrets 安全红线（HARD，沿用 Phase 5/6）

- `.gitignore` 规则不要动
- 本 Phase **不引入新环境变量**（模板是公开资源）
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表（7A 核心）

| 维度 | 旧 | 新 |
|---|---|---|
| 模板目录 | `packages/slidev/templates/company-standard/` | `packages/slidev/templates/beitou-standard/` |
| Layout 文件 | `packages/slidev/layouts/{cover,toc,content,two-col,data,image-content,back-cover}.vue` | `packages/slidev/layouts/beitou/beitou-{cover,toc,content,two-col,data,image-content,back-cover}.vue` |
| 共用组件 | `packages/slidev/components/{LCoverLogo,LTitleBlock,LMetricCard}.vue` | `packages/slidev/components/{LBeitouCoverLogo,LBeitouTitleBlock,LBeitouMetricCard}.vue` |
| Tokens 命名空间 | `--c-brand` / `--c-bg-page` / `--ff-brand` / `--logo-red-filter` 等 | `--bt-brand` / `--bt-bg-page` / `--bt-ff-brand` / `--bt-logo-red-filter` |
| Manifest layouts[].name | `cover` / `content` / `toc` / `two-col` / `data` / `image-content` / `back-cover` | `beitou-cover` / `beitou-content` / `beitou-toc` / `beitou-two-col` / `beitou-data` / `beitou-image-content` / `beitou-back-cover` |
| starter.md / slides.md layout 引用 | `layout: cover` 等 | `layout: beitou-cover` 等 |
| DB `decks.template_id` 值 | `'company-standard'` | `'beitou-standard'` |
| DB schema DEFAULT | `'company-standard'` | `'beitou-standard'` |
| 资源 URL | `/templates/company-standard/logo-mark.png` 等 | `/templates/beitou-standard/logo-mark.png` 等 |
| public/templates/ 副本 | `public/templates/company-standard/` | 视 vite alias 探查结果决定（删除或迁移） |
| beitou manifest.thumbnail | `"cover.png"`（已 broken — 用户整理时移到 assets/） | 删除字段（与 jingyeda 一致） |

**预估改动面**：tokens 文件 1 个 + layout vue 7 个 + 共用组件 3 个 + slidev global.css + manifest.json + starter.md + creator 2 个文件 + agent prompts 1+ 个 + agent 测试 7+ 个文件 + DB schema + backfill 脚本。当前 `rg "company-standard"` 全仓 152 处（含 jingyeda 自己的 5 处和其他文档），实际待改 ~140 处。

---

## Phase 7B — jingyeda-standard 视觉骨架（已完成）

> 实施期偏离：用户在 brainstorming 时把执行顺序从原计划 7A→7B 临时调换为 7B→7A，先把视觉调通。

**已 commit 5 条**：
- `333a024` docs(phase-7): 拆 7A/7B/7C/7D + 命名约定（roadmap）
- `0fb253a` chore(templates): 清理 company-standard 过期文件 + 整理参考图到 assets/
- `b4be7fd` feat(phase-7b): jingyeda-standard 模板视觉骨架（22 文件 / 1333 insertions）
- `58e23e5` fix(phase-7b): 移除 jingyeda manifest.thumbnail 错误指向参考图
- `cef6944` fix(phase-7b): manifest schema thumbnail 字段改为 optional（解 agent 启动 502）

**Phase 7B 产出清单**：

- `packages/slidev/templates/jingyeda-standard/`：tokens.css（`--jyd-*` 命名空间）/ manifest.json（7 个 layout schema，无 thumbnail）/ starter.md（3 页骨架）/ DESIGN.md（视觉规范）/ logo.png + banner.png（vue 引用）/ assets/（5 张原 PPT 参考截图）
- `packages/slidev/layouts/jingyeda/` 子目录 + 7 个 jingyeda-* layout vue（`jingyeda-cover` / `jingyeda-toc` / `jingyeda-content` / `jingyeda-two-col` / `jingyeda-data` / `jingyeda-image-content` / `jingyeda-back-cover`）
- `packages/slidev/components/LJydHeader.vue`：5 个非封面 layout 共用的顶部色条（蓝 80% + 绿 10% + 留白 10% + 外阴影）
- `packages/slidev/components/BarChart.vue` + `LineChart.vue`：改为 `onMounted` 时从 CSS 变量 `--chart-primary-bg` / `--chart-primary-border` 读色，fallback 红色（保 beitou 兼容）
- `packages/slidev/global.css`：并入 `@import './templates/jingyeda-standard/tokens.css'`
- `packages/slidev/templates/company-standard/`：清理 7 个旧 AI 样本 md + 2 个过期 README + 3 张参考图 rename 到 `assets/`

**实施期细节决策**：
- 字体双栈：`--jyd-ff-brand` 仿宋系（标题 / 正文）+ `--jyd-ff-ui` 微软雅黑（信息栏 / UI 文字 / 公司名）
- 主标题字重不超过 500（仿宋字体不存在 700 字重，synthesized bold 会发糊）
- 蓝色块内 h1 必须显式 `color: #ffffff`（Slidev 默认 h1 color 规则覆盖 inherit）
- 封面三段比例 3:3:4（用户在迭代中调整为底部加大）
- 封底三段比例 3:5:2 + 色块层 2/3:1/3 + message/org 分层（message 占 flex:1 居中、org 贴 flex container 底部）

**遗留待 7A 收尾**：
- jingyeda manifest 缺 thumbnail（Phase 7C 实现 slidev 截图机制时统一为两套模板生成）

---

## Phase 7A — A 模板重命名 company-standard → beitou-standard

### 整体策略

按"从 leaf 到 root"顺序：先迁 tokens（揪出所有未替换 `var(--c-*)`）→ 再迁 layout 文件名 → 再迁组件 → 再迁数据库 → 最后清扫字面量。每步跑一次 `pnpm test` 防回归。

### Task 7A-0：测试基线 + 工作准备

**Files**:
- 无修改

- [ ] **Step 1：跑全测试确认 335 基线**

```bash
cd /Users/zhangxu/workspace/big-ppt
pnpm test
```

Expected: agent 281 + creator 49 = 330 passing；如有不同记录新基线（基数会因 7B chart 改动而微变）。

- [ ] **Step 2：跑 E2E 确认基线**

```bash
pnpm e2e
```

Expected: 5 passing。

- [ ] **Step 3：确认 git 干净**

```bash
git status
```

Expected: `working tree clean` 或仅有 `slides.md` 未跟踪。

---

### Task 7A-1：tokens.css 命名空间迁移 `--c-*` → `--bt-*`

策略：**先改 tokens.css 把变量重命名 → 跑 vite，所有 layout/component 里 `var(--c-*)` 全变 undefined（视觉崩溃）→ 反推哪些文件需要替换**。这是揪出所有引用最快的办法。

**Files**:
- Modify: `packages/slidev/templates/company-standard/tokens.css`（全文重写变量名）
- Modify: `packages/slidev/global.css`（注释引用更新）
- Modify: `packages/slidev/components/{LCoverLogo,LTitleBlock,LMetricCard}.vue`（var() 引用全改）
- Modify: `packages/slidev/layouts/{cover,toc,content,two-col,data,image-content,back-cover}.vue`（var() 引用全改）

- [ ] **Step 1：tokens.css 把所有 `--c-*` / `--ff-*` / `--logo-red-filter` 改为 `--bt-` 前缀**

新内容（`packages/slidev/templates/company-standard/tokens.css`）：

```css
/*
 * beitou-standard theme tokens
 *
 * 与 jingyeda-standard 的 --jyd-* 命名空间并存，独立前缀避免冲突。
 */

:root {
  /* 品牌主色 */
  --bt-brand: #d00d14;
  --bt-brand-mid: #c00b11;
  --bt-brand-deep: #a8090e;
  --bt-brand-gradient: linear-gradient(180deg, #d00d14 0%, #c00b11 60%, #a8090e 100%);

  /* 前景 / 背景 */
  --bt-fg-primary: #333333;
  --bt-fg-muted: #666666;
  --bt-bg-page: #ffffff;
  --bt-bg-subtle: #f5f5f5;

  /* 字体 */
  --bt-ff-brand: "Microsoft YaHei", "微软雅黑", sans-serif;

  /* Logo 红色滤镜（把黑色 logo 文字染成 --bt-brand） */
  --bt-logo-red-filter: invert(87%) sepia(98%) saturate(4811%) hue-rotate(352deg) brightness(82%)
    contrast(100%);
}
```

- [ ] **Step 2：grep 找出所有引用旧变量的文件**

```bash
grep -rln "\-\-c-brand\|\-\-c-bg\|\-\-c-fg\|\-\-ff-brand\|\-\-logo-red-filter" packages/slidev/
```

Expected：列出 12 个文件（global.css + 3 components + 7 layouts + tokens.css 自己已改 = 11 个待改 + tokens.css）。

- [ ] **Step 3：在每个文件里批量替换变量名**

对每个文件运行：

```bash
sed -i '' 's/--c-brand-gradient/--bt-brand-gradient/g; s/--c-brand-deep/--bt-brand-deep/g; s/--c-brand-mid/--bt-brand-mid/g; s/--c-brand/--bt-brand/g; s/--c-bg-page/--bt-bg-page/g; s/--c-bg-subtle/--bt-bg-subtle/g; s/--c-fg-primary/--bt-fg-primary/g; s/--c-fg-muted/--bt-fg-muted/g; s/--ff-brand/--bt-ff-brand/g; s/--logo-red-filter/--bt-logo-red-filter/g' packages/slidev/global.css packages/slidev/components/LCoverLogo.vue packages/slidev/components/LTitleBlock.vue packages/slidev/components/LMetricCard.vue packages/slidev/layouts/cover.vue packages/slidev/layouts/toc.vue packages/slidev/layouts/content.vue packages/slidev/layouts/two-col.vue packages/slidev/layouts/data.vue packages/slidev/layouts/image-content.vue packages/slidev/layouts/back-cover.vue
```

⚠️ 顺序重要：长前缀（`--c-brand-gradient` 等）必须在短前缀（`--c-brand`）前面替换，否则会被截断。

- [ ] **Step 4：验证无遗漏**

```bash
grep -rn "var(--c-\|var(--ff-\|var(--logo-red-filter" packages/slidev/
```

Expected: 0 hits（除了 jingyeda 模板里的 `--jyd-*` 不在范围；jingyeda 的 DESIGN.md 文档里如有提及 `--c-*` 作为对比文档不需改，确认即可）。

- [ ] **Step 5：起 slidev dev 检查视觉无回归**

```bash
pnpm -F @big-ppt/slidev dev
# 浏览器访问 http://localhost:3031/api/slidev-preview/ 验证 beitou starter.md 显示正常
```

Expected: 视觉与 7A 之前完全一致（所有红色品牌色 / 字体正确显示）。

- [ ] **Step 6：跑测试**

```bash
pnpm test
```

Expected: 全绿（tokens 重命名不应影响 vitest）。

- [ ] **Step 7：commit**

```bash
git add packages/slidev/global.css \
        packages/slidev/templates/company-standard/tokens.css \
        packages/slidev/components/LCoverLogo.vue \
        packages/slidev/components/LTitleBlock.vue \
        packages/slidev/components/LMetricCard.vue \
        packages/slidev/layouts/{cover,toc,content,two-col,data,image-content,back-cover}.vue && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): beitou tokens 命名空间从 --c-* 迁到 --bt-*

为与 jingyeda 的 --jyd-* 命名空间对称，beitou 的 CSS 变量全部加 bt- 前缀。
visual 零回归，所有 layouts / components 同步更新 var() 引用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-2：模板目录改名 templates/company-standard/ → beitou-standard/

**Files**:
- Rename: `packages/slidev/templates/company-standard/` → `packages/slidev/templates/beitou-standard/`
- Modify: `packages/slidev/templates/beitou-standard/manifest.json`（id / name / description / promptPersona 字段）
- Modify: `packages/slidev/templates/beitou-standard/DESIGN.md`（标题 / 措辞）
- Modify: `packages/slidev/global.css`（@import 路径）

- [ ] **Step 1：git mv 整个目录**

```bash
cd /Users/zhangxu/workspace/big-ppt
git mv packages/slidev/templates/company-standard packages/slidev/templates/beitou-standard
```

- [ ] **Step 2：改 manifest.json**

修改 `packages/slidev/templates/beitou-standard/manifest.json` 头部三字段：

```json
{
  "id": "beitou-standard",
  "name": "北投集团汇报模板",
  "description": "商务正式风格，品牌红（#d00d14）主色 + 无衬线字体，适合北投集团业务汇报、OKR 共识与发布会。",
  ...
  "promptPersona": "你为使用「北投集团汇报模板」的用户服务，请保持商务正式的叙述语气。视觉由 layout + tokens 决定，不要在 slides.md 中写 <style>、硬编码颜色或字体。AI 只负责结构与内容。",
  ...
}
```

同时**删除 `thumbnail` 字段**（参照 jingyeda 7B 的 fix；原值 `"cover.png"` 已 broken — 文件被搬到 `assets/`）。

- [ ] **Step 3：改 DESIGN.md 标题和措辞**

把 DESIGN.md 顶部的"公司标准汇报模板 - 设计规范"改为"北投集团汇报模板 - 设计规范"，正文里所有"公司标准模板"改为"北投集团汇报模板"。

```bash
sed -i '' 's/公司标准汇报模板/北投集团汇报模板/g; s/公司标准模板/北投集团汇报模板/g' packages/slidev/templates/beitou-standard/DESIGN.md
```

- [ ] **Step 4：改 global.css @import 路径**

```css
/* packages/slidev/global.css */
@import './templates/beitou-standard/tokens.css';   /* 原 company-standard */
@import './templates/jingyeda-standard/tokens.css';
```

- [ ] **Step 5：grep 找剩余的 `templates/company-standard` 路径引用**

```bash
grep -rn "templates/company-standard" packages/slidev/ packages/agent/ packages/creator/
```

Expected: vue 里 `src="/templates/company-standard/logo-mark.png"` 等约 5-8 处。下一 task 处理这些资源 URL。先标记。

- [ ] **Step 6：起 slidev dev + 跑 vitest 确认 beitou 模板加载正常**

```bash
pnpm -F @big-ppt/slidev dev   # 视觉检查
pnpm -F @big-ppt/agent test   # API 测试可能因路径变化 fail（routes-templates / template-manifest 等）→ 进 task 7A-3 修
```

⚠️ 此 step 测试可能 fail，因为代码里仍有 `'company-standard'` 字面量引用 — 7A-3 之后才能全绿。

- [ ] **Step 7：commit**

```bash
git add packages/slidev/global.css packages/slidev/templates/beitou-standard/ && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): templates/company-standard → templates/beitou-standard 目录改名

manifest id / name / description / promptPersona 同步更新；
删除 thumbnail 字段（broken reference，参考图已在 assets/，等 7C 生成真缩略图）。
DESIGN.md 措辞改成「北投集团汇报模板」。
global.css @import 路径同步。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-3：layouts/ + 共用组件加 beitou 前缀 + 子目录化

**Files**:
- Rename: `packages/slidev/layouts/{cover,toc,content,two-col,data,image-content,back-cover}.vue` → `packages/slidev/layouts/beitou/beitou-{name}.vue`
- Rename: `packages/slidev/components/{LCoverLogo,LTitleBlock,LMetricCard}.vue` → `LBeitouCoverLogo.vue` / `LBeitouTitleBlock.vue` / `LBeitouMetricCard.vue`
- Modify: 3 个 layout（cover / data / back-cover）里的 `<LCoverLogo>` / `<LTitleBlock>` / `<LMetricCard>` 模板引用改前缀

- [ ] **Step 1：建子目录 + git mv 7 个 layout**

```bash
cd /Users/zhangxu/workspace/big-ppt
mkdir -p packages/slidev/layouts/beitou
git mv packages/slidev/layouts/cover.vue packages/slidev/layouts/beitou/beitou-cover.vue
git mv packages/slidev/layouts/toc.vue packages/slidev/layouts/beitou/beitou-toc.vue
git mv packages/slidev/layouts/content.vue packages/slidev/layouts/beitou/beitou-content.vue
git mv packages/slidev/layouts/two-col.vue packages/slidev/layouts/beitou/beitou-two-col.vue
git mv packages/slidev/layouts/data.vue packages/slidev/layouts/beitou/beitou-data.vue
git mv packages/slidev/layouts/image-content.vue packages/slidev/layouts/beitou/beitou-image-content.vue
git mv packages/slidev/layouts/back-cover.vue packages/slidev/layouts/beitou/beitou-back-cover.vue
```

- [ ] **Step 2：git mv 3 个共用组件加 LBeitou 前缀**

```bash
git mv packages/slidev/components/LCoverLogo.vue packages/slidev/components/LBeitouCoverLogo.vue
git mv packages/slidev/components/LTitleBlock.vue packages/slidev/components/LBeitouTitleBlock.vue
git mv packages/slidev/components/LMetricCard.vue packages/slidev/components/LBeitouMetricCard.vue
```

- [ ] **Step 3：替换 layout 内的组件引用**

```bash
sed -i '' 's/<LCoverLogo /<LBeitouCoverLogo /g; s/<\/LCoverLogo>/<\/LBeitouCoverLogo>/g; s/<LCoverLogo>/<LBeitouCoverLogo>/g; s/<LTitleBlock /<LBeitouTitleBlock /g; s/<\/LTitleBlock>/<\/LBeitouTitleBlock>/g; s/<LTitleBlock>/<LBeitouTitleBlock>/g; s/<LMetricCard /<LBeitouMetricCard /g; s/<\/LMetricCard>/<\/LBeitouMetricCard>/g; s/<LMetricCard>/<LBeitouMetricCard>/g' packages/slidev/layouts/beitou/*.vue
```

- [ ] **Step 4：验证无遗漏组件引用**

```bash
grep -rn "<LCoverLogo\|<LTitleBlock\|<LMetricCard\|</LCoverLogo>\|</LTitleBlock>\|</LMetricCard>" packages/slidev/
```

Expected: 0 hits（jingyeda 不引用这些组件）。

- [ ] **Step 5：起 slidev dev 验证**

```bash
pnpm -F @big-ppt/slidev dev
```

确认 beitou starter.md 视觉正常（layout 名 `cover` / `toc` 等还**没改**，先验证文件改名 + 组件 rename 不破坏）。

⚠️ 如果 slidev 因 layout name 集合改变而 404，看下一 step 的 manifest + slides 引用更新。

- [ ] **Step 6：commit**

```bash
git add packages/slidev/layouts/ packages/slidev/components/ && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): beitou layouts 子目录化 + 共用组件加 LBeitou 前缀

- layouts/{cover,toc,content,two-col,data,image-content,back-cover}.vue 移到 layouts/beitou/beitou-*.vue
- components/{LCoverLogo,LTitleBlock,LMetricCard} 改名加 LBeitou 前缀
- 3 个 layout 内的 <LCoverLogo> 等模板引用同步更新

与 jingyeda 的 layouts/jingyeda/ + LJydHeader 命名风格对称。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-4：manifest layouts[].name 加 beitou- 前缀 + starter.md 引用更新

**Files**:
- Modify: `packages/slidev/templates/beitou-standard/manifest.json`（layouts[].name 7 处）
- Modify: `packages/slidev/templates/beitou-standard/starter.md`（layout: 引用 3 处）

- [ ] **Step 1：改 manifest layouts[].name**

```bash
sed -i '' 's/"name": "cover"/"name": "beitou-cover"/g; s/"name": "toc"/"name": "beitou-toc"/g; s/"name": "content"/"name": "beitou-content"/g; s/"name": "two-col"/"name": "beitou-two-col"/g; s/"name": "data"/"name": "beitou-data"/g; s/"name": "image-content"/"name": "beitou-image-content"/g; s/"name": "back-cover"/"name": "beitou-back-cover"/g' packages/slidev/templates/beitou-standard/manifest.json
```

⚠️ 上面 sed 顺序中 `back-cover` 必须在 `cover` 前面，否则前者会被部分替换。

- [ ] **Step 2：改 starter.md 的 layout 引用**

```bash
sed -i '' 's/^layout: cover$/layout: beitou-cover/; s/^layout: content$/layout: beitou-content/; s/^layout: back-cover$/layout: beitou-back-cover/' packages/slidev/templates/beitou-standard/starter.md
```

- [ ] **Step 3：验证 manifest 和 starter 内字面量一致**

```bash
cat packages/slidev/templates/beitou-standard/starter.md
grep '"name"' packages/slidev/templates/beitou-standard/manifest.json
```

Expected: starter 用了 3 个 layout 名（`beitou-cover` / `beitou-content` / `beitou-back-cover`），manifest 7 个 layout 都带前缀。

- [ ] **Step 4：起 slidev dev + 用 starter.md 试预览**

```bash
# 临时把 beitou starter 拷到 slides.md 预览（不 commit slides.md）
cp packages/slidev/templates/beitou-standard/starter.md packages/slidev/slides.md
pnpm -F @big-ppt/slidev dev
```

Expected: 3 页 starter 渲染正常。

- [ ] **Step 5：commit**

```bash
git add packages/slidev/templates/beitou-standard/manifest.json packages/slidev/templates/beitou-standard/starter.md && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): beitou manifest layouts[].name + starter.md 加 beitou- 前缀

跟随 layout vue 文件名变化，manifest 中 7 个 layout name 加前缀，
starter.md 的 layout: 引用同步。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-5：资源 URL 路径 `/templates/company-standard/` → `/templates/beitou-standard/`

**Files**:
- Modify: 所有 vue 里 `src="/templates/company-standard/..."` 引用（约 5-8 处，多见于 LBeitouCoverLogo / LBeitouTitleBlock / 部分 layout）

- [ ] **Step 1：grep 找所有引用**

```bash
grep -rn "/templates/company-standard/" packages/
```

Expected: 5-8 处（vue 里 src / background-image url）。

- [ ] **Step 2：批量替换**

```bash
grep -rl "/templates/company-standard/" packages/ | xargs sed -i '' 's|/templates/company-standard/|/templates/beitou-standard/|g'
```

- [ ] **Step 3：验证无遗漏**

```bash
grep -rn "/templates/company-standard/" packages/
```

Expected: 0 hits。

- [ ] **Step 4：起 slidev dev 验证 logo 等图片仍能加载**

```bash
pnpm -F @big-ppt/slidev dev
# 浏览器开 devtools network 面板，确认 logo-mark / logo-text 等 200 OK
```

- [ ] **Step 5：commit**

```bash
git add packages/ && git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): 资源 URL /templates/company-standard/ → /templates/beitou-standard/

vue 里 logo / texture 等 src 路径同步目录改名。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-6：DB schema DEFAULT + 数据迁移脚本

**Files**:
- Modify: `packages/agent/src/db/schema.ts`（line 66 DEFAULT 改）
- Create: `packages/agent/scripts/rename-template-id.ts`（一次性数据迁移）
- Modify: `packages/agent/scripts/backfill-template-id.ts`（DEFAULT_TEMPLATE_ID 常量改 + 注释更新）

- [ ] **Step 1：改 schema.ts DEFAULT**

[`packages/agent/src/db/schema.ts:66`](../../packages/agent/src/db/schema.ts#L66) 把 `.default('company-standard')` 改为 `.default('beitou-standard')`。

```ts
templateId: varchar('template_id', { length: 64 })
  .default('beitou-standard')
  .notNull(),
```

- [ ] **Step 2：drizzle-kit push 把新 DEFAULT 推到数据库**

```bash
cd packages/agent
pnpm exec dotenv -e .env.development.local -- drizzle-kit push
```

⚠️ 注意：MySQL 的 ALTER DEFAULT 不会改已存在 row 的值，需要下一 step UPDATE 显式迁移数据。

- [ ] **Step 3：写一次性数据迁移脚本**

Create `packages/agent/scripts/rename-template-id.ts`：

```ts
/**
 * Phase 7A 一次性数据迁移：把 decks.template_id 由 'company-standard' 改为 'beitou-standard'。
 *
 * 幂等：第二次运行 affectedRows = 0。
 * 用法：
 *   # 预览要改的行数
 *   pnpm -F @big-ppt/agent exec tsx scripts/rename-template-id.ts --dry-run
 *   # 实际写入
 *   pnpm -F @big-ppt/agent exec tsx scripts/rename-template-id.ts
 */
import { config as loadDotenv } from 'dotenv'
if (!process.env.DATABASE_URL) {
  loadDotenv({ path: ['.env.development.local', '.env.local'] })
}

import mysql from 'mysql2/promise'

const DRY_RUN = process.argv.includes('--dry-run')
const FROM_ID = 'company-standard'
const TO_ID = 'beitou-standard'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL 未设置；确认 .env.development.local 或通过 dotenv-cli 注入')
  }

  const conn = await mysql.createConnection(url)
  try {
    const [toFix] = (await conn.query(
      `SELECT id, user_id, title, template_id
         FROM decks
        WHERE template_id = ?`,
      [FROM_ID],
    )) as [Array<{ id: number; user_id: number; title: string; template_id: string }>, unknown]

    console.log(`[rename] 检测到 ${toFix.length} 条 deck 需要从 ${FROM_ID} 改为 ${TO_ID}`)
    if (toFix.length > 0) {
      for (const row of toFix.slice(0, 10)) {
        console.log(`  · id=${row.id} user_id=${row.user_id} title=${row.title}`)
      }
      if (toFix.length > 10) console.log(`  · ...（剩余 ${toFix.length - 10} 条未展示）`)
    }

    if (DRY_RUN) {
      console.log('[rename] --dry-run 模式，未实际写入')
      return
    }

    if (toFix.length === 0) {
      console.log('[rename] 无需要更新的记录，幂等退出')
      return
    }

    const [result] = (await conn.execute(
      `UPDATE decks SET template_id = ? WHERE template_id = ?`,
      [TO_ID, FROM_ID],
    )) as [{ affectedRows: number; changedRows: number }, unknown]

    console.log(`[rename] 更新完成：affectedRows=${result.affectedRows} changedRows=${result.changedRows}`)
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('[rename] 失败:', err)
  process.exit(1)
})
```

- [ ] **Step 4：dry-run + 实际跑迁移**

```bash
cd packages/agent
pnpm exec tsx scripts/rename-template-id.ts --dry-run
# 检查输出条数后
pnpm exec tsx scripts/rename-template-id.ts
# 验证幂等
pnpm exec tsx scripts/rename-template-id.ts
# Expected: affectedRows = 0
```

- [ ] **Step 5：更新 backfill-template-id.ts 默认 ID 常量**

[`packages/agent/scripts/backfill-template-id.ts:24`](../../packages/agent/scripts/backfill-template-id.ts#L24) 把 `const DEFAULT_TEMPLATE_ID = 'company-standard'` 改为 `'beitou-standard'`，同时更新顶部注释里的"回填为 `company-standard`"为"回填为 `beitou-standard`"，注释中提到 schema DEFAULT 的部分也同步。

- [ ] **Step 6：commit**

```bash
git add packages/agent/src/db/schema.ts packages/agent/scripts/rename-template-id.ts packages/agent/scripts/backfill-template-id.ts && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): DB schema DEFAULT + decks 数据迁移到 beitou-standard

- schema.ts: decks.template_id DEFAULT 'company-standard' → 'beitou-standard'（drizzle push 落地）
- 新增 scripts/rename-template-id.ts 一次性迁移脚本（幂等：第二次 affectedRows=0）
- backfill-template-id.ts 同步默认常量

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-7：测试 fixtures + agent 代码引用全量替换

**Files**:
- Modify: `packages/agent/test/{template-manifest,template-switch-job,routes-templates,routes-decks,routes-switch-template,routes-tools,prompts-ab-contract,templates-registry,tools-local}.test.ts`
- Modify: `packages/agent/src/{workspace.ts,tools/local/list-templates.ts,tools/local/switch-template.ts,routes/decks.ts,routes/templates.ts}` 等
- Modify: `packages/creator/src/composables/useAIChat.ts`
- Modify: `packages/creator/src/prompts/buildSystemPrompt.ts`

- [ ] **Step 1：grep 找全部剩余的 `'company-standard'` / `"company-standard"` 字面量**

```bash
grep -rn "['\"]company-standard['\"]" packages/agent/ packages/creator/ packages/shared/
```

Expected: ~50-80 hits 分布在测试 fixtures + 默认值 + 注释。

- [ ] **Step 2：批量替换字面量**

```bash
grep -rl "['\"]company-standard['\"]" packages/agent/src packages/agent/test packages/agent/scripts packages/creator/src packages/shared 2>/dev/null | xargs sed -i '' "s/'company-standard'/'beitou-standard'/g; s/\"company-standard\"/\"beitou-standard\"/g"
```

- [ ] **Step 3：grep layout 名替换（cover / toc 等出现在 prompt fixture / 测试断言里）**

```bash
grep -rn "'cover'\|'toc'\|'content'\|'two-col'\|'data'\|'image-content'\|'back-cover'" packages/agent/test/prompts-ab-contract.test.ts packages/agent/src/prompts/ 2>/dev/null
```

⚠️ 这步需要人工 review — 不能盲目替换 `'cover'` 等单词，可能误伤无关变量。逐文件 review。如有 layout name 引用，逐个改成 `'beitou-cover'` 等带前缀的。

- [ ] **Step 4：跑 agent 测试**

```bash
pnpm -F @big-ppt/agent test
```

⚠️ 第一次跑可能 fail，根据 fail 信息逐个修复 fixture / 断言文本。

- [ ] **Step 5：跑 creator 测试**

```bash
pnpm -F @big-ppt/creator test
```

- [ ] **Step 6：所有测试全绿后 commit**

```bash
git add packages/agent/ packages/creator/ packages/shared/ && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): agent / creator / 测试 全量字面量替换 company-standard → beitou-standard

包含：
- src 默认值 / fixtures
- agent 测试 7 个文件断言文本
- prompts 系统提示词中 layout 名引用（带 beitou- 前缀）
- creator useAIChat / buildSystemPrompt 默认值

测试全绿，行为零变化（仅命名空间迁移）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-8：public/templates/ 副本探查 + 处理

**Files**:
- 评估：`packages/slidev/public/templates/company-standard/`（含 logo-mark.png + logo-text.png）
- 可能 Modify: 新增 `public/templates/beitou-standard/` + `public/templates/jingyeda-standard/` 副本
- 可能 Delete: 原 `public/templates/company-standard/`

- [ ] **Step 1：弄清楚 vite 实际从哪 serve `/templates/...`**

```bash
# 临时删 public 副本，看 slidev dev 是否还能加载 logo
mv packages/slidev/public/templates/company-standard /tmp/_test_public_backup
pnpm -F @big-ppt/slidev dev
# 浏览器开 devtools network 面板看 /templates/beitou-standard/logo-mark.png 是否 200
```

- [ ] **Step 2A（如果还能 200 加载）：删除 public 副本**

vite 有 templates/ alias 或 slidev 内置静态服务。直接删：

```bash
rm -rf /tmp/_test_public_backup
git rm -r packages/slidev/public/templates/company-standard
```

- [ ] **Step 2B（如果加载失败）：搬迁副本**

需要 public 副本作为静态资源根。把 logo-mark / logo-text 副本搬到新模板目录：

```bash
mv /tmp/_test_public_backup packages/slidev/public/templates/beitou-standard
git add packages/slidev/public/templates/beitou-standard
git rm packages/slidev/public/templates/company-standard  # 老路径已不再被引用

# jingyeda 同理也需要 public 副本
mkdir -p packages/slidev/public/templates/jingyeda-standard
cp packages/slidev/templates/jingyeda-standard/logo.png packages/slidev/public/templates/jingyeda-standard/logo.png
cp packages/slidev/templates/jingyeda-standard/banner.png packages/slidev/public/templates/jingyeda-standard/banner.png
git add packages/slidev/public/templates/jingyeda-standard
```

- [ ] **Step 3：commit**

```bash
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): public/templates/ 副本处理（探查 + 删除/迁移 见下文）

[根据 step 2A 或 2B 的实际结果填具体描述]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-9：chart 组件 fallback 优化（beitou-data 注入 CSS 变量）

7B 时 chart 组件改为读 CSS 变量，beitou 的 data layout 还没注入变量，所以走 fallback 红色（硬编码）。这步把硬编码 fallback 去掉，beitou 也用 CSS 变量声明。

**Files**:
- Modify: `packages/slidev/layouts/beitou/beitou-data.vue`（注入 `--chart-primary-bg` / `--chart-primary-border`）

- [ ] **Step 1：在 beitou-data.vue 的 chart wrap 加 CSS 变量**

把 chart slot wrap 区域的 css 加上变量：

```css
.data-body .chart-wrap {  /* 或对应的 selector，按 layout 实际命名 */
  --chart-primary-bg: rgba(208, 13, 20, 0.85);
  --chart-primary-border: #a8090e;
}
```

- [ ] **Step 2：BarChart / LineChart 的 fallback 改为空（确保任何模板都必须显式注入）**

可选：把 [`packages/slidev/components/BarChart.vue:31-32`](../../packages/slidev/components/BarChart.vue#L31-L32) 的 fallback 默认值改成中性（如 `'#999999'`）或空字符串，让任何模板都必须显式注入变量，避免漏注入时静默 fallback。

- [ ] **Step 3：跑 slidev dev + 全测试验证**

```bash
pnpm -F @big-ppt/slidev dev
pnpm test
```

- [ ] **Step 4：commit**

```bash
git add packages/slidev/layouts/beitou/beitou-data.vue packages/slidev/components/BarChart.vue packages/slidev/components/LineChart.vue && \
git status && \
git commit -m "$(cat <<'EOF'
refactor(phase-7a): beitou-data 注入 chart CSS 变量，去除组件硬编码 fallback

beitou-data 现在显式声明 --chart-primary-bg / --chart-primary-border。
chart 组件 fallback 改中性色（避免任何模板漏注入时静默使用品牌色）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7A-10：全量验证 + 关闭

**Files**:
- Modify: `docs/requirements/roadmap.md`（Phase 7 状态从"待开始"改为"7A 已关闭，进 7C/7D"）

- [ ] **Step 1：跑全测试 + E2E**

```bash
pnpm test       # agent + creator
pnpm e2e        # 5 条
```

Expected: 全绿。

- [ ] **Step 2：grep 验证 `company-standard` 字面量已清光**

```bash
rg "company-standard" --type-not md
```

Expected: **0 hits**（md 文件里只剩 `deck_versions.message` 的历史字串说明 + 路线图变更记录的历史描述，这些不算回归）。

- [ ] **Step 3：起 slidev + creator + agent 全套，过一遍 starter（beitou + jingyeda）**

```bash
pnpm dev
# 浏览器登录 → 新建 deck（默认 beitou 模板）→ 看 starter 视觉
# 切到 jingyeda → 看视觉
# 全程无报错
```

- [ ] **Step 4：更新 roadmap.md Phase 7 状态**

把 [`docs/requirements/roadmap.md`](../requirements/roadmap.md) Phase 7 段的"状态：待开始"改为标注"7A 已关闭（YYYY-MM-DD），7B 已完成（视觉骨架，4 条 commit），7C/7D 待启动"。

加一条变更记录到末尾：

```markdown
| 2026-04-?? | Phase 7A 关闭：tokens 命名空间 --c-* → --bt-* / templates/company-standard → beitou-standard 全套重命名（layouts 子目录化 + 共用组件 LBeitou 前缀 + manifest layouts[].name 加前缀 + DB schema DEFAULT + 数据迁移 + 资源 URL + public 副本处理 + 测试 fixtures），全仓零 company-standard 字面量残留，测试全绿 | 第二套模板 jingyeda 已落地，需要对称的命名空间；硬切无 alias |
```

- [ ] **Step 5：commit roadmap 关闭记录**

```bash
git add docs/requirements/roadmap.md && git status && \
git commit -m "$(cat <<'EOF'
docs(phase-7a): roadmap 标注 7A 关闭 + 变更记录

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7C — 前端选择 / 切换 UI（待 7A 关闭后另写 plan 14）

**预计交付物**：

- 新建 deck 弹窗：命名 input + 模板选择器（缩略图卡片 + 描述 + hover preview）
- 编辑页模板切换入口（顶栏按钮 / 菜单项）
- Confirm dialog：强调"内容将被 AI 重写、当前版本自动快照、失败可 /undo"
- 重写进度指示
- 结果页：成功 toast / 失败 + /undo 入口
- 同时为两套模板生成真实缩略图（slidev export 截图机制）补回 manifest.thumbnail

**待 brainstorming 决定的设计点**：弹窗位置 / 选择器风格 / 切换文案 / 缩略图生成时机。等 7A 关闭后启动 7C brainstorming。

## Phase 7D — 3 条新 E2E spec（待 7C 关闭后另写 plan 15）

**预计 spec 列表**：

- `packages/e2e/tests/template-create.spec.ts`：新建 deck → 选 jingyeda 模板 → deck 初始化 → 编辑器渲染
- `packages/e2e/tests/template-switch.spec.ts`：旧 deck（beitou）→ 切换到 jingyeda → confirm → AI 重写 → 内容合规
- `packages/e2e/tests/template-undo.spec.ts`：切模板后 /undo → 回到旧模板 + 旧内容

具体步骤等 7C UI 落地后写。

---

## 验收（Phase 7A 部分，与 roadmap 对齐）

- [ ] **零回归**：`pnpm test` 全绿；`rg "company-standard"` 仅剩 `deck_versions.message` 里的历史字串
- [ ] **DB 迁移幂等**：`decks` 表所有 `company-standard` 记录均已迁到 `beitou-standard`，schema DEFAULT 同步；rename-template-id.ts 第二次运行 affectedRows = 0
- [ ] **视觉零回归**：beitou starter / 现有 deck 切回时，红色 / 字体 / logo 等所有视觉与 7A 之前完全一致
- [ ] **jingyeda 不受影响**：jingyeda 模板可正常加载、视觉完整
- [ ] **chart 主题正确**：beitou data 页 chart 红色，jingyeda data 页 chart 蓝色

---

## 不做什么（范围围栏）

- ❌ Phase 7A 内**不做**前端 UI（弹窗 / 切换按钮）—— 留 7C
- ❌ Phase 7A 内**不做**新 E2E spec —— 留 7D
- ❌ Phase 7A 内**不做** beitou 视觉风格调整（Phase 7B 时也保持 beitou 视觉不变）
- ❌ 不为旧 id `company-standard` 保留兼容别名（硬切）
- ❌ 不在 7A 内做缩略图（thumbnail）生成机制 — 留 7C 补

---

## 执行期偏离（关闭后追加）

- **执行顺序**：原计划 7A → 7B 串行；实际用户主动调成 7B → 7A（"先把视觉调好再做工程化"）
- **commit 合并**：plan 13 把 7A 拆 11 个 task，实际把 7A-2/5/6/7 合并为单一 commit `cfbad77`，避免中间红测试状态
- **`public/templates/` 副本删除**：7B 实测发现 slidev cli 默认 `vite server.fs.allow` 已放开 user root，副本完全冗余，commit `7e9e699` 顺手删

---

## 踩坑与解决

### 坑 1：manifest.thumbnail 必填导致 agent 启动 502

- **症状**：7B 加 jingyeda 时 manifest schema 把 `thumbnail` 设成 required，但当时还没截图，agent 启动 schema 校验失败 502
- **根因**：截图脚本要 7C 才落地，但 schema 把字段当必填
- **修复**：commit `cef6944` — manifest schema 的 `thumbnail` 改 optional
- **防再犯**：新增字段时先 optional，数据齐了再考虑收紧；schema 校验失败要给明确错误
- **已提炼到 CLAUDE.md**：否（一次性 schema 演进）

### 坑 2：chart 组件硬编码 fallback 跨模板冲突

- **症状**：beitou data 页 chart 显示 jingyeda 蓝（或反之）
- **根因**：BarChart / LineChart 等组件 fallback 写死 `#d00d14`（beitou 红），切到 jingyeda 仍取该 fallback
- **修复**：commit `e6918e1` — chart fallback 改中性灰，beitou-data 页面在 layout 里显式注入红色
- **防再犯**：跨模板共享组件的 fallback 必须中性，模板独有视觉由 layout / token 注入
- **已提炼到 CLAUDE.md**：是（已在"Slidev 包的特殊点"提到）

### 坑 3：模板 id 硬编码字面量散落 ~98 处

- **症状**：7A 重命名 `company-standard` → `beitou-standard` 时全仓 grep 出近百处硬编码字面量
- **根因**：早期未做常量化
- **修复**：commit `cfbad77` 一次性全量替换；新增 `scripts/rename-template-id.ts` 一次性 DB 数据迁移脚本（dev/prod 各跑一次，幂等）
- **防再犯**：未来命名都遵循 `<公司 slug>-<用途>` 约定；模板 id 集中常量化（P9 仓库卫生清理时复检）
- **已提炼到 CLAUDE.md**：否（已是历史包袱）

---

## 测试数量落地

| 阶段 | agent | creator | E2E | 合计  |
| ---- | ----- | ------- | --- | ----- |
| 入口（Phase 6 收）| 281 | 49 | 5 | 335 |
| 7B 收（视觉骨架，无新测） | 281 | 49 | 5 | 335 |
| 7A 收（重命名，无新测） | 281 | 49 | 5 | **335** |

> 本 plan 范围内不涉及新增测试（纯重构 + 视觉骨架）。7C 起测试数量增长，详见 [plan 14](14-phase7c-template-ui.md) / [plan 15](15-phase7d-e2e-and-undo-fix.md)。
