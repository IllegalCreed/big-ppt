import fs from 'node:fs'
import path from 'node:path'

/**
 * 向上找含 `pnpm-workspace.yaml` 的目录作为 monorepo root。
 * 初始化时调一次，失败则抛；模板、日志与 MCP 配置都从该根目录解析。
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
  /** 单模板目录，兼容 Phase 6 之前硬编码 beitou-standard 的路径期望。 */
  templatesDir: string
  /** 多模板根目录，`<templatesRoot>/<templateId>/manifest.json` + `starter.md`。 */
  templatesRoot: string
  /** 系统配图风格包根目录，`<imageStylesRoot>/<styleId>/manifest.json` + 图片资产。 */
  imageStylesRoot: string
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
  const templatesDir = process.env.BIG_PPT_TEMPLATES_DIR
    ? path.resolve(process.env.BIG_PPT_TEMPLATES_DIR)
    : path.join(root, 'packages/slidev/templates/beitou-standard')
  const templatesRoot = process.env.BIG_PPT_TEMPLATES_ROOT
    ? path.resolve(process.env.BIG_PPT_TEMPLATES_ROOT)
    : path.join(root, 'packages/slidev/templates')
  const imageStylesRoot = process.env.BIG_PPT_IMAGE_STYLES_ROOT
    ? path.resolve(process.env.BIG_PPT_IMAGE_STYLES_ROOT)
    : path.join(root, 'packages/slidev/image-styles')
  const logsDir = process.env.BIG_PPT_LOGS_DIR
    ? path.resolve(process.env.BIG_PPT_LOGS_DIR)
    : path.join(root, 'logs')
  const mcpConfigPath = process.env.BIG_PPT_MCP_CONFIG
    ? path.resolve(process.env.BIG_PPT_MCP_CONFIG)
    : path.join(root, 'packages/agent/data/mcp.json')
  cached = {
    root,
    templatesDir,
    templatesRoot,
    imageStylesRoot,
    logsDir,
    mcpConfigPath,
  }
  return cached
}
