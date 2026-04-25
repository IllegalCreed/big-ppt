#!/usr/bin/env tsx
/**
 * Phase 7C thumbnail generation script (run once, or when adding new templates).
 *
 * Steps:
 *   1. Scan packages/slidev/templates/* /manifest.json
 *   2. For each template: write starter content to slides.md, start slidev CLI dev server,
 *      use playwright chromium to screenshot /1 at 1280x720, kill process
 *   3. Write thumbnail.png to template dir + set manifest.thumbnail = "thumbnail.png"
 *   4. Idempotent: if manifest.thumbnail already correct, skip JSON write (only PNG changes)
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join(REPO_ROOT, 'packages/slidev/templates')
const SLIDEV_DIR = path.join(REPO_ROOT, 'packages/slidev')
const PORT = 3033 // avoid conflict with dev default 3030/3031

async function waitForServer(url: string, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`slidev server never became ready at ${url}`)
}

async function captureTemplate(templateId: string) {
  console.log(`[${templateId}] preparing screenshot...`)
  const templateDir = path.join(TEMPLATES_DIR, templateId)
  const manifestPath = path.join(templateDir, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const starterAbs = path.join(templateDir, manifest.starterSlidesPath)
  const starterContent = fs.readFileSync(starterAbs, 'utf-8')

  const tmpSlides = path.join(SLIDEV_DIR, 'slides.md')
  const original = fs.existsSync(tmpSlides) ? fs.readFileSync(tmpSlides, 'utf-8') : null
  fs.writeFileSync(tmpSlides, starterContent)

  const proc = spawn(
    'pnpm',
    ['-F', '@big-ppt/slidev', 'exec', 'slidev', '--port', String(PORT), '--open', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  )
  proc.stdout.on('data', (d) => process.stdout.write(`[slidev] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[slidev] ${d}`))

  try {
    await waitForServer(`http://localhost:${PORT}`)
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(`http://localhost:${PORT}/1`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200) // wait for fonts + logo to load
    const outPath = path.join(templateDir, 'thumbnail.png')
    await page.screenshot({ path: outPath, type: 'png' })
    await browser.close()

    if (manifest.thumbnail !== 'thumbnail.png') {
      manifest.thumbnail = 'thumbnail.png'
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      console.log(`[${templateId}] manifest.thumbnail field written`)
    }
    console.log(`[${templateId}] OK -> ${outPath}`)
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (original !== null) fs.writeFileSync(tmpSlides, original)
    else fs.unlinkSync(tmpSlides)
  }
}

async function main() {
  const ids = fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(TEMPLATES_DIR, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()

  console.log(`templates to process: ${ids.join(', ')}`)
  for (const id of ids) {
    await captureTemplate(id)
  }
  console.log('Done. Commit thumbnail.png + manifest.json changes.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
