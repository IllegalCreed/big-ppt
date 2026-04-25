# Phase 7C — 前端选择 / 切换 UI 实施文档

> **状态**：待启动（2026-04-25 设计收敛）
> **前置阶段**：Phase 7A 模板重命名 ✅ / Phase 7B jingyeda 视觉骨架 ✅（见 [plan 13](13-phase7-template-rename.md)）
> **后续阶段**：Phase 7D — 3 条 E2E spec（将另写 plan 15）
> **路线图**：[roadmap.md Phase 7](../requirements/roadmap.md)
> **执行子技能**：参考 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按 task 推进；step 用 checkbox 跟踪。

**Goal**：落地前端"新建 deck 选择模板"与"编辑页切换模板"两条完整 UI 链路。组件级目标：`TemplatePickerModal`（共用）+ `UndoToast` + `useSwitchTemplateJob` composable；基建目标：缩略图自动生成脚本 + manifest `tagline` 字段扩展。**不动后端**（Phase 6 期间已落地 `POST /api/decks` / `POST /api/decks/:id/switch-template` / 轮询 endpoint / 自动快照 / `/undo` 版本恢复）。

---

## 关键设计抉择（与 brainstorming 期间用户对齐）

1. **缩略图来源**：自动截图脚本（playwright + slidev cli），一次性跑 `pnpm gen:thumbnails` 生成 PNG 提交入库；不进 CI。
2. **picker 布局**：左列模板列表 + 右大预览（为未来多模板扩展），`switch` 模式在右侧追加内联警告条 + 危险色主按钮"切换（AI 重写）"。
3. **创建 / 切换复用同一组件** `TemplatePickerModal`：`mode='create'|'switch'` 控制文案 / 警告 / 提交 API；`view='picker'|'progress'|'success'|'error'` 控制内部视图状态流转。
4. **进度展示**：弹窗内 stage list + 进度条；progress 阶段 **禁止 Esc / overlay 点击关闭**（防误关丢任务）；后台运行按钮 **YAGNI 不做**。
5. **结果反馈**：成功 = 弹窗内成功视图 → 用户点"查看"关窗 → 编辑页底部 `UndoToast` 6s 软提醒（/undo 链接直跳 VersionTimeline 高亮快照版本）；失败 = 弹窗保留 + 错误详情折叠 + retry/关闭两按钮。
6. **轮询节奏**：前 45s @ 1.5s、之后退到 3s、总计 5min 超时；modal unmount / 失败后关闭 → `AbortController.abort()` 停本地轮询（不取消后端 job）。
7. **编辑页入口**：`DeckEditorCanvas` 顶栏在 History 与 Settings 之间插入 `Layers` 图标 + "切换模板"按钮，沿用既有 `icon-btn` 样式。
8. **E2E**：本 plan 仅追加 1 条冒烟（picker 渲染 + 新建走 jingyeda 路径）；完整 3 条切换流 spec 留给 Phase 7D / plan 15。
9. **manifest schema 扩展**：`tagline?: string`（picker 卡片副标题）；`thumbnail?: string` 字段 Phase 6 已有，只做值填充。

---

## ⚠️ Secrets 安全红线（HARD，沿用 Phase 5/6/7A）

- `.gitignore` 规则不要动
- 本 Phase **不引入新环境变量**
- 每次 `git commit` 前必须 `git status` 人工检查
- **禁用 `git add -A` / `git add .` / `git commit -a`**

---

## 文件结构变更对照表

### 新增

| 文件 | 职责 |
|---|---|
| `packages/creator/src/composables/useSwitchTemplateJob.ts` | 封装 POST + 轮询 GET 的 reactive state（stage / progressRatio / error / result）+ abort |
| `packages/creator/src/components/TemplatePickerModal.vue` | 共用主组件，含 picker / progress / success / error 四视图 + mode='create'\|'switch' |
| `packages/creator/src/components/TemplateCard.vue` | picker 左列列表项（缩略图 + 名称 + tagline） |
| `packages/creator/src/components/TemplatePreviewPane.vue` | picker 右侧大预览（大图 + description + 可选警告条 + 主按钮） |
| `packages/creator/src/components/UndoToast.vue` | 编辑页底部切换成功后的 6s toast |
| `packages/creator/test/useSwitchTemplateJob.spec.ts` | composable 单测（节奏 / 超时 / abort / retry） |
| `packages/creator/test/TemplatePickerModal.spec.ts` | 组件单测（mode × view 状态机 + 按钮 disabled 边界） |
| `packages/creator/test/UndoToast.spec.ts` | toast 单测（渲染 / 6s 自动消失 / /undo 跳转） |
| `scripts/generate-template-thumbnails.ts` | 一次性自动截图脚本（playwright + slidev cli） |
| `scripts/tsconfig.json` | scripts/ 目录最小 tsconfig（extends base + types: node + noEmit），让 IDE / tsc 认 node:* 类型 |
| `packages/slidev/templates/beitou-standard/thumbnail.png` | 脚本生成 |
| `packages/slidev/templates/jingyeda-standard/thumbnail.png` | 脚本生成 |
| `packages/e2e/tests/template-picker.spec.ts` | 冒烟 E2E：picker 渲染 + 选 jingyeda 新建 deck |

### 修改

| 文件 | 职责 |
|---|---|
| `packages/shared/src/template-manifest.ts` | 增 `tagline?: string` 字段 + validator |
| `packages/slidev/templates/beitou-standard/manifest.json` | 加 `tagline: "商务正式 · 暖色调"` + `thumbnail: "thumbnail.png"` |
| `packages/slidev/templates/jingyeda-standard/manifest.json` | 加 `tagline: "商务科技 · 深色活力"` + `thumbnail: "thumbnail.png"` |
| `packages/creator/src/pages/DeckListPage.vue` | `onCreate()` 改为打开 `TemplatePickerModal` + 接成功事件后跳转 |
| `packages/creator/src/components/DeckEditorCanvas.vue` | 顶栏新增"切换模板"按钮 + 挂 `TemplatePickerModal` + 挂 `UndoToast` + 监听切换成功 |
| `packages/creator/src/components/VersionTimeline.vue` | 支持 `?highlight=<versionId>` 参数高亮刚快照的版本（2s 环形动画） |
| `package.json`（repo 根） | 加 `gen:thumbnails` script + 显式声明 `tsx` devDep（之前靠 hoisting 间接拿，脆弱） |
| `docs/requirements/roadmap.md` | Phase 7C 完成后写"变更记录"行（最后一步） |

---

## Task 7C-0：基线确认 + 工作准备

**Files**: 无修改

- [ ] **Step 1：跑全测试确认基线**

```bash
cd /Users/zhangxu/workspace/big-ppt
pnpm test
```

Expected: agent + creator 合计 335 passing。如数字不同记录新基线。

- [ ] **Step 2：跑 E2E 确认基线**

```bash
pnpm e2e
```

Expected: 5 passing。

- [ ] **Step 3：确认 git 干净 + 分支正确**

```bash
git status && git log --oneline -3
```

Expected: working tree clean（或仅 `packages/slidev/slides.md` 非追踪）；HEAD 在 `main`（或当前 Phase 7 工作分支）。

- [ ] **Step 4：playwright 可用性确认**

```bash
pnpm -F @big-ppt/e2e exec playwright --version
```

Expected: 输出版本号（`packages/e2e` 已装 playwright，脚本复用）。

---

## Task 7C-1：manifest schema 加 `tagline` + 两套模板填值 + 单测

**Files**:
- Modify: `packages/shared/src/template-manifest.ts`
- Modify: `packages/slidev/templates/beitou-standard/manifest.json`
- Modify: `packages/slidev/templates/jingyeda-standard/manifest.json`
- Test: 如 `packages/shared/test/template-manifest.test.ts` 存在则在其内增补；不存在则创建 `packages/shared/test/template-manifest.test.ts`

- [ ] **Step 1：先写失败的 validator 测试**

在 `packages/shared/test/template-manifest.test.ts`（如无则创建）追加：

```typescript
import { describe, expect, it } from 'vitest'
import { validateManifest } from '../src/template-manifest'

const BASE = {
  id: 'demo-standard',
  name: '示例模板',
  description: 'desc',
  promptPersona: 'persona',
  starterSlidesPath: 'starter.md',
  logos: { primary: 'logo.png' },
  layouts: [
    {
      name: 'cover',
      description: 'cover layout',
      frontmatterSchema: { type: 'object', properties: {} },
    },
  ],
} as const

describe('tagline 字段', () => {
  it('tagline 可省略', () => {
    const res = validateManifest({ ...BASE })
    expect(res.ok).toBe(true)
  })

  it('tagline 若存在必须为字符串', () => {
    const res = validateManifest({ ...BASE, tagline: 123 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.some((e) => e.includes('tagline'))).toBe(true)
  })

  it('tagline 为字符串时通过校验并透传', () => {
    const res = validateManifest({ ...BASE, tagline: '商务正式' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.tagline).toBe('商务正式')
  })
})
```

- [ ] **Step 2：运行测试确认失败**

```bash
pnpm -F @big-ppt/shared test -- template-manifest
```

Expected: "tagline" 相关断言 FAIL（字段未定义）。

- [ ] **Step 3：在 `TemplateManifest` 接口与 validator 中加 `tagline`**

在 `packages/shared/src/template-manifest.ts` 接口 `TemplateManifest`（第 34 行附近）`thumbnail?: string` 下面加：

```typescript
  /** picker 卡片副标题（<= 12 字），如"商务正式 · 暖色调"；可选，缺省时 picker 不显示副标题 */
  tagline?: string
```

在 `validateManifest`（第 140 行附近）`thumbnail` 校验下方加：

```typescript
  if (raw.tagline !== undefined && typeof raw.tagline !== 'string') {
    errors.push('tagline 若存在必须是字符串')
  }
```

- [ ] **Step 4：测试转绿**

```bash
pnpm -F @big-ppt/shared test -- template-manifest
```

Expected: 新增 3 条全过。

- [ ] **Step 5：两套模板 manifest 加 `tagline`**

在 `packages/slidev/templates/beitou-standard/manifest.json` 对象顶层 `description` 下方加：

```json
  "tagline": "商务正式 · 暖色调",
```

在 `packages/slidev/templates/jingyeda-standard/manifest.json` 对应位置加：

```json
  "tagline": "商务科技 · 深色活力",
```

- [ ] **Step 6：跑全测试确认无回归**

```bash
pnpm test
```

Expected: 335 + 3 = 338 passing。

- [ ] **Step 7：commit**

