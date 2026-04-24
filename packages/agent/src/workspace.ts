import fs from 'node:fs'
import path from 'node:path'

/**
 * 向上找含 `pnpm-workspace.yaml` 的目录作为 monorepo root。
 * 初始化时调一次，失败则抛 —— agent 没有可用 slides.md 无法工作。
 */
function findMonorepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start)
  const root = path.parse(dir).root
  while (true) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    if (dir === root) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`[agent] 未找到 monorepo root（pnpm-workspace.yaml）。从 ${start} 开始查找。`)
}

export interface Paths {
  root: string
  slidesPath: string
  historyDir: string
  /** 单模板目录，兼容 Phase 6 之前硬编码 company-standard 的路径期望。 */
  templatesDir: string
  /** 多模板根目录，`<templatesRoot>/<templateId>/manifest.json` + `starter.md`。 */
  templatesRoot: string
  logsDir: string
  mcpConfigPath: string
}

let cached: Paths | null = null

/** 仅测试使用：清空缓存，让下次 getPaths() 重新读 env 和 monorepo root */
export function __resetPathsForTesting(): void {
  cached = null
}

export function getPaths(): Paths {
  if (cached) return cached
  const root = findMonorepoRoot()
  const slidesPath = process.env.BIG_PPT_SLIDES_PATH
    ? path.resolve(process.env.BIG_PPT_SLIDES_PATH)
    : path.join(root, 'packages/slidev/slides.md')
  const historyDir = process.env.BIG_PPT_HISTORY_DIR
    ? path.resolve(process.env.BIG_PPT_HISTORY_DIR)
    : path.join(root, 'packages/agent/data/slides-history')
  const templatesDir = process.env.BIG_PPT_TEMPLATES_DIR
    ? path.resolve(process.env.BIG_PPT_TEMPLATES_DIR)
    : path.join(root, 'packages/slidev/templates/company-standard')
  const templatesRoot = process.env.BIG_PPT_TEMPLATES_ROOT
    ? path.resolve(process.env.BIG_PPT_TEMPLATES_ROOT)
    : path.join(root, 'packages/slidev/templates')
  const logsDir = process.env.BIG_PPT_LOGS_DIR
    ? path.resolve(process.env.BIG_PPT_LOGS_DIR)
    : path.join(root, 'logs')
  const mcpConfigPath = process.env.BIG_PPT_MCP_CONFIG
    ? path.resolve(process.env.BIG_PPT_MCP_CONFIG)
    : path.join(root, 'packages/agent/data/mcp.json')
  cached = {
    root,
    slidesPath,
    historyDir,
    templatesDir,
    templatesRoot,
    logsDir,
    mcpConfigPath,
  }
  return cached
}
