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
  slidesBak: string
  templatesDir: string
  logsDir: string
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
  const templatesDir = process.env.BIG_PPT_TEMPLATES_DIR
    ? path.resolve(process.env.BIG_PPT_TEMPLATES_DIR)
    : path.join(root, 'packages/slidev/templates/company-standard')
  const logsDir = process.env.BIG_PPT_LOGS_DIR
    ? path.resolve(process.env.BIG_PPT_LOGS_DIR)
    : path.join(root, 'logs')
  cached = {
    root,
    slidesPath,
    slidesBak: `${slidesPath}.bak`,
    templatesDir,
    logsDir,
  }
  return cached
}
