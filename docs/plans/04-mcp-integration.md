# Phase 2.2 — 通用 MCP 集成（已废弃）

> ⚠️ **已废弃（2026-04-21）**：本计划基于"Vite middleware = 事实上的后端"的前提，已被 [07-mcp-integration.md](07-mcp-integration.md) 完全取代。
>
> 实际 MCP 集成在 **Phase 3.5** 关闭，落地位置是独立的 `packages/agent` 服务（详见 [07](07-mcp-integration.md)）。

---

## 为什么废弃

Phase 2 关闭时识别到 `vite.config.creator.ts` 已长到 385 行，事实上承担了 LLM 代理 / 工具执行 / 日志归档 / 备份等"后端职责"。继续往里塞 MCP client 会让这个"伪后端"更难拆。

[Phase 3](06-phase3-monorepo-agent.md) 决策：先把后端从 Vite middleware 剥离成独立的 `packages/agent`（Hono on Node），再在 agent 里接 MCP——避免返工。

## 实际落地

| 项 | 04（废弃） | 07（实际落地） |
| --- | --- | --- |
| 运行位置 | Vite middleware（前端进程） | `packages/agent`（独立 Hono 服务，:4000） |
| MCP 客户端 | `@modelcontextprotocol/sdk` 装在前端 | 同 SDK，装在 agent |
| 配置存储 | localStorage（前端） | `data/mcp.json`（agent，Phase 5 加密） |
| 工具命名 | 内部直接合并 | `mcp__<serverId>__<toolName>` 命名规范（P3-5） |
| 前端 fetch | 直接调 MCP server | 走 agent 的 `GET /api/tools` + `POST /api/call-tool` |

---

## 历史记录

完整的 04 旧 plan 内容（约 1200 行）见 git 历史：

```bash
git show f8f08f1:docs/plans/04-mcp-integration.md
```

或在 GitHub 上查看本文件的历史版本。

---

**保留本文件的目的**：保留指针让历史 commit message / changelog 里的 "04-mcp-integration.md" 链接仍可解析；同时记录"为什么 04 → 07"的决策路径。
