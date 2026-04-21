// packages/agent/src/mcp-server-repo/json-file-repo.ts
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import type { McpServerConfig } from '@big-ppt/shared'
import type { McpServerRepo, McpServerPatch } from './types.js'
import { PRESET_MCP_SERVERS } from './presets.js'

export class JsonFileRepo implements McpServerRepo {
  /** 串行化写入,避免并发 patch 相互覆盖 */
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async list(): Promise<McpServerConfig[]> {
    return this.load()
  }

  async get(id: string): Promise<McpServerConfig | undefined> {
    return (await this.load()).find((c) => c.id === id)
  }

  async create(config: McpServerConfig): Promise<void> {
    await this.enqueueWrite(async (all) => {
      if (all.some((c) => c.id === config.id)) {
        throw new Error(`MCP server ${config.id} already exists`)
      }
      // TODO(phase-5): encrypt config.headers before writing
      all.push(config)
      return all
    })
  }

  async update(id: string, patch: McpServerPatch): Promise<McpServerConfig> {
    let result!: McpServerConfig
    await this.enqueueWrite(async (all) => {
      const idx = all.findIndex((c) => c.id === id)
      if (idx < 0) throw new Error(`MCP server ${id} not found`)
      // TODO(phase-5): encrypt patch.headers before writing
      const merged: McpServerConfig = {
        ...all[idx]!,
        ...patch,
        headers: patch.headers ?? all[idx]!.headers,
      }
      all[idx] = merged
      result = merged
      return all
    })
    return result
  }

  async delete(id: string): Promise<void> {
    await this.enqueueWrite(async (all) => {
      const idx = all.findIndex((c) => c.id === id)
      if (idx < 0) return all
      if (all[idx]!.preset) throw new Error('cannot delete preset MCP server')
      all.splice(idx, 1)
      return all
    })
  }

  // ---- 内部 ----

  private enqueueWrite(
    mutator: (all: McpServerConfig[]) => Promise<McpServerConfig[]> | McpServerConfig[],
  ): Promise<void> {
    const next = this.writeQueue.then(async () => {
      const all = await this.load()
      const updated = await mutator(all)
      await this.persist(updated)
    })
    // 队列不能因为一次失败就卡死:失败路径上用 catch 吞掉传播,下一次独立开始
    this.writeQueue = next.catch(() => undefined)
    return next
  }

  private async load(): Promise<McpServerConfig[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('mcp.json must be an array')
      return parsed as McpServerConfig[]
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // 首次启动:seed 预置并落盘,之后 load 能正常走
        const seed = structuredClone(PRESET_MCP_SERVERS)
        await this.persist(seed)
        return seed
      }
      throw err
    }
  }

  private async persist(all: McpServerConfig[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf-8')
    // rename 在同一 FS 下原子
    try {
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      // Windows 上如果目标被占用会失败,fallback copy+unlink
      fsSync.copyFileSync(tmp, this.filePath)
      fsSync.unlinkSync(tmp)
      void err
    }
  }
}
