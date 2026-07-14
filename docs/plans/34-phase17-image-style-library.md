# Phase 17 — 配图风格资产库与选择流程重构

> **状态**：✅ 已完成（2026-07-11；待提交 / 推送 / 部署）
> **前置阶段**：[plan 32 Phase 11.8 锚图选样](32-phase11.8-anchor-image-styling.md) / [plan 33 Phase 16 放映与分享](33-phase16-presentation-viewer.md)
> **后续阶段**：Phase 18+ 按真实使用反馈立项
> **路线图**：[roadmap.md Phase 17](../requirements/roadmap.md#phase-17配图风格资产库与选择流程重构)
> **执行方式**：Codex multi-agent，后端 / 前端 / 模板与归档分轨，主线程统一集成

**Goal**：把“每个新 deck 都等待 3–5 分钟抽三张样图”的必经流程，改成“系统预设或我的风格即时选择 → AI 探索按需触发 → 满意结果保存并跨 deck 复用”的闭环。继续复用现有单 deck 锚图生成链路，但把可复用风格提升为用户级资产，并让 `.lumideck` 归档完整保留当前风格状态。

---

## 关键设计抉择（2026-07-11 与用户对齐）

1. **预设是主路径，AI 探索是次级动作**：打开风格库绝不自动调用主 LLM 或图片模型；只有用户进入“AI 探索”并明确点击后才生成 3 张。
2. **系统预设属于设计系统内的独立风格包**：跨模板通用的技法元数据与参考图放在 `packages/slidev/image-styles/<id>/`，不散落到 agent；模板仍只在自己的 manifest 声明品牌 palette 和目标尺寸，agent 按尺寸匹配，不维护 template→preset 映射。
3. **首批 12 套预设**：扁平信息图、编辑插画、技术蓝图、等距 3D、黏土 3D、剪纸层叠、柔和水彩、手绘彩铅、水墨线描、包豪斯几何、编辑拼贴、极简线稿。每套含 1280×624 reference 与轻量 preview，覆盖当前两套模板的 `imageGenSize`。
4. **用户风格用专表，不复用 `user_assets`**：上传资料池包含文件抽取、配额和 LLM 工具语义；风格库是图片锚点资产，生命周期和 API 完全不同，混用会污染“我的素材”。
5. **应用时复制为 deck-local anchor**：系统预设或用户风格的图片字节复制到目标 `deck_assets`，再原子切换 `decks.anchor_asset_id`。删除原 deck、删除用户风格或升级系统预设都不影响已经应用的 deck，现有生图工具无需跨表读取。
6. **来源与颜色策略跟 materialized asset 走**：`deck_assets.style_source/style_source_id/style_palette_policy` 保存 `system | user | explore` 来源及 `template | reference` 颜色策略，风格库重开时可正确高亮，生成时也不会让系统 reference 意外压过模板品牌色；不把账号级 preset id 直接塞进 `decks`。
7. **探索 MVP 复用现有 mood-board 生成器，但由独立 202 端点启动内存后台任务**：同一 `userId + deckId` single-flight；请求期间弹窗可关闭、聊天可继续；后端暴露 running 状态，重复触发返 409，前端轮询恢复结果。持久化 job/SSE 与逐张渐进展示不在本 Phase。
8. **首次决策与普通浏览是两个状态**：`decisionPending` 只表示 `generate_slide_image` 正在等待首次选择；普通打开风格库、已有风格重选、后台探索均不禁用 ChatPanel。
9. **按目标图幅而非模板 id 判断兼容**：用户风格保存 reference 宽高；只要目标模板 `imageGenSize` 一致就可跨模板复用。切模板时尺寸兼容则保留当前风格，尺寸不兼容才清空，真正解耦“版式模板”和“配图风格”。
10. **归档升 v2 且继续导入 v1**：v2 保存 asset 的 `style/purpose/styleSource/styleSourceId`，并保存 deck 的 `anchorAssetId/anchorSkipped`；v1 缺失字段按无锚图处理。

---

## ⚠️ Secrets 安全红线

- 不引入新环境变量，不修改任何 `.env.*.local`。
- 系统预设是仓库内公开图片，不含用户或公司机密内容。
- 每次提交前显式检查 `git status`；禁用 `git add -A`、`git add .` 与 `git commit -a`。

---

## 文件结构变更对照表

### 新增

| 文件                                                         | 职责                                    |
| ------------------------------------------------------------ | --------------------------------------- |
| `packages/shared/src/image-style-manifest.ts`                | 系统风格 manifest 类型与纯校验          |
| `packages/slidev/image-styles/<id>/*`                        | 系统风格 manifest、reference 与 preview |
| `packages/agent/src/image-styles/registry.ts`                | 系统风格扫描、文件与尺寸校验            |
| `packages/agent/src/db/user-style-presets.ts`                | 用户风格 CRUD、配额和 materialize 事务  |
| `packages/agent/src/routes/image-style-presets.ts`           | 公开系统风格目录与图片资源 API          |
| `packages/agent/src/routes/style-library.ts`                 | deck 风格库、用户风格与 AI 探索 API     |
| `packages/creator/src/api/image-styles.ts`                   | 风格库 HTTP 调用的唯一前端入口          |
| `packages/creator/src/composables/useImageStyleLibrary.ts`   | 三段式风格库状态与首次决策状态          |
| `packages/creator/src/components/ImageStyleLibraryModal.vue` | 系统预设 / 我的风格 / AI 探索 UI        |
| `docs/plans/34-phase17-image-style-library.md`               | 本实施与关闭记录                        |

### 修改

| 文件                                                       | 改动摘要                                            |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `packages/shared/src/api.ts`                               | 风格库 API 契约                                     |
| `packages/shared/src/archive.ts`                           | `.lumideck` schema v2                               |
| `packages/agent/src/db/schema.ts`                          | `user_style_presets` 表与 deck asset 来源字段       |
| `packages/agent/src/workspace.ts`                          | 新增 `imageStylesRoot` 与测试覆盖路径               |
| `packages/agent/src/tools/local/generate-slide-image.ts`   | 按 anchor palette policy 决定参考图或模板色板优先级 |
| `packages/agent/src/routes/mood-board.ts`                  | 保留探索生成，统一应用与来源语义                    |
| `packages/agent/src/template-switch-job.ts`                | 目标图幅兼容时保留当前风格/free 决策                |
| `packages/creator/src/components/DeckEditorCanvas.vue`     | 风格入口、首次提示和 `style-changed` 同步           |
| `packages/creator/src/components/ChatPanel.vue`            | 仅 `decisionPending` 时禁用输入                     |
| `packages/creator/src/components/ToolExecutionBlock.vue`   | 不再用 modal open 推断阻塞                          |
| `packages/agent/src/archive/*` / `routes/decks-archive.ts` | v2 导出与 v1/v2 导入恢复                            |

### 删除

| 文件                                                     | 原因                           |
| -------------------------------------------------------- | ------------------------------ |
| `packages/creator/src/components/AnchorPickerModal.vue`  | 被三段式风格库替代             |
| `packages/creator/src/composables/useMoodBoardPicker.ts` | 状态语义已不适合“预设优先”流程 |

---

## 数据模型变更

### `user_style_presets`

```ts
id: varchar(36) primary key
userId: int not null references users(id) on delete cascade
sourceTemplateId: varchar(64) nullable // 仅审计来源，不用于兼容判断
sourceAssetId: varchar(36) nullable // 幂等保存来源，不设跨 deck FK
name: varchar(80) not null
style: varchar(64) not null
prompt: text nullable
stylePrompt: text not null // 只描述视觉技法，不携带旧 deck 业务主题
palettePolicy: varchar(16) // template | reference
mimeType: varchar(50) not null
bytesSize: int not null
data: mediumblob not null
width: int nullable
height: int nullable
lastUsedAt: datetime nullable
createdAt / updatedAt: timestamp
```

限制：每用户最多 30 个风格、总字节最多 100MB；保存时复制图片字节，不持有源 `deck_assets` 外键。

### `deck_assets` 新字段

```ts
styleSource: varchar(16) // system | user | explore | null
styleSourceId: varchar(64) // manifest preset id / user preset uuid / null
stylePalettePolicy: varchar(16) // template | reference | null
```

新增 purpose `style-preset-anchor`，避免系统/用户预设的 deck-local 副本混入 AI 探索候选列表。

迁移策略：开发库与测试库执行 `drizzle-kit push`，随后用 `SHOW COLUMNS` 人工核对默认值；本次只新增 nullable 列和新表，不触发 nullable → NOT NULL 的已知 drizzle 缺 DEFAULT 问题。

---

## API 契约

- `GET /api/decks/:id/style-library`：返回尺寸兼容的系统预设、当前用户兼容预设、当前激活来源、AI 探索候选与 generating 状态；active 使用 `preset | generated | free | undecided` 判别联合类型。
- `POST /api/decks/:id/style-library/apply`：`{ source: 'system' | 'user' | 'explore', id }`，原子 materialize 或选定候选。
- `POST /api/decks/:id/style-library/save`：`{ assetId, name? }`，把当前 deck 的候选/锚图复制进用户风格库。
- `PATCH /api/style-presets/:id`：重命名，只允许 owner。
- `DELETE /api/style-presets/:id`：删除用户级副本；不影响已 materialize 的 deck。
- `GET /api/style-presets/:id/image`：仅 owner 可读用户预设图片。
- `GET /api/image-style-presets/:presetId/preview`：按 registry 中的 preset id 返回公开预览，不接受任意文件路径。

所有写操作使用 `logServerEvent` 记录 save/apply/rename/delete；所有 user-owned BLOB 查询把 `userId` 和资源 id 推进 SQL `WHERE`。

---

## 阶段拆分

### Task 17-A：共享契约、系统风格 registry 与预设资源

1. 新增独立风格 manifest 类型与校验测试。
2. 设计系统落 12 张 1280×624 reference、12 张 preview 与 colocated manifest。
3. registry 校验 id 唯一、路径安全、magic bytes、真实尺寸和文件存在；新增预览路由。

验证：shared 单测、image-style registry/routes 单测、人工查看 12 张参考图。

### Task 17-B：用户风格表与后端 API

1. 新表、repo、按 reference 宽高兼容的列表、配额与 SQL ownership guard。
2. 系统/用户 preset materialize 事务与 explore candidate 统一应用。
3. 保存、重命名、删除、图片读取与关键事件日志。

验证：CRUD、跨用户 IDOR、跨 deck candidate、删除源 deck 后仍可复用、删除 preset 后已应用 deck 不受影响。

### Task 17-C：三段式前端流程

1. 新 API 模块与 composable 加载库，打开时绝不自动探索。
2. 新 modal 三个 tab：系统预设 / 我的风格 / AI 探索。
3. 应用即时关闭；探索结果支持“应用”和“保存”；我的风格支持重命名、删除。
4. `decisionPending` 与 `open` 解耦，所有 apply/skip/clear 发 `style-changed` 刷新 deck。
5. modal 补齐 dialog/tab/aria-pressed/aria-live/focus-visible/reduced-motion，卡片用约 2.05:1 展示，不裁成正方形。

验证：组件与 composable 测试覆盖无自动 POST、选中态、保存/删除、探索关闭后继续、聊天阻塞语义。

### Task 17-D：归档 schema v2

1. 当前导出写 v2；解析器同时接受 v1/v2。
2. import 通过 old→new asset id map 恢复 anchor，并同步首个 version。
3. v1 默认无 anchor；损坏的 anchor 指针安全降级为 null。

验证：v2 round-trip 保留风格，v1 fixture 仍能导入，跨账号导入不携带账号级风格库。

### Task 17-E：回归与上线准备

1. dev/test `db:push` 并核对 schema。
2. 定向测试 → 全量 test/type-check/lint/build。
3. 浏览器手验两模板、首选预设、跨 deck 复用、AI 探索与 archive round-trip。

---

## 验收条件

- [x] 打开风格库 1 秒内出现系统预设，不产生任何 LLM/图片模型调用。
- [x] 至少 12 个视觉差异明显、与当前模板尺寸兼容的系统预设，点击即可应用。
- [x] AI 探索仅在用户显式点击后生成，生成期间可关闭 modal 并继续聊天/编辑；重复点击不会创建第二批并发任务。
- [x] 探索结果可保存到“我的风格”，在新 deck 中即时复用。
- [x] 删除源 deck 后用户风格仍存在；删除用户风格后已应用 deck 仍能继续生图。
- [x] 重开风格库能高亮当前系统、用户或探索风格。
- [x] 无图片模型配置时仍可浏览风格库；仅 AI 探索被禁用并给出配置提示。
- [x] `.lumideck` v2 round-trip 保留当前锚图与风格状态，v1 仍可导入。
- [x] 后端与前端新增接口/状态均有跨用户、失败与回归测试。
- [x] workspace 单测、type-check、lint、build 与 Phase 17 E2E 全绿。

---

## 跨用户/跨 deck 隔离 risk audit

1. 新增的系统 manifest cache 是只读全局数据，可跨用户共享；用户风格全部在 DB 并以 `userId` 隔离。
2. 本 Phase 不新增持久化 worker/队列；AI 探索使用单 agent 进程内后台任务，按 `deckId + userId` 隔离，部署/重启后运行态丢失但已提交候选不丢。
3. `user_style_presets` 的 list/read/update/delete 均使用 `id AND user_id`；保存源 asset 使用 `asset_id AND deck_id AND user_id`；应用目标 deck 使用 `deck_id AND user_id`。
4. 每个 endpoint 覆盖 user B 使用 user A 的 deckId、presetId 或 assetId，断言 403/404 且 A 的行和 B 的 deck 均零副作用。

---

## 不做什么

- ❌ Markdown / PPTX 外部格式导入（产品范围永久不做）。
- ❌ 用户直接上传任意参考图创建风格；本 Phase 只保存 AI 探索或当前锚图。
- ❌ 不同目标图幅间自动裁切/扩图适配；图幅兼容的模板可直接复用，不兼容时明确禁用。
- ❌ 团队共享风格库、风格市场、公开分享 preset。
- ❌ AI 探索持久化 job/SSE、逐张渐进完成、跨设备任务通知。
- ❌ 对已经生成的历史配图批量按新风格重绘；新选择只影响之后生成/重生成的图片。
- ❌ 多 anchor、章节级风格或单页独立风格。

---

## 执行期偏离

1. 原 mood-board 同步生成接口不适合“关闭弹窗仍继续”，新增 202 exploration job；生成先写 `mood-board-staging`，三张全部成功后才在 deck 行锁事务内替换旧候选。
2. 系统 preset 的 preview 与 generation reference 首批复用同一张 1280×624 PNG；manifest 仍保留两个独立字段，后续可无协议变更地换成更轻 preview 或多 reference。
3. `.lumideck` v2 导入不会迁移账号级 `user_style_presets`。包内 `styleSource=user` 的 deck-local BLOB 降级成 `explore`，当前视觉继续可用且可由新账号重新保存，避免悬空引用旧账号 preset id。
4. 删除用户 preset 后，已 materialize 的 deck BLOB 不删除；来源降级成 `explore/self`，当前 anchor 与候选仍能展示、继续生图和再次保存。
5. 前端增加 context epoch：旧 deck 的迟到 apply/save/rename/delete 响应不能关闭或覆盖新 deck 风格库；首次关闭决策前额外 GET 对齐服务端，避免覆盖另一窗口刚完成的选择。

## 踩坑与解决

1. **共享 `lumideck_test` 并发 TRUNCATE 会制造海量假 FK/401/404**：后端、creator 集成测与 archive 测试不能并行；最终统一逐文件/逐包串行复跑。
2. **旧 E2E 生图 stub 是 1×1 PNG**：Phase 17 正确记录真实尺寸后，它会被判定为与 1280×624 模板不兼容，无法覆盖跨 deck 复用。mood-board stub 改为读取 registry 已校验的系统 reference；普通生图 stub 仍保留原 1×1 fixture。
3. **删除 preset 只改 provenance 但保留 `style-preset-anchor` purpose 时，旧查询会漏掉当前图**：候选查询仅额外纳入 `source=explore` 的 `style-preset-anchor`，不会把正常 system/user materialized copy 重复显示。
4. **`modal open` 不能代表首次决策**：否则普通浏览、重开和后台探索都会误锁聊天。单独维护显式 `decisionPending`，并在服务端 active 已非 undecided 时自动收敛。

## 测试数量落地

| 验证项                 | 结果                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| agent 全量             | 101 files passed / 4 skipped；1132 tests passed / 7 skipped；稳定排序最终定向 4/4 |
| creator 全量           | 48 files / 382 tests passed；最终 composable 定向 10/10                           |
| shared                 | 2 files / 9 tests passed                                                          |
| slidev 设计系统        | 15 files / 55 tests passed                                                        |
| archive v1/v2 串行定向 | build 6/6、parse 18/18、routes 17/17                                              |
| Phase 17 Playwright    | 4/4：系统预设、自由生成、anchor 透传、跨 deck 保存复用                            |
| 静态与产物             | 全仓 type-check、lint、build、bundle budget 全绿                                  |
| coverage               | 本轮未单独执行 coverage 命令；功能与回归由上述全量/定向测试覆盖                   |
