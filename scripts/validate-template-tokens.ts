#!/usr/bin/env tsx
/**
 * Phase 7.5A：模板 `--ld-*` token 校验 CLI。
 *
 * 用法：
 *   pnpm validate:tokens packages/slidev/templates/beitou-standard
 *   pnpm validate:tokens packages/slidev/templates/jingyeda-standard
 *
 * 行为：
 *   - 读 <templateDir>/tokens.css，校验 `--ld-*` 是否覆盖 LD_TOKEN_SPEC（22 项）
 *   - 读 <templateDir>/manifest.json，如有 commonComponents 字段，校验值合法性
 *     （首版 7.5A 阶段 catalog 还没建，allowedNames 暂留空 → 只能在字段缺失时通过）
 *   - 缺 token / commonComponents 含未知值 → exit 1
 *   - 多余 `--ld-*` token → warning 不阻断
 *
 * 7.5D 引入公共组件 catalog 后，把这里的 ALLOWED_COMPONENTS 改为 import catalog。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  LD_TOKEN_SPEC,
  validateManifestComponents,
  validateTokens,
} from '../packages/agent/src/templates/validate-tokens.ts'

/**
 * 7.5A 阶段公共组件 catalog 还未建立；后续 7.5C-1/2/3 会陆续加 11+ 个组件，
 * 7.5D 落 catalog 后这里改成 `import { COMMON_COMPONENTS } from ...`。
 *
 * 当前留空数组，作用：模板若 manifest.commonComponents 字段为空数组或缺失则通过；
 * 若已经填了任何值，校验会标记为 invalid 提示用户先建 catalog。
 */
const ALLOWED_COMPONENTS: readonly string[] = []

function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`
}
function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`
}
function yellow(s: string): string {
  return `\x1b[33m${s}\x1b[0m`
}
function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`
}

function main(): number {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: tsx scripts/validate-template-tokens.ts <templateDir>')
    return 2
  }

  const templateDir = path.resolve(target)
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    console.error(red(`✖ Template directory not found: ${templateDir}`))
    return 2
  }

  const templateId = path.basename(templateDir)
  console.log(`\n=== Validating template tokens: ${templateId} ===\n`)
  console.log(dim(`Spec: ${LD_TOKEN_SPEC.length} tokens (4 categories)`))
  console.log(dim(`Dir:  ${templateDir}\n`))

  let ok = true

  // ── tokens.css ──
  const tokensPath = path.join(templateDir, 'tokens.css')
  if (!fs.existsSync(tokensPath)) {
    console.error(red(`✖ tokens.css not found: ${tokensPath}`))
    return 1
  }

  const css = fs.readFileSync(tokensPath, 'utf8')
  const tokenResult = validateTokens(css)

  console.log(
    `tokens.css: matched ${tokenResult.counts.matched} / ${tokenResult.counts.spec} spec tokens`,
  )

  if (tokenResult.missing.length > 0) {
    ok = false
    console.error(red(`\n✖ Missing ${tokenResult.missing.length} required tokens:`))
    for (const name of tokenResult.missing) {
      const def = LD_TOKEN_SPEC.find((t) => t.name === name)
      console.error(`  - ${name}` + (def ? dim(`  (${def.category}: ${def.description})`) : ''))
    }
  }

  if (tokenResult.extra.length > 0) {
    console.warn(yellow(`\n⚠ ${tokenResult.extra.length} extra --ld-* tokens not in spec:`))
    for (const name of tokenResult.extra) {
      console.warn(`  - ${name}`)
    }
  }

  // ── manifest.json ──
  const manifestPath = path.join(templateDir, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    let manifest: unknown
    try {
      manifest = JSON.parse(raw)
    } catch (e) {
      ok = false
      console.error(red(`\n✖ manifest.json parse error: ${(e as Error).message}`))
      return ok ? 0 : 1
    }

    const manifestResult = validateManifestComponents(
      manifest as { commonComponents?: unknown },
      ALLOWED_COMPONENTS,
    )

    if (manifestResult.structureError) {
      ok = false
      console.error(red(`\n✖ manifest.commonComponents 结构错误: ${manifestResult.structureError}`))
    } else if (manifestResult.invalid.length > 0) {
      ok = false
      console.error(red(`\n✖ manifest.commonComponents 含未知组件:`))
      for (const name of manifestResult.invalid) {
        console.error(`  - ${name}`)
      }
      console.error(
        dim('  (注：7.5A 阶段 catalog 尚未建立，请等 7.5C/7.5D 后再 opt-in commonComponents)'),
      )
    }
  }

  if (ok) {
    console.log(green('\n✓ Validation passed.\n'))
    return 0
  } else {
    console.error(red('\n✖ Validation failed.\n'))
    return 1
  }
}

const code = main()
process.exit(code)
