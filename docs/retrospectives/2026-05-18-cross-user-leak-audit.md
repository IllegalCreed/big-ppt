# 2026-05-18 跨账号 slides-store 数据泄漏 — Review 流程 audit

> **关联 commit**:`eccf1c3`(P0 hotfix)/ `9e1d196`(worker ALS 重注 follow-up)/ `f0c08a4`(测试盒区补全)
> **关联 plan**:[plan 25 Phase 10.5 DeckRenderer 解耦](../plans/25-phase10.5-deck-renderer.md)
> **触发**:用户 2026-05-18 dogfood 反馈"AI 修改 X 局部 → 突然冒出别人项目对话",二号账号视角才暴露

---

## 漏洞回顾

**症状**:用户 A 在自己 deck X 跟 AI 聊"领导汇报",回复里突然冒出**别账号别 deck** 的对话内容。

**根因**:`packages/agent/src/slides-store/` 7 个 agent tools(`read_slides` + 6 mutation tools)读写**同一个全局共享文件** `packages/slidev/slides.md`(由 `getPaths().slidesPath` 返,prod 单文件 fs path,**完全没 user / deck 隔离**)。

漏洞链路:
1. 用户 A 在 deck X chat → LLM 调 `write_slides` → 写全局 `slides.md`
2. 用户 B 在 deck Y chat → LLM 调 `read_slides` → 读**同一个** `slides.md` → 拿到 A 的内容
3. LLM 把 A 的内容当作 "current deck" 在 B 的回复里 echo / 引用 / 参考

---

## 为什么没被任何 review 抓到

### 1. Phase 10.5 plan 25 关注点偏前端,backend 漏审

Phase 10.5 plan 文档把"slides.md 仅放映用"作为 design intent:
> **编辑器 ✅ 已脱钩 Slidev**(DeckRenderer Vue 组件直接渲染)
> **全屏放映 ❌ 仍依赖 Slidev runtime**:`window.open('/api/slidev-preview/#/page')` 走 agent 反代

但**前端**脱钩了,**backend agent tools 仍然走 `getPaths().slidesPath`** 这条线 — plan **risk 章节没列**这个跨用户 IDOR 风险。"slides.md 锁的 acquire 点 = POST /api/present/:id"防的是同时**放映**的两个用户,**不防** agent tools 跨用户读写。

### 2. Reviewer scope 聚焦改动 diff,不审 untouched 老路径

Phase 10.5 spec / code reviewer 都看 plan 25 commit 的 diff(前端 DeckRenderer + 锁语义改造),**没主动 grep** `slides-store/` 全局 fs 文件这条线。"既然 plan 没列 risk + diff 没改 slides-store" → reviewer 假设这块继续 work,不审。

后续 Phase 12.7 / 13 / 14 / 15 同理,**所有 reviewer 都假设 backend slides-store 之前 work 就继续 work**,无人重新审视。

### 3. 测试盲区 = 设计盲区

Phase 10.5 / 12.7 / 13 / 14 / 15 累计 970+ agent tests 全过,**但全套零 cross-user case**:
- 没人测过"user A 调 write_slides + user B 调 read_slides → B 拿到 A 的内容"
- slides-store 自带 unit 测全部假设单用户 + 全局 slides.md
- 集成测 routes-tools 单用户跑 happy path,不交叉

测试模板里就没有"deck-scoped tool 必须 cross-user IDOR"这个 case 范式。Reviewer 看测试通过 = 假设无问题。

### 4. Dogfood 单账号不暴露

Lumideck 之前主要单账号 dogfood(用户一人测),A 写完看到 A 自己的内容,**永远不会跨账号触发**。直到二号账号开始用,A 的 chat + B 的 chat **同时活跃** + 工具调用交错,LLM 才会把 A 的内容 echo 给 B。

---

## 改进 checklist

### 写 plan 时(`docs/plans/_TEMPLATE.md`)

