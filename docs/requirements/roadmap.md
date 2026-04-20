# Big-PPT 开发路线图

## Phase 1：项目基础 + 模板 ✅

**目标**：搭建项目结构，创建模板体系和 AI Skill 文件

**交付物**：
- docs 目录（plans、requirements）
- templates 目录及模板套结构
- AI Skill 文件（slide-generator.md）
- 公司模板 markdown 文件（基于模板图片生成）
- AI 生成效果已验证通过（slides.md 示例）

**状态**：已完成

---

## Phase 2：AI 集成 + 对话 UI

**目标**：构建 AI 对话界面，实现对话式幻灯片生成

**交付物**：
- AI API Key 配置界面
- 对话式交互 UI
- 幻灯片实时预览
- 流式生成支持

**状态**：待开始

**依赖**：Phase 1（已完成）

---

## Phase 3：架构重组（Monorepo）

**目标**：将原型拆分为 monorepo 三包结构，为后续功能开发和部署打好基础

**交付物**：
- pnpm workspace monorepo 搭建
- `packages/slidev` — 幻灯片渲染（现有内容迁入）
- `packages/creator` — 聊天 UI 前端（从 Vite 中间件迁移）
- `packages/agent` — Agent 后端（Node.js，Agent 主循环 + 工具执行 + LLM 调用）
- 前端不再直接操作文件，全部通过 Agent 后端 API

**状态**：待开始

**依赖**：Phase 2 完成（原型验证通过后再拆分，避免过早抽象）

---

## Phase 4：编辑与迭代

**目标**：支持通过对话对已生成的幻灯片进行迭代修改

**交付物**：
- 逐页编辑功能
- 布局切换
- 样式调整
- 页面增删

**依赖**：Phase 3 完成

---

## Phase 5：导出与部署

**目标**：完善导出功能，支持云端部署

**交付物**：
- PDF 导出
- PPTX 导出
- 一键部署到阿里云服务器
- 本地演示模式优化

**依赖**：Phase 4 完成

---

## Phase 6：高级功能（远期）

**目标**：扩展高级能力

**可能方向**：
- 多语言支持
- 团队共享模板
- 版本历史
- 协同编辑
- 自定义主题编辑器