```bash
git add packages/shared/src/template-manifest.ts \
        packages/shared/test/template-manifest.test.ts \
        packages/slidev/templates/beitou-standard/manifest.json \
        packages/slidev/templates/jingyeda-standard/manifest.json && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): manifest schema 增加 tagline 字段 + 两套模板填值

- template-manifest.ts: 接口 + validator 支持可选 tagline:string
- beitou-standard: tagline = "商务正式 · 暖色调"
- jingyeda-standard: tagline = "商务科技 · 深色活力"
- 单测覆盖：省略 / 非字符串报错 / 有值透传
EOF
)"
```

---

## Task 7C-2：缩略图自动生成脚本 + 跑一次提交 PNG

**Files**:
- Create: `scripts/generate-template-thumbnails.ts`
- Modify: `package.json`（根 + `packages/slidev/`）
- Modify: `packages/slidev/templates/beitou-standard/manifest.json`（加 `thumbnail` 字段）
- Modify: `packages/slidev/templates/jingyeda-standard/manifest.json`（加 `thumbnail` 字段）
- Create: `packages/slidev/templates/beitou-standard/thumbnail.png`（脚本产出）
- Create: `packages/slidev/templates/jingyeda-standard/thumbnail.png`（脚本产出）

- [ ] **Step 1：安装 playwright 到 repo 根（复用现有 binary）**

```bash
pnpm -F @big-ppt/e2e exec playwright install chromium
```

Expected: 成功或"already installed"。

- [ ] **Step 2：新建 `scripts/generate-template-thumbnails.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Phase 7C 一次性（及新增模板时手跑）缩略图生成脚本。
 *
 * 流程：
 *   1. 扫 packages/slidev/templates 下每个子目录里的 manifest.json
 *   2. 每套模板串行：写临时 slides.md（starter 内容）→ 起 slidev cli dev → playwright 打开 /1 截图 → 杀进程
 *   3. 写 thumbnail.png 到模板目录 + manifest.thumbnail = "thumbnail.png"
 *   4. 幂等：manifest 字段如已存在且值相同不改动（让 git diff 只反映图片变化）
 *
 * 注意：JSDoc 块里禁止写 templates/<glob>/manifest.json 这种含 */ 字面的 path——
 * esbuild 会把 */ 当作块注释结束符提前关闭注释。如需写 glob 改用自然语言描述。
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join(REPO_ROOT, 'packages/slidev/templates')
const SLIDEV_DIR = path.join(REPO_ROOT, 'packages/slidev')
const PORT = 3033 // 避开 dev 默认 3030/3031

async function waitForServer(url: string, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // 继续轮询
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`slidev server never became ready at ${url}`)
}

async function captureTemplate(templateId: string) {
  console.log(`[${templateId}] 准备截图…`)
  const templateDir = path.join(TEMPLATES_DIR, templateId)
  const manifestPath = path.join(templateDir, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const starterAbs = path.join(templateDir, manifest.starterSlidesPath)
  const starterContent = fs.readFileSync(starterAbs, 'utf-8')

  const tmpSlides = path.join(SLIDEV_DIR, 'slides.md')
  const original = fs.existsSync(tmpSlides) ? fs.readFileSync(tmpSlides, 'utf-8') : null
  fs.writeFileSync(tmpSlides, starterContent)

  const proc = spawn(
    'pnpm',
    ['-F', '@big-ppt/slidev', 'exec', 'slidev', '--port', String(PORT), '--open', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  )
  proc.stdout.on('data', (d) => process.stdout.write(`[slidev] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[slidev] ${d}`))

  try {
    await waitForServer(`http://localhost:${PORT}`)
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(`http://localhost:${PORT}/1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200) // 字体 + logo 加载
    const outPath = path.join(templateDir, 'thumbnail.png')
    await page.screenshot({ path: outPath, type: 'png' })
    await browser.close()

    if (manifest.thumbnail !== 'thumbnail.png') {
      manifest.thumbnail = 'thumbnail.png'
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      console.log(`[${templateId}] manifest.thumbnail 字段已写入`)
    }
    console.log(`[${templateId}] OK → ${outPath}`)
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (original !== null) fs.writeFileSync(tmpSlides, original)
    else fs.unlinkSync(tmpSlides)
  }
}

async function main() {
  const ids = fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(TEMPLATES_DIR, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()

  console.log(`待处理模板：${ids.join(', ')}`)
  for (const id of ids) {
    await captureTemplate(id)
  }
  console.log('完成。提交 thumbnail.png + manifest.json 改动。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3：root `package.json` `scripts` 加命令**

```json
  "gen:thumbnails": "tsx scripts/generate-template-thumbnails.ts",
```

（加在已有 script 列表中；如与既有 key 冲突则报出与用户确认。）

- [ ] **Step 4：跑脚本生成 PNG**

```bash
pnpm gen:thumbnails
```

Expected: 看到 `[beitou-standard] OK` 和 `[jingyeda-standard] OK`；两个 PNG 约 80–200 KB。

- [ ] **Step 5：视觉 spot-check**

```bash
open packages/slidev/templates/beitou-standard/thumbnail.png
open packages/slidev/templates/jingyeda-standard/thumbnail.png
```

Expected: 分别看到两套模板封面 slide 的完整首页（logo + 标题 + 底部信息栏）。如有字体 fallback / logo 未染色等视觉问题，调 `page.waitForTimeout` 或 `waitUntil` 再跑；不要手 P 图。

- [ ] **Step 6：确认幂等性**

```bash
pnpm gen:thumbnails
git status
```

Expected: 第二次跑后 PNG 二进制可能有 1–2 byte 不同（PNG 有时间戳），manifest 文件不变动。如果 PNG 差异巨大说明视觉不稳定（字体 / 异步资源），调 `waitForTimeout`。

- [ ] **Step 7：跑全测试 + 列模板响应确认**

```bash
pnpm test && \
pnpm -F @big-ppt/agent dev &
sleep 3 && \
curl -s http://localhost:3030/list-templates | jq '.manifests[] | {id, thumbnail, tagline}' && \
kill %1 2>/dev/null
```

Expected: 测试 338 绿；`/list-templates` 两条 manifests 都有 `thumbnail: "thumbnail.png"` + `tagline` 字段。

- [ ] **Step 8：commit**

```bash
git add scripts/generate-template-thumbnails.ts \
        package.json \
        packages/slidev/templates/beitou-standard/manifest.json \
        packages/slidev/templates/beitou-standard/thumbnail.png \
        packages/slidev/templates/jingyeda-standard/manifest.json \
        packages/slidev/templates/jingyeda-standard/thumbnail.png && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): 模板缩略图自动生成脚本 + 两套模板首次截图

- scripts/generate-template-thumbnails.ts: playwright + slidev cli 逐模板截首页 1280×720 PNG
- pnpm gen:thumbnails 命令入口
- manifest.thumbnail 字段落位 "thumbnail.png"
- beitou-standard / jingyeda-standard 首次 PNG 入库（新增模板时复跑此脚本）
EOF
)"
```

---

## Task 7C-3：`useSwitchTemplateJob` composable + 单测

**Files**:
- Create: `packages/creator/src/composables/useSwitchTemplateJob.ts`
- Create: `packages/creator/test/useSwitchTemplateJob.spec.ts`

- [ ] **Step 1：写单测（polling 节奏 / 超时 / abort / retry）**

新建 `packages/creator/test/useSwitchTemplateJob.spec.ts`：

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import { useSwitchTemplateJob } from '../src/composables/useSwitchTemplateJob'

useMsw()

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSwitchTemplateJob', () => {
  it('成功路径：POST → polling → stage 变化 → success', async () => {
    let pollCount = 0
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-1', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-1', () => {
        pollCount++
        if (pollCount === 1)
          return HttpResponse.json({ job: { id: 'job-1', state: 'snapshotting' } })
        if (pollCount === 2)
          return HttpResponse.json({ job: { id: 'job-1', state: 'migrating' } })
        return HttpResponse.json({
          job: {
            id: 'job-1',
            state: 'success',
            snapshotVersionId: 10,
            newVersionId: 11,
          },
        })
      }),
    )
    const job = useSwitchTemplateJob()
    const done = job.start({ deckId: 1, targetTemplateId: 'jingyeda-standard' })

    await vi.advanceTimersByTimeAsync(0)
    expect(job.stage.value).toBe('pending')
    await vi.advanceTimersByTimeAsync(1500)
    expect(job.stage.value).toBe('snapshotting')
    await vi.advanceTimersByTimeAsync(1500)
    expect(job.stage.value).toBe('migrating')
    await vi.advanceTimersByTimeAsync(1500)
    expect(job.stage.value).toBe('success')
    const result = await done
    expect(result.newVersionId).toBe(11)
  })

  it('节奏：前 45s @ 1.5s，之后 @ 3s', async () => {
    let pollTimes: number[] = []
    const startNow = Date.now()
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-2', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-2', () => {
        pollTimes.push(Date.now() - startNow)
        return HttpResponse.json({ job: { id: 'job-2', state: 'migrating' } })
      }),
    )
    const job = useSwitchTemplateJob()
    void job.start({ deckId: 1, targetTemplateId: 'x' })

    // 前 45s 应该有 ~30 次（45s / 1.5s）
    await vi.advanceTimersByTimeAsync(45_000)
    const firstPhaseCount = pollTimes.length
    expect(firstPhaseCount).toBeGreaterThanOrEqual(28) // 容忍边界
    expect(firstPhaseCount).toBeLessThanOrEqual(32)

    // 之后 30s 应该只有 ~10 次（3s 节奏）
    const beforeSlow = pollTimes.length
    await vi.advanceTimersByTimeAsync(30_000)
    const slowPhaseDelta = pollTimes.length - beforeSlow
    expect(slowPhaseDelta).toBeGreaterThanOrEqual(8)
    expect(slowPhaseDelta).toBeLessThanOrEqual(12)

    job.abort()
  })

  it('超时：5 分钟无终态 → timeout error', async () => {
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-3', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-3', () =>
        HttpResponse.json({ job: { id: 'job-3', state: 'migrating' } }),
      ),
    )
    const job = useSwitchTemplateJob()
    const done = job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
    await expect(done).rejects.toThrow(/timeout/i)
  })

  it('abort：调用后 fetch 不再触发', async () => {
    let calls = 0
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-4', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-4', () => {
        calls++
        return HttpResponse.json({ job: { id: 'job-4', state: 'migrating' } })
      }),
    )
    const job = useSwitchTemplateJob()
    void job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(5_000)
    const before = calls
    job.abort()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(before)
  })

  it('retry：失败后 start 再触发，jobId 替换', async () => {
    let started = 0
    server.use(
      http.post('/api/decks/1/switch-template', () => {
        started++
        return HttpResponse.json({ jobId: `job-r${started}`, state: 'pending' })
      }),
      http.get(/switch-template-jobs\/job-r1/, () =>
        HttpResponse.json({ job: { id: 'job-r1', state: 'failed', error: 'boom' } }),
      ),
      http.get(/switch-template-jobs\/job-r2/, () =>
        HttpResponse.json({
          job: {
            id: 'job-r2',
            state: 'success',
            snapshotVersionId: 1,
            newVersionId: 2,
          },
        }),
      ),
    )
    const job = useSwitchTemplateJob()
    const firstDone = job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(1500)
    await expect(firstDone).rejects.toThrow(/boom/)

    const secondDone = job.start({ deckId: 1, targetTemplateId: 'x' })
    await vi.advanceTimersByTimeAsync(1500)
    const ok = await secondDone
    expect(ok.newVersionId).toBe(2)
    expect(started).toBe(2)
  })

  it('migrating 阶段进度条每次 poll 递增（从 0.5 起步，封顶 0.9）', async () => {
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-mig', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-mig', () =>
        HttpResponse.json({ job: { id: 'job-mig', state: 'migrating' } }),
      ),
    )
    const job = useSwitchTemplateJob()
    void job.start({ deckId: 1, targetTemplateId: 'x' })

    // 第一次 poll：0.5 → 0.52
    await vi.advanceTimersByTimeAsync(1500)
    const p1 = job.progressRatio.value
    expect(p1).toBeGreaterThanOrEqual(0.5)
    expect(p1).toBeLessThanOrEqual(0.55)

    // 第二次 poll：必须严格递增
    await vi.advanceTimersByTimeAsync(1500)
    const p2 = job.progressRatio.value
    expect(p2).toBeGreaterThan(p1)

    // 多次 poll 后仍封顶 0.9
    await vi.advanceTimersByTimeAsync(1500 * 10)
    const p3 = job.progressRatio.value
    expect(p3).toBeGreaterThan(p2)
    expect(p3).toBeLessThanOrEqual(0.9)

    job.abort()
  })
})
```

