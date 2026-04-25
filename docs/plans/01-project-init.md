# Phase 1 — 项目基础 + 模板 实施文档

> **状态**：✅ 已关闭（2026-04 早期，作为 Lumideck 项目起点）
> **后续阶段**：Phase 2（[02-ai-integration.md](02-ai-integration.md)）
> **路线图**：[roadmap.md Phase 1](../requirements/roadmap.md)

**Goal**：搭建项目目录与模板骨架，为后续 AI 对话集成（Phase 2）和模板渲染体系打底。本 Phase 不涉及代码功能，纯文档与目录结构搭建。

---

## ⚠️ Secrets 安全红线（HARD，沿用 [CLAUDE.md 安全约定](../../CLAUDE.md#安全与提交规则)）

- 本 Phase 不引入任何环境变量或密钥（纯结构搭建期）
- 每次 `git commit` 前 `git status` 人工检查，禁用 `git add -A`

---

## Context

用户要做一个基于 Slidev 的公司幻灯片模板项目，目标是最终实现 AI 对话式生成幻灯片。当前是第一步：搭建项目基础结构，创建文档体系，为后续模板开发和 AI 集成做准备。

模板体系：多套模板，每套包含多个页面类型（封面、封底、目录、内容页等），AI 按需组合这些页面生成完整演示文稿。

## 步骤

### 1. 创建 docs 目录结构

```
docs/
├── plans/              # 实现计划存放处
│   └── .gitkeep
└── requirements/       # 需求文档
    ├── vision.md       # 项目愿景与整体目标
    ├── requirements.md # 功能需求与非功能需求
    └── roadmap.md      # 开发路线图（分阶段）
```

### 2. 编写需求文档

**docs/requirements/vision.md** — 项目愿景：

- 核心愿景：AI 对话 + 公司模板 = 专业幻灯片
- 目标用户、核心场景、技术栈、成功标准

**docs/requirements/requirements.md** — 功能需求：

- API Key 管理、对话生成、模板系统、编辑迭代、导出部署等

**docs/requirements/roadmap.md** — 路线图：

- Phase 1：项目基础 + 模板（当前）
- Phase 2：AI 集成 + 对话 UI
- Phase 3：编辑迭代 + 导出部署
- Phase 4：高级功能

### 3. 创建模板目录结构

每套模板是一个目录，包含各个页面类型的 md 文件：

```
templates/
├── README.md                   # 模板索引（所有模板套的目录）
├── company-standard/           # 套：公司标准汇报
│   ├── README.md               # 本套模板说明（适用场景、页面清单、配色等）
│   ├── cover.md                # 封面
│   ├── back-cover.md           # 封底
│   ├── toc.md                  # 目录页
│   ├── section.md              # 章节分隔页
│   ├── content.md              # 通用内容页
│   ├── two-col.md              # 两栏内容页
│   ├── image-content.md        # 图文混排页
│   └── data.md                 # 数据展示页
├── tech-sharing/               # 套：技术分享
│   ├── README.md
│   ├── cover.md
│   ├── ...
└── project-review/             # 套：项目复盘
    ├── README.md
    ├── cover.md
    ├── ...
```

每套模板的 `README.md` 记录：

- 模板名称、适用场景、配色方案
- 包含的页面类型及用途说明
- 使用注意事项

每个页面 md 文件就是一个独立的 Slidev slide（单页 `---` frontmatter + 内容），AI 根据用户需求选择模板套，从中挑选合适的页面组合成完整的 `slides.md`。

> 实际模板内容等用户提供公司模板图片后再填充。当前先建目录结构和 README。

### 4. 创建 AI Skill 文件

在 `.claude/skills/` 下创建 slide-generator skill：

```
.claude/skills/
└── slide-generator.md
```

内容要点：

- 模板套索引：列出所有可用模板及其适用场景
- 页面类型清单：每种页面的用途和 layout 说明
- 生成流程：选模板套 → 选页面 → 组合 → 填充内容 → 输出 slides.md
- 组合规则：封面必须在最前、封底在最后、目录在封面后等
- 公司视觉规范（等模板图片后补充具体颜色/字体）
- 输出格式要求（frontmatter 配置、slide 分隔符等）

### 5. 创建 public 目录

用于存放公司 logo、背景图等静态资源：

```
public/
└── .gitkeep
```

## 涉及的文件

| 操作 | 文件                                           |
| ---- | ---------------------------------------------- |
| 新建 | `docs/plans/.gitkeep`                          |
| 新建 | `docs/requirements/vision.md`                  |
| 新建 | `docs/requirements/requirements.md`            |
| 新建 | `docs/requirements/roadmap.md`                 |
| 新建 | `templates/README.md`                          |
| 新建 | `templates/company-standard/README.md`（占位） |
| 新建 | `.claude/skills/slide-generator.md`            |
| 新建 | `public/.gitkeep`                              |

## 验收条件

- 目录结构正确创建
- 所有 md 文件内容完整且有意义
- `pnpm dev` 仍可正常运行

---

## 踩坑与解决

> 本 Phase 是项目结构与文档骨架的搭建期，无显著工程性踩坑。Phase 2 起 AI 对话与模板渲染开始有踩坑记录。

---

## 测试数量落地

> 本 Phase 不涉及测试代码（纯文档与目录搭建）。测试基建从 [Phase 3](06-phase3-monorepo-agent.md) 起落地。
