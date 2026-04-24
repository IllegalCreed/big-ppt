import fs from 'node:fs'
import path from 'node:path'
import { validateManifest, type TemplateManifest } from '@big-ppt/shared'
import { getPaths } from '../workspace.js'

/** 扫 `templatesRoot` 下所有子目录，返回 { manifest, starter 路径 } 清单。 */
export interface LoadedTemplate {
  manifest: TemplateManifest
  dir: string
  starterAbsPath: string
}

let cached: Map<string, LoadedTemplate> | null = null

export function __resetTemplateRegistryForTesting(): void {
  cached = null
}

function loadAll(): Map<string, LoadedTemplate> {
  const { templatesRoot } = getPaths()
  const result = new Map<string, LoadedTemplate>()

  if (!fs.existsSync(templatesRoot)) {
    throw new Error(`[templates] templatesRoot 不存在: ${templatesRoot}`)
  }

  const entries = fs
    .readdirSync(templatesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())

  for (const entry of entries) {
    const dir = path.join(templatesRoot, entry.name)
    const manifestPath = path.join(dir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      // 目录里没有 manifest 视作非模板目录（如 deprecated / tmp），跳过
      continue
    }

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      throw new Error(
        `[templates] 解析 ${manifestPath} 失败: ${(err as Error).message}`,
      )
    }

    const validated = validateManifest(raw)
    if (!validated.ok) {
      throw new Error(
        `[templates] ${manifestPath} manifest 校验失败:\n  - ${validated.errors.join('\n  - ')}`,
      )
    }

    const manifest = validated.value
    if (manifest.id !== entry.name) {
      throw new Error(
        `[templates] ${manifestPath} manifest.id (${manifest.id}) 与目录名 (${entry.name}) 不一致`,
      )
    }

    const starterAbsPath = path.join(dir, manifest.starterSlidesPath)
    if (!fs.existsSync(starterAbsPath)) {
      throw new Error(
        `[templates] ${manifestPath} 声明的 starterSlidesPath 不存在: ${starterAbsPath}`,
      )
    }

    result.set(manifest.id, { manifest, dir, starterAbsPath })
  }

  if (result.size === 0) {
    throw new Error(`[templates] ${templatesRoot} 下未发现任何合法模板`)
  }

  return result
}

function getCache(): Map<string, LoadedTemplate> {
  if (!cached) cached = loadAll()
  return cached
}

/** 返回全部已注册模板的 manifest（按 id 字典序）。 */
export function listManifests(): TemplateManifest[] {
  return [...getCache().values()]
    .map((t) => t.manifest)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 按 id 获取 manifest；找不到返回 null（由调用方决定 404 / 抛错）。 */
export function getManifest(id: string): TemplateManifest | null {
  return getCache().get(id)?.manifest ?? null
}

/** 按 id 读 starter.md 内容（UTF-8）。id 未知抛错。 */
export function readStarter(id: string): string {
  const entry = getCache().get(id)
  if (!entry) throw new Error(`[templates] 未知模板 id: ${id}`)
  return fs.readFileSync(entry.starterAbsPath, 'utf-8')
}

/** 启动自检：强制 load 一次，任一模板非法则抛错终止启动。 */
export function verifyTemplatesOrThrow(): void {
  getCache()
}