- [ ] **Step 2：跑测试确认失败**

```bash
pnpm -F @big-ppt/creator test -- useSwitchTemplateJob
```

Expected: FAIL "Cannot find module '../src/composables/useSwitchTemplateJob'"。

- [ ] **Step 3：实现 composable**

新建 `packages/creator/src/composables/useSwitchTemplateJob.ts`：

```typescript
import { ref, shallowRef } from 'vue'
import { useDecks, type SwitchJobInfo, type SwitchJobState } from './useDecks'

const FAST_INTERVAL_MS = 1_500
const SLOW_INTERVAL_MS = 3_000
const FAST_PHASE_MS = 45_000
const TOTAL_TIMEOUT_MS = 5 * 60_000

/** stage → progress 比例估算（视觉用，非真实进度） */
const STAGE_RATIO: Record<SwitchJobState, number> = {
  pending: 0.05,
  snapshotting: 0.2,
  migrating: 0.5,
  success: 1,
  failed: 0,
}

export type StartParams = { deckId: number; targetTemplateId: string }

export function useSwitchTemplateJob() {
  const { switchTemplate, getSwitchTemplateJob } = useDecks()

  const stage = ref<SwitchJobState>('pending')
  const progressRatio = ref(0)
  const error = ref<string | null>(null)
  const result = shallowRef<SwitchJobInfo | null>(null)
  const running = ref(false)

  let controller: AbortController | null = null
  let currentJobId: string | null = null

  function reset() {
    stage.value = 'pending'
    progressRatio.value = 0
    error.value = null
    result.value = null
  }

  function abort() {
    controller?.abort()
    controller = null
    running.value = false
  }

  async function start(params: StartParams): Promise<SwitchJobInfo> {
    abort()
    reset()
    running.value = true
    const ctrl = new AbortController()
    controller = ctrl

    try {
      const { jobId, state } = await switchTemplate(params.deckId, params.targetTemplateId)
      if (ctrl.signal.aborted) throw new Error('aborted')
      currentJobId = jobId
      stage.value = state
      progressRatio.value = STAGE_RATIO[state]

      const deadline = Date.now() + TOTAL_TIMEOUT_MS
      const startTs = Date.now()

      while (!ctrl.signal.aborted) {
        if (Date.now() >= deadline) {
          throw new Error('switch job timeout (5min)')
        }
        const interval =
          Date.now() - startTs < FAST_PHASE_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
        await sleep(interval, ctrl.signal)
        if (ctrl.signal.aborted) throw new Error('aborted')

        const { job } = await getSwitchTemplateJob(jobId)
        if (job.id !== currentJobId) continue
        stage.value = job.state
        // migrating 阶段每次 poll 进度递增 +0.02（从 0.5 起步累加，封顶 0.9）；其他 stage 直接读 STAGE_RATIO
        if (job.state === 'migrating') {
          const base = Math.max(progressRatio.value, STAGE_RATIO.migrating)
          progressRatio.value = Math.min(0.9, base + 0.02)
        } else {
          progressRatio.value = STAGE_RATIO[job.state]
        }
        if (job.state === 'success') {
          result.value = job
          running.value = false
          controller = null
          return job
        }
        if (job.state === 'failed') {
          throw new Error(job.error ?? 'switch job failed')
        }
      }
      throw new Error('aborted')
    } catch (err) {
      running.value = false
      controller = null
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      throw err
    }
  }

  return { stage, progressRatio, error, result, running, start, abort }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}
```

- [ ] **Step 4：跑测试转绿**

```bash
pnpm -F @big-ppt/creator test -- useSwitchTemplateJob
```

Expected: 5 条全过。若 "节奏" 用例边界敏感可以把容忍窗口微调（±2 次）。

- [ ] **Step 5：跑全量创作者端测试**

```bash
pnpm -F @big-ppt/creator test
```

Expected: 无回归。

- [ ] **Step 6：commit**

```bash
git add packages/creator/src/composables/useSwitchTemplateJob.ts \
        packages/creator/test/useSwitchTemplateJob.spec.ts && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): useSwitchTemplateJob composable + 单测

封装 POST + 轮询 GET 的 reactive state 机（stage / progressRatio / error / result / running）。

- 节奏：前 45s @ 1.5s → 之后 @ 3s；总 5min 超时
- stage → progressRatio：pending 5% / snapshotting 20% / migrating 50%→90% 插值 / success 100%
- abort：AbortController 停本地轮询（后端 job 仍在内存继续）
- retry：start() 再调用替换 jobId，旧 jobId 响应忽略
- 单测覆盖：成功路径 / 节奏 / 超时 / abort / retry 五条
EOF
)"
```

---

## Task 7C-4：`TemplatePickerModal` picker 视图 + create 模式 + 接 DeckListPage

**Files**:
- Create: `packages/creator/src/components/TemplateCard.vue`
- Create: `packages/creator/src/components/TemplatePreviewPane.vue`
- Create: `packages/creator/src/components/TemplatePickerModal.vue`
- Create: `packages/creator/test/TemplatePickerModal.spec.ts`
- Modify: `packages/creator/src/pages/DeckListPage.vue`

### 策略

先做 picker 视图（左列表 + 右预览 + 底部 footer 带"创建"按钮），仅 `mode='create'` 路径打通到 API；switch 模式和其他 view 状态留给后续 task。

- [ ] **Step 1：写 picker 视图单测（只覆盖 create mode + picker view）**

新建 `packages/creator/test/TemplatePickerModal.spec.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import TemplatePickerModal from '../src/components/TemplatePickerModal.vue'

useMsw()

const MANIFESTS = [
  {
    id: 'beitou-standard',
    name: '北投集团汇报模板',
    description: '商务正式风格 · 暖色调配色',
    tagline: '商务正式 · 暖色调',
    thumbnail: 'thumbnail.png',
    promptPersona: '',
    starterSlidesPath: 'starter.md',
    logos: { primary: 'logo.png' },
    layouts: [{ name: 'cover', description: 'x', frontmatterSchema: { type: 'object', properties: {} } }],
  },
  {
    id: 'jingyeda-standard',
    name: '竞业达汇报模板',
    description: '商务科技风格 · 深色活力',
    tagline: '商务科技 · 深色活力',
    thumbnail: 'thumbnail.png',
    promptPersona: '',
    starterSlidesPath: 'starter.md',
    logos: { primary: 'logo.png' },
    layouts: [{ name: 'cover', description: 'x', frontmatterSchema: { type: 'object', properties: {} } }],
  },
]

function mockListTemplates() {
  server.use(
    http.get('/list-templates', () =>
      HttpResponse.json({ success: true, manifests: MANIFESTS, templates: [], usage_guide: '', design_spec: '', available_images: [] }),
    ),
  )
}

describe('TemplatePickerModal · create mode · picker view', () => {
  it('open=true 时拉模板清单并渲染左列表 + 右预览', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('北投集团汇报模板')
    expect(wrapper.text()).toContain('竞业达汇报模板')
    // 默认选中第一项 → 右侧预览渲染 description
    expect(wrapper.text()).toContain('商务正式风格')
  })

  it('点左列切换选中 → 右预览更新', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create' },
    })
    await flushPromises()
    const cards = wrapper.findAll('[data-template-card]')
    expect(cards.length).toBe(2)
    await cards[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('商务科技风格')
  })

  it('标题 input 空时创建按钮 disabled，有值时可点', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create' },
    })
    await flushPromises()
    const input = wrapper.find<HTMLInputElement>('input[data-title-input]')
    await input.setValue('')
    const btn = wrapper.find<HTMLButtonElement>('button[data-primary-action]')
    expect(btn.attributes('disabled')).toBeDefined()
    await input.setValue('My Deck')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('点"创建"调 POST /api/decks 并 emit created 事件带新 deck', async () => {
    mockListTemplates()
    server.use(
      http.post('/api/decks', async ({ request }) => {
        const body = (await request.json()) as { title: string; templateId: string }
        expect(body.templateId).toBe('beitou-standard')
        expect(body.title).toBe('My Deck')
        return HttpResponse.json({
          deck: {
            id: 42,
            userId: 1,
            title: 'My Deck',
            themeId: 'default',
            templateId: 'beitou-standard',
            currentVersionId: 1,
            status: 'active',
            createdAt: 'x',
            updatedAt: 'x',
          },
        })
      }),
    )
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create' },
    })
    await flushPromises()
    await wrapper.find<HTMLInputElement>('input[data-title-input]').setValue('My Deck')
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    const events = wrapper.emitted('created')
    expect(events).toBeDefined()
    expect(events![0][0]).toMatchObject({ id: 42, templateId: 'beitou-standard' })
  })
})
```

- [ ] **Step 2：跑测试确认失败**

```bash
pnpm -F @big-ppt/creator test -- TemplatePickerModal
```

Expected: FAIL（组件不存在）。

- [ ] **Step 3：实现 `TemplateCard.vue`**

新建 `packages/creator/src/components/TemplateCard.vue`：

