// packages/agent/src/mcp-registry/registry.ts
import type { McpServerConfig, McpServerStatus } from '@big-ppt/shared'
import type { McpServerRepo } from '../mcp-server-repo/types.js'
import { registerForUser, unregisterForUser } from '../tools/registry.js'
import { McpSession } from './session.js'

/**
 * Phase 9-F：每个 user 一个 McpRegistry 实例（A01 修复）。
 * sessions Map 是该 user 的 server connections；
 * activate 把工具 register 到 user-scoped tool registry。
 */
export class McpRegistry {
  private sessions = new Map<string, McpSession>()
  private initPromise: Promise<void> | null = null

  constructor(
    private readonly repo: McpServerRepo,
    private readonly userId: number,
  ) {}

  async initialize(): Promise<void> {
    const all = await this.repo.list(this.userId)
    await Promise.all(all.filter((c) => c.enabled).map((c) => this.activate(c)))
  }

  /**
   * 幂等 lazy 初始化。getRegistry(userId) 创建实例后通过 `mcp-registry/index.ts`
   * 调用，确保第一次 GET /api/mcp/servers 或 /api/tools 之前 connect 完成。
   * 后续调用是 noop。
   */
  ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((err) => {
        console.warn(`[mcp-registry] init partial failure (user=${this.userId}):`, (err as Error).message)
      })
    }
    return this.initPromise
  }

  /** 配置变化后同步 session + 注册表 */
  async sync(config: McpServerConfig): Promise<void> {
    const existing = this.sessions.get(config.id)
    if (existing) {
      this.unregisterSessionTools(existing)
      await existing.close()
      this.sessions.delete(config.id)
    }
    if (config.enabled) {
      await this.activate(config)
    }
  }

  getStatus(id: string): McpServerStatus {
    return this.sessions.get(id)?.status ?? { state: 'disabled' }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.unregisterSessionTools(session)
      await session.close()
    }
    this.sessions.clear()
  }

  // ---- 内部 ----

  private async activate(config: McpServerConfig): Promise<void> {
    if (this.sessions.has(config.id)) {
      console.warn(`[mcp-registry] duplicate config.id: ${config.id}, skipping`)
      return
    }
    const session = new McpSession(config)
    this.sessions.set(config.id, session)
    await session.connect()
    if (session.status.state !== 'ok') return
    for (const t of session.tools) {
      registerForUser(this.userId, {
        name: `mcp__${config.id}__${t.name}`,
        description: t.description,
        parameters: { ...t.inputSchema, properties: t.inputSchema.properties ?? {} },
        exec: async (args) => session.callTool(t.name, args),
      })
    }
  }

  private unregisterSessionTools(session: McpSession): void {
    for (const t of session.tools) {
      unregisterForUser(this.userId, `mcp__${session.config.id}__${t.name}`)
    }
  }
}
