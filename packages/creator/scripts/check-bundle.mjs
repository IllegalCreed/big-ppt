import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST_DIR = resolve(import.meta.dirname, '../dist')
const ASSETS_DIR = resolve(DIST_DIR, 'assets')
const MANIFEST_PATH = resolve(DIST_DIR, '.vite/manifest.json')

const budgets = {
  initialRaw: 400_000,
  initialGzip: 145_000,
  chunkRaw: 500_000,
  chunkGzip: 150_000,
}

function formatBytes(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`
}

function fileStats(file) {
  const content = readFileSync(resolve(DIST_DIR, file))
  return { file, raw: content.byteLength, gzip: gzipSync(content).byteLength }
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const entryKeys = Object.entries(manifest)
  .filter(([, chunk]) => chunk.isEntry)
  .map(([key]) => key)

if (entryKeys.length !== 1) {
  throw new Error(`creator bundle budget: 预期 1 个入口，实际 ${entryKeys.length} 个`)
}

const initialFiles = new Set()
const visitedKeys = new Set()
function collectStaticImports(key) {
  if (visitedKeys.has(key)) return
  visitedKeys.add(key)

  const chunk = manifest[key]
  if (!chunk) throw new Error(`creator bundle budget: manifest 缺少 chunk ${key}`)
  if (chunk.file?.endsWith('.js')) initialFiles.add(chunk.file)
  for (const importedKey of chunk.imports ?? []) collectStaticImports(importedKey)
}
collectStaticImports(entryKeys[0])

const initialStats = [...initialFiles].map(fileStats)
const initialRaw = initialStats.reduce((sum, item) => sum + item.raw, 0)
const initialGzip = initialStats.reduce((sum, item) => sum + item.gzip, 0)

const chunkStats = readdirSync(ASSETS_DIR)
  .filter((file) => file.endsWith('.js'))
  .map((file) => fileStats(`assets/${file}`))
  .sort((a, b) => b.raw - a.raw)

const failures = []
if (initialRaw > budgets.initialRaw) {
  failures.push(`首屏静态 JS ${formatBytes(initialRaw)} > ${formatBytes(budgets.initialRaw)}`)
}
if (initialGzip > budgets.initialGzip) {
  failures.push(
    `首屏静态 JS(gzip) ${formatBytes(initialGzip)} > ${formatBytes(budgets.initialGzip)}`,
  )
}

for (const chunk of chunkStats) {
  if (chunk.raw > budgets.chunkRaw) {
    failures.push(
      `${chunk.file} ${formatBytes(chunk.raw)} > 单 chunk ${formatBytes(budgets.chunkRaw)}`,
    )
  }
  if (chunk.gzip > budgets.chunkGzip) {
    failures.push(
      `${chunk.file} gzip ${formatBytes(chunk.gzip)} > 单 chunk ${formatBytes(budgets.chunkGzip)}`,
    )
  }
}

const largest = chunkStats[0]
console.log(
  `[bundle] initial ${formatBytes(initialRaw)} raw / ${formatBytes(initialGzip)} gzip (${initialFiles.size} files)`,
)
if (largest) {
  console.log(
    `[bundle] largest ${largest.file} ${formatBytes(largest.raw)} raw / ${formatBytes(largest.gzip)} gzip`,
  )
}

if (failures.length > 0) {
  console.error('[bundle] budget exceeded:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('[bundle] budget ok')
}