```vue
<script setup lang="ts">
import type { TemplateManifest } from '@big-ppt/shared'

defineProps<{ manifest: TemplateManifest; active: boolean }>()
defineEmits<{ select: [] }>()

function thumbnailUrl(m: TemplateManifest): string {
  if (!m.thumbnail) return ''
  return `/templates/${m.id}/${m.thumbnail}`
}
</script>

<template>
  <button
    type="button"
    class="tpl-card"
    :class="{ active }"
    data-template-card
    @click="$emit('select')"
  >
    <div class="tpl-card__thumb">
      <img v-if="manifest.thumbnail" :src="thumbnailUrl(manifest)" :alt="manifest.name" />
      <div v-else class="tpl-card__thumb-fallback" />
    </div>
    <div class="tpl-card__meta">
      <div class="tpl-card__name">{{ manifest.name }}</div>
      <div v-if="manifest.tagline" class="tpl-card__tagline">{{ manifest.tagline }}</div>
    </div>
  </button>
</template>

<style scoped>
.tpl-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}
.tpl-card:hover {
  border-color: var(--color-border-strong);
  background: var(--color-bg-subtle);
}
.tpl-card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
  box-shadow: 0 0 0 3px rgba(193, 95, 60, 0.08);
}
.tpl-card__thumb {
  width: 64px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--color-bg-subtle);
}
.tpl-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tpl-card__thumb-fallback {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--color-accent-soft), var(--color-bg-subtle));
}
.tpl-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tpl-card__name {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--color-fg-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-card__tagline {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
}
</style>
```

- [ ] **Step 4：实现 `TemplatePreviewPane.vue`**

新建 `packages/creator/src/components/TemplatePreviewPane.vue`：

```vue
<script setup lang="ts">
import type { TemplateManifest } from '@big-ppt/shared'

defineProps<{
  manifest: TemplateManifest
  showSwitchWarning: boolean
}>()

function thumbnailUrl(m: TemplateManifest): string {
  return m.thumbnail ? `/templates/${m.id}/${m.thumbnail}` : ''
}
</script>

<template>
  <div class="tpl-preview">
    <div class="tpl-preview__thumb">
      <img v-if="manifest.thumbnail" :src="thumbnailUrl(manifest)" :alt="manifest.name" />
      <div v-else class="tpl-preview__thumb-fallback">
        <span>{{ manifest.name }}</span>
      </div>
    </div>
    <div class="tpl-preview__body">
      <h4 class="tpl-preview__name">{{ manifest.name }}</h4>
      <p v-if="manifest.description" class="tpl-preview__desc">{{ manifest.description }}</p>
      <div v-if="showSwitchWarning" class="tpl-preview__warning" role="alert">
        <strong>切换会触发：</strong>
        <ul>
          <li>AI 用新模板风格重写全部内容</li>
          <li>当前版本自动保存快照</li>
          <li>失败或不满意可用 <code>/undo</code> 回退</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tpl-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  min-height: 320px;
}
.tpl-preview__thumb {
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-bg-subtle);
}
.tpl-preview__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tpl-preview__thumb-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-fg-muted);
  background: linear-gradient(135deg, var(--color-accent-soft), var(--color-bg-subtle));
}
.tpl-preview__body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tpl-preview__name {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}
.tpl-preview__desc {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  line-height: 1.6;
}
.tpl-preview__warning {
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid rgba(180, 71, 44, 0.3);
  border-radius: var(--radius-md);
  background: rgba(180, 71, 44, 0.06);
  color: var(--color-fg-primary);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.tpl-preview__warning ul {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-5);
}
.tpl-preview__warning code {
  background: rgba(180, 71, 44, 0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.85em;
}
</style>
```

- [ ] **Step 5：实现 `TemplatePickerModal.vue`（仅 picker view + create mode 路径，其余 view 下个 task 补）**

新建 `packages/creator/src/components/TemplatePickerModal.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import type { TemplateManifest } from '@big-ppt/shared'
import { api, ApiError } from '../api/client'
import { useDecks, type Deck } from '../composables/useDecks'
import TemplateCard from './TemplateCard.vue'
import TemplatePreviewPane from './TemplatePreviewPane.vue'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'switch'
  /** switch 模式下当前 deck 的 templateId，用于默认选中 + 禁选同一个 */
  currentTemplateId?: string
  /** switch 模式下的 deckId */
  deckId?: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [deck: Deck]
}>()

const { createDeck } = useDecks()

const manifests = ref<TemplateManifest[]>([])
const loading = ref(false)
const selectedId = ref<string | null>(null)
const title = ref('未命名幻灯片')
const submitting = ref(false)
const submitError = ref<string | null>(null)

const selected = computed(() =>
  manifests.value.find((m) => m.id === selectedId.value) ?? null,
)

const canSubmit = computed(() => {
  if (!selected.value) return false
  if (submitting.value) return false
  if (props.mode === 'create') return title.value.trim().length > 0
  return selected.value.id !== props.currentTemplateId
})

const primaryLabel = computed(() => {
  if (submitting.value) return props.mode === 'create' ? '创建中…' : '切换中…'
  return props.mode === 'create' ? '创建' : '切换（AI 重写）'
})

async function loadManifests() {
  loading.value = true
  try {
    const res = await api.get<{ manifests: TemplateManifest[] }>('/list-templates')
    manifests.value = res.manifests
    const defaultId =
      props.mode === 'switch' && props.currentTemplateId
        ? manifests.value.find((m) => m.id !== props.currentTemplateId)?.id ?? null
        : manifests.value[0]?.id ?? null
    selectedId.value = defaultId
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      title.value = '未命名幻灯片'
      submitError.value = null
      submitting.value = false
      void loadManifests()
    }
  },
  { immediate: true },
)

async function onPrimary() {
  if (!canSubmit.value || !selected.value) return
  submitError.value = null
  submitting.value = true
  try {
    if (props.mode === 'create') {
      const deck = await createDeck({
        title: title.value.trim(),
        templateId: selected.value.id,
      })
      emit('created', deck)
      close()
    } else {
      // switch mode 在 Task 7C-5/6 内实现
      throw new Error('switch mode not wired yet')
    }
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : String((err as Error).message || err)
  } finally {
    submitting.value = false
  }
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ mode === 'create' ? '新建 Deck' : '切换模板' }}</h3>
          <button type="button" class="close-btn" aria-label="关闭" @click="close">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>

        <div class="modal-body">
          <div v-if="mode === 'create'" class="field">
            <label for="tpl-modal-title">标题</label>
            <input
              id="tpl-modal-title"
              v-model="title"
              type="text"
              data-title-input
              class="input-bare"
              placeholder="未命名幻灯片"
            />
          </div>

          <div class="picker">
            <div v-if="loading" class="picker__loading">加载模板清单…</div>
            <template v-else>
              <div class="picker__list">
                <TemplateCard
                  v-for="m in manifests"
                  :key="m.id"
                  :manifest="m"
                  :active="selectedId === m.id"
                  @select="selectedId = m.id"
                />
              </div>
              <div class="picker__preview">
                <TemplatePreviewPane
                  v-if="selected"
                  :manifest="selected"
                  :show-switch-warning="mode === 'switch'"
                />
              </div>
            </template>
          </div>

          <p v-if="submitError" class="form-error">{{ submitError }}</p>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-secondary" :disabled="submitting" @click="close">
            取消
          </button>
          <button
            type="button"
            :class="mode === 'switch' ? 'btn-danger' : 'btn-primary'"
            :disabled="!canSubmit"
            data-primary-action
            @click="onPrimary"
          >
            {{ primaryLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(70, 54, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--space-6);
}
.modal-content {
  background: var(--color-bg-elevated);
  border-radius: var(--radius-lg);
  width: 800px;
  max-width: 100%;
  max-height: 92vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md);
  font-family: var(--font-sans);
  color: var(--color-fg-secondary);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
}
.modal-header h3 {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
  font-family: var(--font-serif);
}
.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-fg-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.close-btn:hover {
  background: var(--color-bg-subtle);
  color: var(--color-fg-primary);
}
.modal-body {
  padding: 0 var(--space-6) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow-y: auto;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.field label {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
}
.input-bare {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-fg-primary);
  font-size: var(--fs-md);
  font-family: inherit;
  outline: none;
}
.input-bare:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
.picker {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--space-4);
  min-height: 320px;
}
.picker__loading {
  grid-column: 1 / -1;
  padding: var(--space-8);
  text-align: center;
  color: var(--color-fg-muted);
}
.picker__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  padding-right: var(--space-1);
}
.picker__preview {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  overflow: hidden;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--color-border-subtle);
}
.btn-secondary {
  padding: var(--space-2) var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
  color: var(--color-fg-secondary);
  cursor: pointer;
  font-size: var(--fs-md);
  font-family: inherit;
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.btn-primary,
.btn-danger {
  padding: var(--space-2) var(--space-5);
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-accent-fg);
  cursor: pointer;
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  font-family: inherit;
}
.btn-primary {
  background: var(--color-accent);
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}
.btn-danger {
  background: #b4472c;
}
.btn-danger:hover:not(:disabled) {
  background: #9e3d26;
}
.btn-primary:disabled,
.btn-danger:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.form-error {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  background: rgba(180, 71, 44, 0.08);
  border: 1px solid rgba(180, 71, 44, 0.25);
  border-radius: var(--radius-md);
  color: #b4472c;
  font-size: var(--fs-sm);
}
</style>
```

- [ ] **Step 6：跑测试转绿**

```bash
pnpm -F @big-ppt/creator test -- TemplatePickerModal
```

Expected: 4 条全过。

- [ ] **Step 7：接 `DeckListPage.vue`**

修改 `packages/creator/src/pages/DeckListPage.vue`：

在 `<script setup>` 里把 `onCreate` 改掉：

```typescript
import TemplatePickerModal from '../components/TemplatePickerModal.vue'

// 旧 onCreate 删掉
const showPicker = ref(false)

function onCreate() {
  showPicker.value = true
}

async function onPickerCreated(deck: Deck) {
  await router.push(`/decks/${deck.id}`)
}
```

在 `<template>` 最后（`</main>` 后）加：

```vue
<TemplatePickerModal
  v-model:open="showPicker"
  mode="create"
  @created="onPickerCreated"
/>
```

同时把顶部 `import { useDecks, type Deck } from ...` 里 `createDeck` 从解构中删掉（不再直接用）。

- [ ] **Step 8：手 dev 验证**

```bash
pnpm dev
# 浏览器打开 creator，登录后在 list 页点"新建 Deck"
# 应弹出 picker：左列 2 套模板、缩略图可见、右侧预览 description；改标题 → 点创建 → 跳到新 deck 编辑页
```

- [ ] **Step 9：跑全量测试**

