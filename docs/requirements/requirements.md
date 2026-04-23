# Big-PPT 功能需求

## 功能需求

### FR-01 模板系统

- 支持多套公司模板，每套包含封面、封底、目录页、内容页等多种页面类型
- 模板以 Slidev markdown 文件形式存储，易于维护和扩展
- 每套模板有独立的视觉规范（配色、字体、背景等）
- 支持新增模板套和页面类型

### FR-02 AI 幻灯片生成

- 用户先选择合适的模板套
- 用户通过自然语言描述演示需求
- AI 套用所选模板，根据需求组合页面（封面 → 目录 → 内容 → 封底）
- AI 填充具体内容并保持模板风格一致
- 生成完整的 Slidev slides.md 文件

### FR-03 对话式迭代

- 本地 dev 模式下可通过 Slidev 前端实时编辑 md 内容
- 用户可通过对话逐页修改内容
- 支持调整页面布局（如从单栏改为两栏）
- 支持增删页面
- 支持调整配色、字体等视觉元素

### FR-04 API Key 管理

- 支持配置 AI 服务 API Key（OpenAI / DeepSeek / 智谱等兼容接口）
- 支持多种 AI 服务提供商，可配置 provider / baseUrl / model
- **存储位置按阶段演进**：
  - Phase 1–4：浏览器 localStorage（纯单机开发期，便捷优先）
  - Phase 5 起：agent 后端 `users.llm_settings`，AES-256-GCM 加密，master key 从 `APIKEY_MASTER_KEY` 环境变量读；前端 localStorage 不再保留敏感信息
- LLM 调用在服务端进行，客户端不再携带 API Key

### FR-05 导出

- 导出为 PDF（Phase 7）
- 导出为 PNG 图片序列（Phase 7）
- 导出为 PPTX（Phase 7，可选探索）
- 本地演示模式（presenter mode）
- 导出历史记录与重新下载

### FR-06 用户账号与登录（Phase 5）

- 邮箱 + 密码注册 / 登录 / 登出
- 密码 bcrypt 哈希，明文绝不落 DB 或日志
- HttpOnly Cookie 承载 session，服务端 sessions 表可撤销
- `/api/auth/me` 获取当前用户信息，刷新页面保留登录态

### FR-07 多 Deck 管理（Phase 5）

- 登录后查看自己的 deck 列表（标题、状态、更新时间）
- 新建、重命名、软删（status='deleted'）
- 打开某 deck 进入编辑页，切换 deck 时系统自动处理 Slidev 实例内容切换
- Deck 归属私有，不跨用户可见（Phase 6 起引入分享链接）

### FR-08 版本历史与回滚（Phase 5）

- 每次保存自动追加一条 `deck_versions` 记录（append-only）
- 版本时间线面板展示所有历史版本与版本说明
- 一键回滚到任意历史版本（回滚 = 移动 `current_version_id`，保留完整时间线）
- 回滚后对话历史保留连续（`deck_chats` 独立于 `deck_versions`，AI 能理解"改主意了"的心智）

### FR-09 单实例并发控制（Phase 5）

- 同一时刻只允许一个用户占用 Slidev 实例编辑
- 第二个用户尝试进入已占用 deck 时显示等待页：当前占用者、锁定时长、最近活跃时间
- 等待页每 5 秒轮询锁状态，释放后自动跳转
- 占用中客户端每 30 秒发送心跳刷新 `last_heartbeat_at`
- 主动释放（点击"结束编辑"按钮 / 窗口关闭）立即放行
- 心跳超时（默认 5 分钟）自动判定释放，防止用户强退留下死锁

### FR-10 部署与上线

- 单实例上线（Phase 5.5）：域名 + HTTPS + systemd 或 Docker compose + MySQL 生产部署 + 密钥下发 + DB 定时备份 + healthcheck
- 多实例上线（Phase 6 尾段）：反代按 session 路由 + 滚动灰度切换
- 部署到阿里云服务器，不依赖第三方 BaaS

### FR-11 导入（Phase 8）

- Markdown 导入（粘贴或 URL 拉取）
- PPTX 导入（可选探索）
- 导入预览页让用户确认后才落库

## 非功能需求

### NFR-01 性能

- AI 生成完整演示文稿 < 30 秒
- 幻灯片渲染流畅，无明显卡顿
- 支持流式输出（逐页生成，不等全部完成）

### NFR-02 安全性

- API Key 按阶段存储（见 FR-04）：Phase 1–4 本地 localStorage，Phase 5+ 服务端 AES-256-GCM 加密存储
- 用户密码 bcrypt 哈希存储，明文绝不落 DB 或日志
- Session cookie 使用 HttpOnly + SameSite=Lax + Secure（生产）
- 生成的幻灯片内容不经过第三方服务器（除 AI API 调用外）
- 数据库连接密码、master key、session secret 等敏感信息通过环境变量下发，**绝不进 git**
- 每次 commit 前人工 `git status` 确认无 `.env.*.local` / `*.local` 被追踪

### NFR-03 可维护性

- 模板与代码分离，非开发人员也可编辑模板
- 清晰的项目结构和文档
- 模板新增和修改不需要改动核心代码

### NFR-04 兼容性

- 支持主流浏览器（Chrome、Firefox、Safari、Edge）
- 移动端可查看（响应式）
