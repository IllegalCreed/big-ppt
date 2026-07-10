#!/usr/bin/env tsx
/** 用 creator 的 DeckRenderer 视觉入口批量生成模板封面缩略图。 */
import { chromium } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join(REPO_ROOT, 'packages/slidev/templates')
const PORT = 3033
const ORIGIN = `http://localhost:${PORT}`

async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(ORIGIN)
      if (res.ok) return
    } catch {
      // server 仍在启动
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`creator server 未在 ${timeoutMs}ms 内启动:${ORIGIN}`)
}

function startCreator(): ChildProcess {
  const child = spawn(
    'pnpm',
    ['-F', '@big-ppt/creator', 'exec', 'vite', '--port', String(PORT), '--strictPort'],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      env: { ...process.env, DISABLE_VUE_DEVTOOLS: '1' },
    },
  )
  child.stdout?.on('data', (chunk) => process.stdout.write(`[creator] ${chunk}`))
  child.stderr?.on('data', (chunk) => process.stderr.write(`[creator] ${chunk}`))
  return child
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ])
}

async function main(): Promise<void> {
  const ids = fs
    .readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(TEMPLATES_DIR, entry.name, 'manifest.json')))
    .map((entry) => entry.name)
    .sort()

  console.log(`待处理模板:${ids.join(', ')}`)
  const server = startCreator()
  try {
    await waitForServer()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
      for (const templateId of ids) {
        const templateDir = path.join(TEMPLATES_DIR, templateId)
        const manifestPath = path.join(templateDir, 'manifest.json')
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
          thumbnail?: string
          [key: string]: unknown
        }
        console.log(`[${templateId}] 渲染 DeckRenderer 封面...`)
        await page.goto(`${ORIGIN}/_visual/${templateId}/cover?thumbnail=1`, {
          waitUntil: 'networkidle',
        })
        await page.locator('.slide-canvas').waitFor({ state: 'visible' })
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({
          path: path.join(templateDir, 'thumbnail.png'),
          type: 'png',
        })

        if (manifest.thumbnail !== 'thumbnail.png') {
          manifest.thumbnail = 'thumbnail.png'
          fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
        }
        console.log(`[${templateId}] thumbnail.png ✓`)
      }
    } finally {
      await browser.close()
    }
  } finally {
    await stopProcess(server)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