```bash
pnpm test
```

Expected: 338 + 4 = 342 passing。

- [ ] **Step 10：commit**

```bash
git add packages/creator/src/components/TemplateCard.vue \
        packages/creator/src/components/TemplatePreviewPane.vue \
        packages/creator/src/components/TemplatePickerModal.vue \
        packages/creator/test/TemplatePickerModal.spec.ts \
        packages/creator/src/pages/DeckListPage.vue && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): TemplatePickerModal 共用组件 · create 模式打通

- TemplateCard / TemplatePreviewPane 两个独立子组件
- TemplatePickerModal: 左列表 + 右预览 + 底部 footer；mode='create'|'switch' 切文案 / 样式 / 提交路径
- 本 commit 只打通 create 路径（switch 路径留给后续 task）
- DeckListPage onCreate 改为打开 modal + 监听 created 事件跳转
- 单测 4 条：渲染 / 切选中 / 标题空 disable / 创建 emit deck
EOF
)"
```

---

## Task 7C-5：switch 模式链路打通 + `DeckEditorCanvas` 顶栏入口

**Files**:
- Modify: `packages/creator/src/components/TemplatePickerModal.vue`
- Modify: `packages/creator/src/components/DeckEditorCanvas.vue`
- Modify: `packages/creator/test/TemplatePickerModal.spec.ts`（新增 switch 模式单测）

### 策略

本 task 只打通"picker view 点切换 → POST switch-template → 组件立刻进入 progress view（空壳）"。progress / success / error 三个 view 的完整实现拉到 Task 7C-6（状态机联调）。

- [ ] **Step 1：`TemplatePickerModal.spec.ts` 加 switch mode 测试**

在文件底部追加：

```typescript
describe('TemplatePickerModal · switch mode', () => {
  it('默认选中 current 之外的模板', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    // 选中应为 jingyeda
    expect(wrapper.text()).toContain('商务科技风格')
  })

  it('switch 模式下选中 current 时主按钮 disabled', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    // 点回 beitou 卡片
    const cards = wrapper.findAll('[data-template-card]')
    await cards[0].trigger('click')
    const btn = wrapper.find<HTMLButtonElement>('button[data-primary-action]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('右预览 switch 模式渲染警告条', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('AI 用新模板风格重写')
  })

  it('点"切换"调 switchTemplate API 并进入 progress 视图', async () => {
    mockListTemplates()
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'job-x', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/job-x', () =>
        HttpResponse.json({ job: { id: 'job-x', state: 'migrating' } }),
      ),
    )
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    // 视图切到 progress：picker 列表不再显示
    expect(wrapper.find('[data-template-card]').exists()).toBe(false)
    expect(wrapper.text()).toContain('正在切换')
  })
})
```

- [ ] **Step 2：跑测试确认失败**

```bash
pnpm -F @big-ppt/creator test -- TemplatePickerModal
```

Expected: 新增 4 条 FAIL（view 状态机未实现 / 警告条渲染时机未对齐 / 等等）。

- [ ] **Step 3：在 `TemplatePickerModal.vue` 引入 view 状态 + switch 路径**

在 `<script setup>` 顶部引入：

```typescript
import { useSwitchTemplateJob } from '../composables/useSwitchTemplateJob'
```

在现有 state 下方加（destructure ref 让模板可直接用 top-level 名称自动解包）：

```typescript
type View = 'picker' | 'progress' | 'success' | 'error'
const view = ref<View>('picker')
const switchJob = useSwitchTemplateJob()
const {
  stage: switchStage,
  progressRatio: switchProgress,
  error: switchError,
  result: switchResult,
} = switchJob
```

修改 `onPrimary` 的 `else` 分支：

```typescript
    } else {
      if (!props.deckId) throw new Error('switch mode missing deckId prop')
      view.value = 'progress'
      try {
        await switchJob.start({
          deckId: props.deckId,
          targetTemplateId: selected.value.id,
        })
        view.value = 'success'
      } catch (err) {
        view.value = 'error'
      }
    }
```

在 `watch(() => props.open)` 的 open=true 分支里加 `view.value = 'picker'` 和 `switchJob.abort()`；open=false 也 abort：

```typescript
watch(
  () => props.open,
  (v) => {
    if (v) {
      title.value = '未命名幻灯片'
      submitError.value = null
      submitting.value = false
      view.value = 'picker'
      switchJob.abort()
      void loadManifests()
    } else {
      switchJob.abort()
    }
  },
  { immediate: true },
)
```

template 里把 `modal-body` 包一层 `v-if="view === 'picker'"`，其他 view 给占位：

```vue
<div v-if="view === 'picker'" class="modal-body">
  <!-- 原 picker 内容 -->
</div>
<div v-else-if="view === 'progress'" class="modal-body">
  正在切换到「{{ selected?.name }}」…
</div>
<div v-else-if="view === 'success'" class="modal-body">
  <!-- 占位，Task 7C-6 再实现 -->
  切换完成
</div>
<div v-else-if="view === 'error'" class="modal-body">
  <!-- 占位 -->
  切换失败
</div>
```

footer 仅在 picker / error view 显示（progress 阶段禁止 Esc 已在 overlay @click.self 需改成条件）：

把 `<div v-if="open" class="modal-overlay" @click.self="close">` 改为：

```vue
<div
  v-if="open"
  class="modal-overlay"
  @click.self="onOverlayClick"
>
```

并在 script 加：

```typescript
function onOverlayClick() {
  if (view.value === 'progress') return
  close()
}
```

footer 限定 picker view：

```vue
<div v-if="view === 'picker'" class="modal-footer">
  <button type="button" class="btn-secondary" :disabled="submitting" @click="close">取消</button>
  <button
    type="button"
    :class="mode === 'switch' ? 'btn-danger' : 'btn-primary'"
    :disabled="!canSubmit"
    data-primary-action
    @click="onPrimary"
  >
    {{ primaryLabel }}
  </button>
</div>
```

- [ ] **Step 4：跑测试转绿**

```bash
pnpm -F @big-ppt/creator test -- TemplatePickerModal
```

Expected: 之前 4 条 + 新增 4 条 = 8 条全过。

- [ ] **Step 5：`DeckEditorCanvas.vue` 顶栏加"切换模板"按钮**

修改 `packages/creator/src/components/DeckEditorCanvas.vue`：

`import` 行加 `Layers`：

```typescript
import { ArrowLeft, History, Layers, LogOut, Settings, Sparkles } from 'lucide-vue-next'
```

import `TemplatePickerModal`：

```typescript
import TemplatePickerModal from './TemplatePickerModal.vue'
```

state 里加：

```typescript
const showTemplatePicker = ref(false)
const router = useRouter()  // 若尚未引入
```

在 `<template>` `toolbar-actions` 里的 History 按钮与 Settings 按钮之间插入：

```vue
<button
  type="button"
  class="icon-btn"
  title="切换模板（AI 重写）"
  aria-label="切换模板"
  @click="showTemplatePicker = true"
>
  <Layers :size="18" :stroke-width="1.8" />
</button>
```

在 `<SettingsModal>` 下方挂载：

```vue
<TemplatePickerModal
  v-model:open="showTemplatePicker"
  mode="switch"
  :deck-id="deck.id"
  :current-template-id="deck.templateId"
/>
```

- [ ] **Step 6：dev 手验**

```bash
pnpm dev
# 打开一个现有 deck，顶栏看到 Layers 图标；点击 → 弹窗，右侧显示警告条 + "切换（AI 重写）"危险色按钮
# 点切换 → 应切到 progress 占位文案（成功 / 失败状态占位文案也应按后端响应显示）
```

- [ ] **Step 7：跑全量测试**

```bash
pnpm test
```

Expected: 342 + 4 = 346 passing。

- [ ] **Step 8：commit**

```bash
git add packages/creator/src/components/TemplatePickerModal.vue \
        packages/creator/src/components/DeckEditorCanvas.vue \
        packages/creator/test/TemplatePickerModal.spec.ts && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): switch 模式接通 + 编辑页顶栏"切换模板"按钮

- TemplatePickerModal 加 view 状态机（picker/progress/success/error）
- switch 模式：默认选中非 current 模板 / 选回 current 禁按钮 / 右预览渲染警告条 / 点"切换"进 progress 视图
- progress view overlay 点击无效（防误关丢任务）；footer 仅 picker view 渲染
- DeckEditorCanvas 顶栏 History 与 Settings 之间新增 Layers 图标按钮
- progress / success / error 视图目前是占位文案，Task 7C-6 会填具体内容
- 单测新增 4 条覆盖 switch mode
EOF
)"
```

---

## Task 7C-6：progress / success / error 视图 + 状态机联调

**Files**:
- Modify: `packages/creator/src/components/TemplatePickerModal.vue`
- Modify: `packages/creator/test/TemplatePickerModal.spec.ts`

### 目标

把 Task 7C-5 留下的三个占位 view 补成完整交互：progress 展示 stage list + 进度条，success 展示成功文案 + "查看"按钮（关窗 + emit `switched`），error 展示错误原因 + 折叠详情 + retry / 关闭两按钮。

- [ ] **Step 1：加单测覆盖 progress / success / error 三个视图**

追加到 `TemplatePickerModal.spec.ts`：

