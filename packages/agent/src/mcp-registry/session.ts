// packages/agent/src/mcp-registry/session.ts
import type { McpServerConfig, McpServerStatus } from '@big-ppt/shared'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** MCP 会话的最小抽象:connect -> listTools -> callTool -> close */
export interface McpToolDef {
  name: string
  description?: string
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
}

export class McpSession {
  private client: unknown = null
  tools: McpToolDef[] = []
  status: McpServerStatus = { state: 'disabled' }

  constructor(public readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    this.status = { state: 'connecting' }
    try {
      // static import:在 Vitest 4 下,vi.mock(hoist) 对 static import 拦截稳定;
      // 历史用 dynamic import 是 Vitest 2 时代为了让 vi.mock 拦截的 work-around,
      // 但 Vitest 4 下 dynamic import 第二次调用会绕过 vi.mock 拿到真 SDK 模块
      // (实测多 server 场景失败:第二个 server 用真 Client → "_transport.send is
      // not a function")。production 等价(ESM module 缓存),改 static 仅让测试稳定。
      const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: { headers: this.config.headers },
      })
      const client: any = new Client(
        { name: 'big-ppt-agent', version: '0.1.0' },
        { capabilities: {} },
      )
      await client.connect(transport)
      const res: { tools: McpToolDef[] } = await client.listTools()
      this.tools = res.tools ?? []
      this.client = client
      this.status = {
        state: 'ok',
        toolCount: this.tools.length,
        connectedAt: new Date().toISOString(),
      }
    } catch (err) {
      this.status = { state: 'error', error: (err as Error).message }
      this.tools = []
      this.client = null
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) {
      return JSON.stringify({
        success: false,
        error: `MCP session ${this.config.id} 未连接:${this.status.error ?? '未知原因'}`,
      })
    }
    try {
      const res: {
        content?: Array<{ type: string; text?: string; mimeType?: string }>
        isError?: boolean
      } = await (this.client as any).callTool({ name, arguments: args })
      const parts: string[] = []
      for (const item of res.content ?? []) {
        if (item.type === 'text') parts.push(item.text ?? '')
        else if (item.type === 'image') parts.push(`[image: ${item.mimeType ?? 'image'}]`)
        else parts.push(`[${item.type}]`)
      }
      return JSON.stringify({ success: !res.isError, result: parts.join('\n') })
    } catch (err) {
      // 被动发现:call 失败即判定 session 坏掉,null 掉 client;下次调用会落到 !client 分支
      // 显式 reconnect 由 Task 6 的 /api/mcp/servers PATCH 触发,此处不自愈
      this.status = { state: 'error', error: (err as Error).message }
      this.client = null
      return JSON.stringify({ success: false, error: (err as Error).message })
    }
  }

  async close(): Promise<void> {
    try {
      await (this.client as any)?.close?.()
    } catch {
      // 主动关连接的失败都忽略,下一次 connect 会自建新 client
    }
    this.client = null
    this.tools = []
    this.status = { state: 'disabled' }
  }
}
