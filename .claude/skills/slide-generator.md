---
name: slide-generator
description: AI 幻灯片生成技能 —— 基于用户选定的公司模板，通过对话生成符合企业规范的 Slidev 演示文稿
user-invokable: true
---

# Slide Generator Skill

基于用户选定的公司模板生成 Slidev 演示文稿。

## 核心原则

**模板由用户指定，不是 AI 选择。** 用户会通过对话告诉你要用哪个模板套，你只需读取该模板的 DESIGN.md 和页面模板，然后按规范生成。

**每个模板套都有独立的 `DESIGN.md`，生成前必须先读取它。** DESIGN.md 定义了该模板的全部视觉规范（配色、字体、布局、组件样式等），生成内容必须严格遵循。

## 生成流程

```
1. 理解需求 → 2. 读取 DESIGN.md → 3. 读取页面模板 → 4. 组合输出
```

### Step 1: 理解需求

用户会告诉你：

- 使用哪个模板套（目录名，如 `company-standard`）
- 演示主题和内容要求
- 目标受众、大致时长等

如果用户没有明确指定模板，询问使用哪个模板套。

### Step 2: 读取 DESIGN.md

读取用户指定模板套目录下的 `DESIGN.md`。这个文件包含：

- 视觉风格与氛围定义
- 完整配色方案（主色、辅助色、背景色、文字色、强调色）
- 字体规范（字体族、字号层级、字重、行高、字间距）
- 组件样式（按钮、卡片、表格等）
- 布局原则（间距系统、网格、留白）
- Do's and Don'ts
- 可用 Slidev layouts 及使用场景

**所有视觉决策必须以 DESIGN.md 为准。**

### Step 3: 读取页面模板

读取模板套中需要的页面类型 markdown 文件（如 `cover.md`、`content.md` 等）。每个文件是一个独立的 Slidev slide 示例，包含 frontmatter 和占位内容。

### Step 4: 组合输出

按规则将页面组合为完整的 `slides.md`。

## 组合规则

- **第一页**必须是封面
- **最后一页**必须是封底
- 目录页紧跟封面之后
- 章节分隔页用于分隔大章节
- 内容页之间可自由组合
- 各页面之间用 `---` 分隔

## 输出格式

```markdown
---
theme: seriph
title: { { 演示标题 } }
class: text-center
transition: slide-left
---

{{封面内容}}

---

{{目录内容}}

---

{{内容页...}}

---

{{封底内容}}
```

### 要求

- headmatter 中的 theme 以 DESIGN.md 指定的为准
- 每个 slide 之间用 `---` 分隔
- 保持模板原有的 layout frontmatter 配置
- 中文内容，英文 layout/属性名
- 使用 Slidev 标准语法
- 适当使用 presenter notes（`<!-- -->`）
- **所有颜色、字体、间距等视觉属性必须严格遵循 DESIGN.md 的规范**

## 可用模板套

读取 `templates/README.md` 获取完整列表。当前可用：

| 模板套       | 目录                          | 适用场景                     |
| ------------ | ----------------------------- | ---------------------------- |
| 公司标准汇报 | `templates/company-standard/` | 日常汇报、季度总结、年终述职 |