```typescript
describe('TemplatePickerModal · progress / success / error', () => {
  it('progress view 显示 stage list，完成后进 success view 并带"查看"按钮', async () => {
    mockListTemplates()
    let count = 0
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'jp', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/jp', () => {
        count++
        if (count === 1) return HttpResponse.json({ job: { id: 'jp', state: 'snapshotting' } })
        if (count === 2) return HttpResponse.json({ job: { id: 'jp', state: 'migrating' } })
        return HttpResponse.json({
          job: {
            id: 'jp',
            state: 'success',
            snapshotVersionId: 7,
            newVersionId: 8,
          },
        })
      }),
    )
    vi.useFakeTimers()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.text()).toContain('保存当前版本快照')  // stage list 渲染
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(wrapper.text()).toContain('切换完成')
    expect(wrapper.find<HTMLButtonElement>('button[data-success-view]').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('点"查看"关窗 + emit switched 带 snapshotVersionId / newTemplateName', async () => {
    mockListTemplates()
    server.use(
      http.post('/api/decks/1/switch-template', () =>
        HttpResponse.json({ jobId: 'jp2', state: 'pending' }),
      ),
      http.get('/api/switch-template-jobs/jp2', () =>
        HttpResponse.json({
          job: { id: 'jp2', state: 'success', snapshotVersionId: 9, newVersionId: 10 },
        }),
      ),
    )
    vi.useFakeTimers()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    await wrapper.find<HTMLButtonElement>('button[data-success-view]').trigger('click')
    await flushPromises()
    const events = wrapper.emitted('switched')
    expect(events).toBeDefined()
    expect(events![0][0]).toMatchObject({
      snapshotVersionId: 9,
      newTemplateName: '竞业达汇报模板',
    })
    expect(wrapper.emitted('update:open')).toBeDefined()
    vi.useRealTimers()
  })

  it('error view 显示 retry 按钮，点击重新进 progress', async () => {
    mockListTemplates()
    let tries = 0
    server.use(
      http.post('/api/decks/1/switch-template', () => {
        tries++
        return HttpResponse.json({ jobId: `jr${tries}`, state: 'pending' })
      }),
      http.get(/switch-template-jobs\/jr1/, () =>
        HttpResponse.json({ job: { id: 'jr1', state: 'failed', error: 'boom' } }),
      ),
      http.get(/switch-template-jobs\/jr2/, () =>
        HttpResponse.json({ job: { id: 'jr2', state: 'migrating' } }),
      ),
    )
    vi.useFakeTimers()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1 },
    })
    await flushPromises()
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(wrapper.text()).toContain('切换失败')
    expect(wrapper.text()).toContain('boom')
    await wrapper.find<HTMLButtonElement>('button[data-retry]').trigger('click')
    await flushPromises()
    expect(tries).toBe(2)
    // 应回到 progress 视图
    expect(wrapper.text()).toContain('正在切换')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2：跑测试确认失败**

```bash
pnpm -F @big-ppt/creator test -- TemplatePickerModal
```

Expected: 新增 3 条 FAIL。

- [ ] **Step 3：实现 progress view**

把 `TemplatePickerModal.vue` 里 progress 占位替换为：

```vue
<div v-else-if="view === 'progress'" class="modal-body progress-body">
  <div class="progress-title">正在切换到「{{ selected?.name }}」</div>
  <ul class="stage-list">
    <li :class="stageClass('snapshotting')">
      <span class="stage-dot" />保存当前版本快照
    </li>
    <li :class="stageClass('migrating')">
      <span class="stage-dot" />AI 重写内容
    </li>
    <li :class="stageClass('success')">
      <span class="stage-dot" />写入新版本
    </li>
  </ul>
  <div class="progress-bar">
    <div class="progress-bar__fill" :style="{ width: `${Math.round(switchProgress * 100)}%` }" />
  </div>
  <div class="progress-hint">约 1 分钟，请稍候…</div>
</div>
```

script 里加 helper：

```typescript
const STAGE_ORDER: Array<'pending' | 'snapshotting' | 'migrating' | 'success'> = [
  'pending',
  'snapshotting',
  'migrating',
  'success',
]

function stageClass(target: 'snapshotting' | 'migrating' | 'success') {
  const cur = switchStage.value
  const curIdx = STAGE_ORDER.indexOf(cur as (typeof STAGE_ORDER)[number])
  const tgtIdx = STAGE_ORDER.indexOf(target)
  if (curIdx > tgtIdx) return 'stage-done'
  if (curIdx === tgtIdx) return 'stage-active'
  return 'stage-pending'
}
```

- [ ] **Step 4：实现 success view + emit switched**

把 success 占位替换为：

```vue
<div v-else-if="view === 'success'" class="modal-body success-body">
  <div class="success-icon">✓</div>
  <div class="success-title">切换完成</div>
  <div class="success-sub">已用「{{ selected?.name }}」重新生成内容</div>
  <button
    type="button"
    class="btn-primary"
    data-success-view
    @click="onSuccessClose"
  >
    查看
  </button>
</div>
```

script 加 emit 声明 + handler：

```typescript
const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [deck: Deck]
  switched: [payload: { snapshotVersionId: number | null; newTemplateId: string; newTemplateName: string }]
}>()

function onSuccessClose() {
  const snap = switchResult.value?.snapshotVersionId ?? null
  emit('switched', {
    snapshotVersionId: snap,
    newTemplateId: selected.value!.id,
    newTemplateName: selected.value!.name,
  })
  close()
}
```

- [ ] **Step 5：实现 error view + retry**

把 error 占位替换为：

```vue
<div v-else-if="view === 'error'" class="modal-body error-body">
  <div class="error-title">切换失败</div>
  <div class="error-msg">
    {{ switchError || '未知错误' }}<br />
    <span class="error-sub">快照已保存，当前 deck 未受影响。</span>
  </div>
  <div class="error-actions">
    <button type="button" class="btn-secondary" @click="close">关闭</button>
    <button type="button" class="btn-danger" data-retry @click="onRetry">重试</button>
  </div>
</div>
```

script 加：

```typescript
async function onRetry() {
  if (!props.deckId || !selected.value) return
  view.value = 'progress'
  try {
    await switchJob.start({
      deckId: props.deckId,
      targetTemplateId: selected.value.id,
    })
    view.value = 'success'
  } catch {
    view.value = 'error'
  }
}
```

- [ ] **Step 6：补 CSS**

在 `<style scoped>` 末尾加：

```css
.progress-body {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}
.progress-title {
  font-size: var(--fs-md);
  color: var(--color-fg-primary);
}
.stage-list {
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: var(--fs-sm);
}
.stage-list li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-fg-muted);
}
.stage-list li.stage-done {
  color: #3a9a5e;
}
.stage-list li.stage-active {
  color: var(--color-accent);
  font-weight: var(--fw-semibold);
}
.stage-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.progress-bar {
  width: 100%;
  max-width: 280px;
  height: 4px;
  background: var(--color-bg-subtle);
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar__fill {
  height: 100%;
  background: var(--color-accent);
  transition: width 200ms var(--ease-out);
}
.progress-hint {
  font-size: var(--fs-xs);
  color: var(--color-fg-muted);
}
.success-body,
.error-body {
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.success-icon {
  font-size: 36px;
  color: #3a9a5e;
}
.success-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: var(--color-fg-primary);
}
.success-sub {
  font-size: var(--fs-sm);
  color: var(--color-fg-muted);
}
.error-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-semibold);
  color: #b4472c;
}
.error-msg {
  font-size: var(--fs-sm);
  color: var(--color-fg-secondary);
  text-align: center;
  line-height: 1.6;
}
.error-sub {
  color: var(--color-fg-muted);
}
.error-actions {
  display: flex;
  gap: var(--space-2);
}
```

- [ ] **Step 7：测试转绿**

```bash
pnpm -F @big-ppt/creator test -- TemplatePickerModal
```

Expected: 11 条全过。

- [ ] **Step 8：dev 手验**

```bash
pnpm dev
# 打开已有 deck，点"切换模板"，选另一套 → 切换
# 观察 progress 视图 stage list 依次高亮 → success → 点"查看"关窗
# 也可人为中断 agent 服务制造错误，观察 error view + retry 行为
```

- [ ] **Step 9：跑全量测试**

```bash
pnpm test
```

Expected: 346 + 3 = 349 passing。

- [ ] **Step 10：commit**

```bash
git add packages/creator/src/components/TemplatePickerModal.vue \
        packages/creator/test/TemplatePickerModal.spec.ts && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): progress / success / error 三视图联调

- progress: stage list（snapshotting → migrating → writing）+ 进度条（useSwitchTemplateJob 的 progressRatio 驱动）
- success: 对号 + 标题 + "查看"按钮；点击 close 同时 emit switched { snapshotVersionId, newTemplateId, newTemplateName }
- error: 错误原因 + "快照已保存"提示 + retry / 关闭两按钮；retry 回到 progress 重跑
- 单测 3 条覆盖三视图
EOF
)"
```

---

## Task 7C-7：`UndoToast` 组件 + `VersionTimeline` 高亮 + `DeckEditorCanvas` 联动

**Files**:
- Create: `packages/creator/src/components/UndoToast.vue`
- Create: `packages/creator/test/UndoToast.spec.ts`
- Modify: `packages/creator/src/components/DeckEditorCanvas.vue`
- Modify: `packages/creator/src/components/VersionTimeline.vue`
- Modify: `packages/creator/test/VersionTimeline.spec.ts`（新增高亮单测）

- [ ] **Step 1：`UndoToast.spec.ts` 写测试**

新建 `packages/creator/test/UndoToast.spec.ts`：

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import UndoToast from '../src/components/UndoToast.vue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('UndoToast', () => {
  it('visible=true 时渲染 message 和 undo 链接', () => {
    const wrapper = mount(UndoToast, {
      props: {
        visible: true,
        templateName: '竞业达汇报模板',
        snapshotVersionId: 7,
      },
    })
    expect(wrapper.text()).toContain('已切换到「竞业达汇报模板」')
    expect(wrapper.find('a[data-undo-link]').exists()).toBe(true)
  })

  it('visible=true 后 6s 自动 emit close', async () => {
    const wrapper = mount(UndoToast, {
      props: { visible: true, templateName: 'X', snapshotVersionId: 1 },
    })
    await vi.advanceTimersByTimeAsync(5_999)
    expect(wrapper.emitted('close')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.emitted('close')).toBeDefined()
  })

  it('点 × 立刻 emit close', async () => {
    const wrapper = mount(UndoToast, {
      props: { visible: true, templateName: 'X', snapshotVersionId: 1 },
    })
    await wrapper.find('button[data-close]').trigger('click')
    expect(wrapper.emitted('close')).toBeDefined()
  })

  it('点 undo link emit undo 事件并携带 snapshotVersionId', async () => {
    const wrapper = mount(UndoToast, {
      props: { visible: true, templateName: 'X', snapshotVersionId: 42 },
    })
    await wrapper.find('a[data-undo-link]').trigger('click')
    const events = wrapper.emitted('undo')
    expect(events).toBeDefined()
    expect(events![0][0]).toBe(42)
  })
})
```

- [ ] **Step 2：测试确认失败**

```bash
pnpm -F @big-ppt/creator test -- UndoToast
```

Expected: FAIL（组件不存在）。

- [ ] **Step 3：实现 `UndoToast.vue`**

```vue
<script setup lang="ts">
import { watch } from 'vue'

const props = defineProps<{
  visible: boolean
  templateName: string
  snapshotVersionId: number | null
}>()

const emit = defineEmits<{
  close: []
  undo: [snapshotVersionId: number]
}>()

let timer: ReturnType<typeof setTimeout> | null = null

function armAutoClose() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => emit('close'), 6000)
}

watch(
  () => props.visible,
  (v) => {
    if (v) armAutoClose()
    else if (timer) {
      clearTimeout(timer)
      timer = null
    }
  },
  { immediate: true },
)

function onUndoClick(e: Event) {
  e.preventDefault()
  if (props.snapshotVersionId !== null) emit('undo', props.snapshotVersionId)
}

function onClose() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="visible" class="undo-toast" role="status">
        <span class="undo-toast__text">
          ✓ 已切换到「{{ templateName }}」 · 不满意？
          <a
            href="#"
            class="undo-toast__link"
            data-undo-link
            @click="onUndoClick"
          >/undo 回退</a>
        </span>
        <button
          type="button"
          class="undo-toast__close"
          aria-label="关闭"
          data-close
          @click="onClose"
        >×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.undo-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  background: var(--color-fg-primary);
  color: var(--color-bg-elevated);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-lg);
  font-size: var(--fs-sm);
  font-family: var(--font-sans);
  max-width: 600px;
}
.undo-toast__link {
  color: var(--color-accent-fg);
  text-decoration: underline;
  font-weight: var(--fw-medium);
}
.undo-toast__close {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
}
.undo-toast__close:hover {
  opacity: 1;
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
```