强制章节「**跨用户 / 跨 deck 隔离 risk audit**」,每个 Phase plan 必须显式回答:
- 本 Phase 引入的所有进程级 state / fs path / module-level Map<>,是否 per-user/deck 隔离?
- 已有 backend agent tools / async worker / DI seam,是否在 ALS context 里跑(activeDeckId + userId)?
- 测试覆盖里**必有** cross-user IDOR case(user A 写 → user B 读 → 防止串扰)

### Reviewer 必查清单

- `grep -rn 'fs\.\(readFileSync\|writeFileSync\)'` agent src,审每个 fs path 是否 user/deck-scoped
- `grep -rn '^\(const\|let\).*=.*\(new Map<\|new Set<\|\[\]\|{}\)$'` agent src,找 module-level mutable state — key 是否 per-user(`Map<userId, ...>`)?全局共享 Map 是否有 IDOR 防护?
- 任何新加 agent tool 必须走 ALS `getRequestContext()` 校 userId/activeDeckId,不能 fallback 全局 state
- async worker(fire-and-forget Promise)必须用 `runInRequest` 重注 ALS context,从 job 自带字段(userId/deckId)恢复
- 测试模板:**每个**新 deck-scoped endpoint/tool 加 cross-user IDOR case(参考 `slides-store.test.ts` describe 块 `mutation 函数 NoActiveDeck / IDOR 全覆盖` 13 case 套路)

### 跨 Phase 周期性 audit

每 5 个 Phase 节点(Phase 5 / 10 / 15 / 20 ...)做一次:
- grep audit 全局共享 state(fs path / Map<> / Set<>)
- 走一遍"两个 user 同时操作"的手测(单元测 + dogfood mock 一个 user B 看会不会串)
- 跨用户测试 case 数量增长是否跟新工具 / endpoint 同步

---

## CLAUDE.md 「已知坑 → 安全」加 1 条精炼

```
- **任何 backend 进程级 state(fs path / module-level `Map<>` / 全局 cache)必须 per-user/deck 隔离**:
  跨账号串扰漏洞模式 — user A 写共享 state,user B 读到 A 的内容。本项目 Phase 10.5 漏了 backend
  slides-store 走全局 `slides.md` 文件,造成 P0 数据泄漏(2026-05-18 用户报),hotfix `eccf1c3`
  改 DB-based + ALS guard。**通用规则**:agent tools / async worker / cache key 全部走
  `getRequestContext().userId + activeDeckId`,SQL query 必带复合 `WHERE id = ? AND user_id = ?`;
  fs path 加 user/deck suffix 或干脆走 DB。**测试模板**:每个新 deck-scoped 路径必有 cross-user
  IDOR case(user B 用 A 的 deckId → throw,且 A 的 state 零副作用),参考
  `slides-store.test.ts:mutation 函数 NoActiveDeck / IDOR 全覆盖` 套路。详见
  [retrospective](docs/retrospectives/2026-05-18-cross-user-leak-audit.md)
```

---

## 经验总结

1. **plan risk 章节**应该问"如果两个用户同时操作会怎样",不止"功能 work 吗"
2. **reviewer 必跑 cross-cutting grep**(进程级 state / fs / Map),不止 review 当前 commit diff
3. **测试盲区 = 设计盲区**:测试套件**不主动找**漏洞,只验证 plan 想测的;漏洞模式必须**写进测试模板**才能持续防御
4. **dogfood 单账号**永远暴露不出 cross-user bug,二号账号验证(或单测 mock 第二个 user)是发现这类漏洞的唯一路径
5. **改造老 phase 时 grep 全调用方**(eccf1c3 删 persist.ts 前 grep 一次 readers,跟 Phase 12 `llm_settings` 教训一致):"前端解耦 slides.md" 时如果同步 grep `getPaths().slidesPath` 全调用方,会立刻看到 backend tools 仍在读写
