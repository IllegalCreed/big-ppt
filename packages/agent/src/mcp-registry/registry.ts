// packages/agent/src/mcp-registry/registry.ts
import type { McpServerConfig, McpServerStatus } from '@big-ppt/shared'
import type { McpServerRepo } from '../mcp-server-repo/types.js'
import { register, unregister } from '../tools/registry.js'
import { McpSession } from './session.js'

export class McpRegistry {
  private sessions = new Map<string, McpSession>()

  constructor(private readonly repo: McpServerRepo) {}

  async initialize(): Promise<void> {
    const all = await this.repo.list()
    await Promise.all(all.filter((c) => c.enabled).map((c) => this.activate(c)))
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
      register({
        name: `mcp__${config.id}__${t.name}`,
        description: t.description,
        parameters: { ...t.inputSchema, properties: t.inputSchema.properties ?? {} },
        exec: async (args) => session.callTool(t.name, args),
      })
    }
  }

  private unregisterSessionTools(session: McpSession): void {
    for (const t of session.tools) {
      unregister(`mcp__${session.config.id}__${t.name}`)
    }
  }
}