- [ ] **Step 4：测试转绿**

```bash
pnpm -F @big-ppt/creator test -- UndoToast
```

Expected: 4 条全过。

- [ ] **Step 5：`VersionTimeline.vue` 加高亮支持**

先写单测（追加到 `packages/creator/test/VersionTimeline.spec.ts`）：

```typescript
it('highlightVersionId 传入时该行加 data-highlighted=true', async () => {
  server.use(
    http.get('/api/decks/1/versions', () =>
      HttpResponse.json({
        versions: mockVersions([
          { id: 5, createdAt: '2026-04-25T10:00:00Z' },
          { id: 4, createdAt: '2026-04-25T09:59:00Z' },
        ]),
      }),
    ),
  )
  const wrapper = await mountIt({
    deckId: 1,
    currentVersionId: 5,
    highlightVersionId: 4,
  })
  await flushPromises()
  const highlighted = wrapper.findAll('[data-highlighted="true"]')
  expect(highlighted.length).toBe(1)
})
```

把 `mountIt` helper 的 props 类型扩展（加 `highlightVersionId?: number | null`）。

跑测试确认失败：

```bash
pnpm -F @big-ppt/creator test -- VersionTimeline
```

- [ ] **Step 6：实现高亮**

修改 `packages/creator/src/components/VersionTimeline.vue` defineProps 加 `highlightVersionId?: number | null`。

在 version item 循环的 DOM 上加：

```vue
<div
  v-for="v in items"
  :key="v.id"
  :data-highlighted="String(v.id === highlightVersionId)"
  class="version-item"
  :class="{ highlighted: v.id === highlightVersionId }"
>
```

scoped CSS 加：

```css
.version-item.highlighted {
  animation: pulse 2s ease-out 1;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 var(--color-accent-soft); }
  50% { box-shadow: 0 0 0 8px var(--color-accent-soft); }
  100% { box-shadow: 0 0 0 0 var(--color-accent-soft); }
}
```

- [ ] **Step 7：跑 VersionTimeline 测试确认绿**

```bash
pnpm -F @big-ppt/creator test -- VersionTimeline
```

Expected: 既有测试 + 新增 1 条全过。

- [ ] **Step 8：`DeckEditorCanvas.vue` 联动 undo toast + timeline 高亮**

修改 `packages/creator/src/components/DeckEditorCanvas.vue`：

import：

```typescript
import UndoToast from './UndoToast.vue'
```

state：

```typescript
const undoToast = ref<{ visible: boolean; templateName: string; snapshotVersionId: number | null }>({
  visible: false,
  templateName: '',
  snapshotVersionId: null,
})
const highlightVersionId = ref<number | null>(null)
```

template 里 `<TemplatePickerModal>` 加 `@switched="onTemplateSwitched"`：

```vue
<TemplatePickerModal
  v-model:open="showTemplatePicker"
  mode="switch"
  :deck-id="deck.id"
  :current-template-id="deck.templateId"
  @switched="onTemplateSwitched"
/>
<UndoToast
  :visible="undoToast.visible"
  :template-name="undoToast.templateName"
  :snapshot-version-id="undoToast.snapshotVersionId"
  @close="undoToast.visible = false"
  @undo="onUndoFromToast"
/>
```

`<VersionTimeline>` 加 `:highlight-version-id="highlightVersionId"`：

```vue
<VersionTimeline
  :deck-id="deck.id"
  :current-version-id="currentVersion?.id ?? null"
  :highlight-version-id="highlightVersionId"
  :open="showTimeline"
  @close="showTimeline = false"
  @restored="onTimelineRestored"
/>
```

handlers：

```typescript
function onTemplateSwitched(payload: {
  snapshotVersionId: number | null
  newTemplateId: string
  newTemplateName: string
}) {
  // 更新 deck state 反映新模板（父组件持有 deck 对象，mutate 让 SlidePreview 等响应）
  props.deck.templateId = payload.newTemplateId
  // 触发 reload 幻灯片内容：用 parent emit 或 refetch currentVersion
  // 简单做：emit 到 DeckEditorPage 让它 refetch deck + currentVersion
  emit('template-switched')  // 需加到 defineEmits

  undoToast.value = {
    visible: true,
    templateName: payload.newTemplateName,
    snapshotVersionId: payload.snapshotVersionId,
  }
}

function onUndoFromToast(snapshotVersionId: number) {
  undoToast.value.visible = false
  showTimeline.value = true
  highlightVersionId.value = snapshotVersionId
  // VersionTimeline 自己知道怎么 restore；这里只负责打开 + 高亮
  setTimeout(() => {
    highlightVersionId.value = null
  }, 2500)
}
```

修改 `defineEmits`：

```typescript
const emit = defineEmits<{
  'exit-to-list': []
  'template-switched': []
}>()
```

- [ ] **Step 9：`DeckEditorPage.vue` 响应 template-switched**

找到 `DeckEditorPage.vue`（list 上 `/decks/:id` 路由），在 `<DeckEditorCanvas>` 上加 `@template-switched="refetchDeck"`，`refetchDeck` 重新拉 `getDeck(id)` 更新 props。如果已有相似刷新逻辑（如 `onTimelineRestored`），复用同一路径。

（本 step 代码待阅读 `DeckEditorPage.vue` 后补全；如现有 `onTimelineRestored` 走类似 path 直接复用。）

- [ ] **Step 10：dev 手验完整链路**

```bash
pnpm dev
# 编辑器内切模板 → success → 点"查看"关窗
# 应看到底部 undo toast 出现 → 点 undo 链接 → VersionTimeline 打开 + 快照版本高亮闪动
# 点该版本的"回滚"按钮 → 回到旧模板内容
```

- [ ] **Step 11：跑全量测试**

```bash
pnpm test
```

Expected: 349 + 4 + 1 = 354 passing。

- [ ] **Step 12：commit**

```bash
git add packages/creator/src/components/UndoToast.vue \
        packages/creator/src/components/DeckEditorCanvas.vue \
        packages/creator/src/components/VersionTimeline.vue \
        packages/creator/test/UndoToast.spec.ts \
        packages/creator/test/VersionTimeline.spec.ts \
        packages/creator/src/pages/DeckEditorPage.vue && \
git status && \
git commit -m "$(cat <<'EOF'
feat(phase-7c): UndoToast + VersionTimeline 高亮 + 编辑页联动

- UndoToast: 底部居中 pill toast，6s 自动关，带 /undo 链接 emit snapshotVersionId
- VersionTimeline: 新增 highlightVersionId prop + 2s pulse 动画标注刚快照版本
- DeckEditorCanvas: 监听 TemplatePickerModal@switched → 立刻显示 toast + 更新 deck.templateId + emit template-switched 让父组件 refetch
- Undo 点击：关 toast + 打开 VersionTimeline + 设置 highlight 2.5s 后清
- 单测：UndoToast 4 条 + VersionTimeline 高亮 1 条
EOF
)"
```

---

## Task 7C-8：E2E 冒烟 spec — picker 渲染 + 新建走 jingyeda 路径

**Files**:
- Create: `packages/e2e/tests/template-picker.spec.ts`

- [ ] **Step 1：先查看既有 E2E 套件的 helper + fixture**

```bash
cat packages/e2e/tests/happy-path.spec.ts
ls packages/e2e/tests/helpers/
```

把 `happy-path.spec.ts` 里 register → login → list 页的 selector 常量记下（要复用或对齐）。

- [ ] **Step 2：新建 `packages/e2e/tests/template-picker.spec.ts`**

```typescript
import { expect, test } from '@playwright/test'
import { truncateAllTables, disposeDb } from './helpers/db'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await truncateAllTables()
})

test.afterAll(async () => {
  await disposeDb()
})

test('新建 deck 选择 jingyeda-standard 走通全链路', async ({ page }) => {
  // 注册 + 登录（与 happy-path 一致；若有 helper 则复用）
  await page.goto('/register')
  await page.getByLabel('邮箱').fill(`u-${Date.now()}@test.com`)
  await page.getByLabel('密码').fill('test1234')
  await page.getByRole('button', { name: /注册/ }).click()
  await expect(page).toHaveURL(/\/decks$/)

  // 点"新建 Deck"
  await page.getByRole('button', { name: /新建 Deck/ }).click()

  // picker 弹窗出现，两套模板卡片可见
  await expect(page.getByText('北投集团汇报模板')).toBeVisible()
  await expect(page.getByText('竞业达汇报模板')).toBeVisible()

  // 缩略图 img 元素加载（有 src 即可）
  const thumbs = page.locator('[data-template-card] img')
  await expect(thumbs).toHaveCount(2)

  // 点 jingyeda 卡片 → 右预览描述变化
  await page.getByText('竞业达汇报模板').click()
  await expect(page.getByText('商务科技风格')).toBeVisible()

  // 标题 + 点"创建"
  await page.getByRole('textbox').first().fill('我的竞业达 Deck')
  await page.getByRole('button', { name: /^创建$/ }).click()

  // 跳转到编辑器，templateId 生效（从 URL / 页面元素验证）
  await expect(page).toHaveURL(/\/decks\/\d+$/)
  await expect(page.getByText('我的竞业达 Deck')).toBeVisible()
  // 预览区渲染 jingyeda 模板（检查某个 jingyeda layout 独有的文字 / class 即可，参考 packages/slidev/templates/jingyeda-standard/starter.md 里首页标题）
})
```

（测试里用户注册的 selector 如与 happy-path 现用的不同，参考 happy-path 对齐。）

- [ ] **Step 3：跑 E2E**

```bash
pnpm e2e -- template-picker
```

Expected: 1 passing。失败时按失败截图调 selector（`test-results/` 下看）。

- [ ] **Step 4：跑全量 E2E**

```bash
pnpm e2e
```

Expected: 5 + 1 = 6 passing。

- [ ] **Step 5：commit**

```bash
git add packages/e2e/tests/template-picker.spec.ts && \
git status && \
git commit -m "$(cat <<'EOF'
test(phase-7c): E2E 冒烟 · 新建 deck 选 jingyeda-standard 全链路

- picker 弹窗渲染 + 两套模板卡片 + 缩略图 img 加载
- 切换选中 → 右预览描述更新
- 点创建 → POST /api/decks 走通 → 跳编辑页 → 标题显示 + 模板生效

完整 3 条切换 E2E 留给 Phase 7D / plan 15
EOF
)"
```

---

## Task 7C-9：全量验证 + 关闭 + roadmap 变更记录

**Files**:
- Modify: `docs/requirements/roadmap.md`

- [ ] **Step 1：最终全量测试**

```bash
pnpm test && pnpm e2e
```

Expected: test 354 + e2e 6 = 360（或接近）全绿。

- [ ] **Step 2：全仓检查无遗留**

```bash
rg -n "TODO.*7c|FIXME.*7c" --type ts --type vue --type md packages/ docs/ scripts/
```

Expected: 0 hits（或仅是历史 plan 文档里提及 Phase 7C 的文字）。

- [ ] **Step 3：roadmap 验收清单勾选**

在 `docs/requirements/roadmap.md` Phase 7 验收条件章节把 7C 相关 checkbox 都打勾：

```
- [x] **7C 缩略图脚本幂等**：…
- [x] **7C `TemplatePickerModal` 单测覆盖**：…
- [x] **7C 全链路 manual**：…
- [x] `pnpm e2e` 全绿（原 5 条 + 7C 1 条冒烟 + 7D 3 条 = 9 条）  ← 7D 还没做，先保持 []
```

（`pnpm e2e 全绿 9 条` 依赖 7D，7C 关闭时暂不勾，写注释说明）。

- [ ] **Step 4：roadmap 变更记录追加**

在文件末尾 `路线图变更记录` 表格追加一行：

```
| 2026-MM-DD | **Phase 7C 关闭**（N 条 commit：<列短 hash + 一句话>）。TemplatePickerModal 共用组件（create/switch × picker/progress/success/error 状态机）+ useSwitchTemplateJob + UndoToast + 缩略图自动截图脚本。总测试 335 → 354 (+19 单测)；E2E 5 → 6（+1 冒烟）。完整 3 条切换 E2E 留给 Phase 7D / plan 15 | 按 plan 14 顺序执行；状态机拆 Task 7C-5 / 7C-6 两步（先接通 switch 路径 + 占位 view，再补全 progress/success/error）避免单 commit 过大 |
```

（commit hash 填最终实际的短 hash）。

- [ ] **Step 5：roadmap 状态行更新**

把 Phase 7 状态行从：

```
**状态**：进行中。**7A ✅ 关闭**（…）+ **7B ✅ 关闭**（…）；**7C 设计已收敛**… → 详见 [plan 14]…；7D 待启动。
```

改为：

```
**状态**：进行中。**7A ✅ 关闭**（…）+ **7B ✅ 关闭**（…）+ **7C ✅ 关闭**（2026-MM-DD）→ 详见 [plan 14](../plans/14-phase7c-template-ui.md)；7D 待启动。
```

- [ ] **Step 6：commit + 关闭 Phase 7C**

```bash
git add docs/requirements/roadmap.md && \
git status && \
git commit -m "$(cat <<'EOF'
docs(phase-7c): roadmap 7C 关闭 + 变更记录

7C 全部 task 完成：TemplatePickerModal + useSwitchTemplateJob + UndoToast + 缩略图脚本。
总测试 335 → 354；E2E 5 → 6。完整 3 条切换 E2E 留 Phase 7D / plan 15。
EOF
)"
```

- [ ] **Step 7：清理**

```bash
rm -rf /Users/zhangxu/workspace/big-ppt/.superpowers/brainstorm
# 如已在 .gitignore 可省。确认 git status 干净。
git status
```

Expected: working tree clean。

---

## 验收（与 roadmap 对齐）

- [ ] **7C 缩略图脚本幂等**：`pnpm gen:thumbnails` 重跑后 `git diff` 仅在内容真变时显示
- [ ] **7C `TemplatePickerModal` 单测覆盖**：`mode × view` 状态机转移 + `useSwitchTemplateJob` 节奏 / 超时 / abort / retry
- [ ] **7C 全链路 manual**：新建走 picker / 编辑页切模板 happy + error 双路径在 dev 浏览器走通
- [ ] 总测试数 335 → ≥ 354（+ 19 单测）
- [ ] E2E 5 → 6（+1 冒烟）；完整 3 条切换 spec 待 Phase 7D

---

## 不做什么（范围围栏）

- ❌ 后台运行按钮（progress 阶段"关窗后台继续"—— YAGNI）
- ❌ 第三套模板或模板市场
- ❌ 模板 thumbnail 的 CI 自动生成（手跑 `pnpm gen:thumbnails`）
- ❌ 完整 3 条切换流 E2E（留给 Phase 7D / plan 15）
- ❌ 用户自定义模板
- ❌ deck 新建弹窗增加高级选项（initialContent / starterOverride）—— 保持"标题 + 模板"两字段

---

## 执行期偏离（关闭后追加）

- **subagent-driven 模式**：本 plan 用 `superpowers:subagent-driven-development` 跑，每 task 派 implementer → spec reviewer → code reviewer 三段
- **Plan 自身踩到 bug 时直接修 plan + 加 prevent-regression 测试**：JSDoc 关闭符 / migrating 公式 / emit 字段语义三处都是先发现 plan 自身写错，commit 修代码 + 同步修 plan
- **超额 +8 测试**：plan 预计 +19 单测，实际 +27（加了 prevent-regression 测试）
- **顺手修 7C-4 的 prod bug**：缩略图 URL 缺 `/api` 前缀，commit `cbf412a` 在 7C-8 期一并修

---

## 踩坑与解决

### 坑 1：JSDoc 里 `*​/​` 字符串字面量提前关闭注释

- **症状**：缩略图脚本注释里写了 `*/` 作为示例文本（描述 JSDoc 关闭符），导致整段 JSDoc 提前结束，TypeScript 报语法错误
- **根因**：JSDoc parser 不会区分注释体里的 `*/` 是字面文本还是真关闭符
- **修复**：commit `89ba35c` 把字面量里的 `*/` 拆成 `*​/​`（中间加零宽字符）；commit `a5612f7` 恢复中文注释 + 同时加 `scripts/tsconfig.json`
- **防再犯**：JSDoc 注释里写代码示例时绕开 `*/` 字面量；或者用单行注释代替
- **已提炼到 CLAUDE.md**：是

### 坑 2：Vue Test Utils 不跨 Teleport 边界 query

- **症状**：`TemplatePickerModal` 用 `<Teleport to="body">`，单测 `wrapper.find('.template-picker')` 找不到
- **根因**：VTU 2 默认在 wrapper.element 子树内查询，Teleport 把内容渲到 body 之外
- **修复**：commit `5bb2431` — 组件加 `disableTeleport` prop，测试时传 `true` 让组件 inline render
- **防再犯**：所有用到 Teleport 的组件单测都加 disableTeleport seam
- **已提炼到 CLAUDE.md**：是

### 坑 3：进度条进度公式钳到 0.51 不动

- **症状**：切模板进度条 migrating 阶段后期在 51% 卡住不动
- **根因**：plan 原公式是 `0.5 + (1 - 0.5) * (1 - Math.pow(0.5, polls / 30))`，看起来是渐进 1.0 但实际数学上趋近 0.51 后变化极慢
- **修复**：commit `8529f7c` 改公式 `0.5 + 0.5 * Math.min(polls / 30, 1)` 简单线性递增；同步修 plan 防误导后续读者
- **防再犯**：所有"动画 / 进度"公式都跑一遍取值表验证，不能纸上推
- **已提炼到 CLAUDE.md**：否（属于 UI 微动画细节）

### 坑 4：onUnmounted 漏清 timer 导致 memory leak

- **症状**：DeckEditorCanvas 切换 deck 后，旧 deck 的 highlightTimer 仍在跑
- **根因**：onMounted 里 setTimeout 没在 onUnmounted 里 clearTimeout
- **修复**：commit `2eb4303` 加 `onUnmounted(() => clearTimeout(highlightTimer))`
- **防再犯**：所有组件内的 setTimeout / setInterval 必须配 onUnmounted 清理；ESLint rule 可加自定义检查
- **已提炼到 CLAUDE.md**：否（是通用 Vue 卫生）

### 坑 5：缩略图 URL 缺 `/api` 前缀（dev OK / prod 挂）

- **症状**：dev 模式缩略图正常加载，prod build 后 picker 里全部 broken image
- **根因**：dev 模式 vite proxy 把 `/list-templates` 透到 agent；prod 没有 proxy，必须自己带 `/api/` 前缀
- **修复**：commit `cbf412a` — fetch URL 改 `/api/list-templates` 显式带前缀
- **防再犯**：所有前端 API 调用一律走 `/api/*` 前缀，不能依赖 proxy 兜底
- **已提炼到 CLAUDE.md**：是（已纳入"关键约定（前端）"）

### 坑 6：lock 跨测污染导致 409

- **症状**：E2E 一条 case 持锁后没释放，下条 case 进同 deck 看到 409
- **根因**：lock 是 agent 进程内存对象，跨测试不会自动清
- **修复**：commit `9c62e5c` — 加 `_test/reset-lock` 测试专用路由（仅 test env 暴露），E2E `beforeEach` 调一次
- **防再犯**：所有"进程内 stateful"模块都要在测试 env 下暴露 reset hook
- **已提炼到 CLAUDE.md**：是（已纳入"测试基建注意点"）

---

## 测试数量落地

| 阶段（commit）| agent | creator | shared | E2E | 合计 |
| ------------- | ----- | ------- | ------ | --- | ---- |
| 入口（Phase 6 收）| 281 | 49 | — | 5 | 335 |
| 7C-1 (c3b440d) | 281 | 49 | — | 5 | 335 |
| 7C-2 (444f76b) | 281 | 49 | — | 5 | 335 |
| 7C-3 (8529f7c useSwitchTemplateJob 5+1) | 281 | 55 | — | 5 | 341 |
| 7C-4 (5bb2431 TemplatePickerModal 4) | 281 | 59 | — | 5 | 345 |
| 7C-5 (340c8f7 + db0fc1d) | 281 | 60 | — | 5 | 346 |
| 7C-6 (b103164 + 5bfe966) | 281 | 65 | — | 5 | 351 |
| 7C-7 (2eb4303) | 281 | 71 | — | 5 | 357 |
| 7C-8 (9c62e5c E2E 冒烟 + cbf412a fix) | 281 | 72 | 3 | 6 | **362** |

> 实际超预期 +8（plan 预计 335 → ≥ 354）。完整 3 条切换流 E2E 留 Phase 7D / [plan 15](15-phase7d-e2e-and-undo-fix.md)。
