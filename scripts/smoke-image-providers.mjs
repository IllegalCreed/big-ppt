#!/usr/bin/env node
/**
 * Standalone smoke: 测三家 LLM provider 的"提示词生图"能力对比。
 *
 * 不动业务代码、不接 generate_slide_image 工具,纯外部 probe。
 * 写完即扔类脚本(不进 vitest 套件,不进 CI),手动跑 + 肉眼对比 PNG。
 *
 * 用法:
 *   OPENAI_TEST_KEY=sk-... GEMINI_TEST_KEY=sk-... \
 *     OPENAI_BASE_URL=https://www.duckcoding.ai/v1 \
 *     GEMINI_BASE_URL=https://www.duckcoding.ai \
 *     node scripts/smoke-image-providers.mjs
 *
 * 输出: scripts/smoke-output/<provider>-<model>-<timestamp>.png + console summary
 *
 * Prompt 复用 packages/agent/src/tools/local/generate-slide-image.ts 里
 * buildStructuredImagePrompt 的真实结构(productivity-visual + 色板 hex + 中文 label
 * 约束 + 边界 avoid 列表),用 fallback 色板,userPrompt hardcode 为 RAG 4 模块图。
 *
 * Provider 备注:
 *   - openai: gpt-5.5 走 /v1/responses + image_generation tool(项目主路径)
 *   - gemini: 双路 - Imagen 4 (predict endpoint) + nano-banana(generateContent)
 *   - claude: 跳过 — Anthropic 截至 2026-05 无原生 text-to-image API
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, 'smoke-output')

// ----- Prompt 构造(对齐 generate-slide-image 工具 buildStructuredImagePrompt) -----

const FALLBACK_PALETTE = [
  '#1f2937 (neutral charcoal)',
  '#3b82f6 (modern blue)',
  '#10b981 (emerald)',
  '#f59e0b (amber)',
  '#94a3b8 (neutral slate)',
]
const STYLE_HINT = 'modern corporate business aesthetic'

function buildStructuredImagePrompt(userPrompt) {
  const paletteList = FALLBACK_PALETTE.join(', ')
  return [
    'Use case: productivity-visual',
    'Asset type: corporate slide deck body image (16:9 wide, edge-to-edge illustration; the slide already has its own external header bar above this image)',
    '',
    `Primary request: ${userPrompt.trim()}`,
    '',
    `Style/medium: clean modern flat infographic / business diagram illustration with subtle gradients and soft shadows. ${STYLE_HINT}. **Apply this consistent aesthetic across ALL images in this deck — deck-wide invariant, do not drift between flat / 3D / photo / cartoon / line-art per page.**`,
    "Composition/framing: wide 16:9 body-only layout. The slide's own header bar with the Chinese title sits ABOVE this image, so do NOT add any title / banner / large decorative text strip inside the image itself.",
    `Color palette: anchor on these brand colors — ${paletteList}. Use these tones cohesively; do not introduce off-palette saturated colors.`,
    '',
    'Internal labels: if the diagram needs labels inside boxes / nodes / chart axes, they must be in **Chinese only** (例如「检索器」「向量库」「核心模块」), **never English**. If labels would feel forced or unnatural, omit them entirely — the slide\'s external Chinese header already provides context.',
    '',
    'Constraints: edge-to-edge body content; no outer chrome.',
    'Avoid: outer title / heading / banner / large decorative text strip; image caption / watermark / signature / logo overlay; English-only labels; photo-realistic 3D renders; cluttered text walls; cartoon mascots; comic strips; placeholder lorem ipsum.',
  ].join('\n')
}

// 真实跑出来的同款 user prompt 风格 — 业务描述,不指定形式
const USER_PROMPT =
  'A clean flat diagram illustrating the four core modules of a RAG (Retrieval-Augmented Generation) system and their relationships, suitable for a business slide.'

const SIZE = '1536x720'

// ----- 工具 -----

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function logSection(title) {
  console.log('\n' + '='.repeat(64))
  console.log(`  ${title}`)
  console.log('='.repeat(64))
}

async function saveB64(b64, label) {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const filename = `${label}-${ts()}.png`
  const p = path.join(OUT_DIR, filename)
  await fs.writeFile(p, Buffer.from(b64, 'base64'))
  return p
}

// ----- OpenAI gpt-5.5 via /v1/responses(路 A,项目主路径) -----

async function runOpenAI() {
  logSection('OpenAI gpt-5.5 — /v1/responses + image_generation tool')
  const key = process.env.OPENAI_TEST_KEY
  if (!key) {
    console.log('SKIP: OPENAI_TEST_KEY 未设置')
    return { provider: 'openai-gpt5.5', status: 'skip-no-key' }
  }
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://www.duckcoding.ai/v1').replace(
    /\/+$/,
    '',
  )
  const url = `${baseUrl}/responses`
  console.log(`POST ${url}`)
  const prompt = buildStructuredImagePrompt(USER_PROMPT)
  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.5',
        input: [{ role: 'user', content: prompt }],
        tools: [{ type: 'image_generation', size: SIZE }],
        tool_choice: { type: 'image_generation' },
      }),
    })
  } catch (err) {
    console.log(`FAIL network: ${err.message}`)
    return { provider: 'openai-gpt5.5', status: 'fail-network', error: err.message }
  }
  const ms = Date.now() - t0
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.log(`FAIL ${res.status} (${ms}ms): ${body.slice(0, 400)}`)
    return { provider: 'openai-gpt5.5', status: `fail-${res.status}`, error: body.slice(0, 400) }
  }
  const json = await res.json()
  const items = Array.isArray(json.output) ? json.output : []
  const imgItem = items.find(
    (i) => typeof i.type === 'string' && i.type.endsWith('image_generation_call'),
  )
  if (!imgItem || typeof imgItem.result !== 'string' || imgItem.result.length === 0) {
    console.log(`FAIL parse (${ms}ms): no image_generation_call.result`)
    console.log(JSON.stringify(json).slice(0, 500))
    return { provider: 'openai-gpt5.5', status: 'fail-parse' }
  }
  const saved = await saveB64(imgItem.result, 'openai-gpt5.5')
  console.log(`OK (${ms}ms) → ${saved}`)
  return { provider: 'openai-gpt5.5', status: 'ok', file: saved, ms }
}

// ----- Gemini Imagen 4 via /v1beta/.../:predict -----

async function runGeminiImagen() {
  logSection('Gemini imagen-4.0-generate-001 — /v1beta/.../predict')
  const key = process.env.GEMINI_TEST_KEY
  if (!key) {
    console.log('SKIP: GEMINI_TEST_KEY 未设置')
    return { provider: 'gemini-imagen-4', status: 'skip-no-key' }
  }
  const baseUrl = (process.env.GEMINI_BASE_URL ?? 'https://www.duckcoding.ai').replace(
    /\/+$/,
    '',
  )
  const model = 'imagen-4.0-generate-001'
  const url = `${baseUrl}/v1beta/models/${model}:predict`
  console.log(`POST ${url}`)
  const prompt = buildStructuredImagePrompt(USER_PROMPT)
  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
        // duckcoding 中转常用 Bearer; google native 看 x-goog-api-key。两个都带兼容。
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
        },
      }),
    })
  } catch (err) {
    console.log(`FAIL network: ${err.message}`)
    return { provider: 'gemini-imagen-4', status: 'fail-network', error: err.message }
  }
  const ms = Date.now() - t0
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.log(`FAIL ${res.status} (${ms}ms): ${body.slice(0, 500)}`)
    return {
      provider: 'gemini-imagen-4',
      status: `fail-${res.status}`,
      error: body.slice(0, 500),
    }
  }
  const json = await res.json()
  const b64 = json.predictions?.[0]?.bytesBase64Encoded
  if (typeof b64 !== 'string' || b64.length === 0) {
    console.log(`FAIL parse (${ms}ms): no predictions[0].bytesBase64Encoded`)
    console.log(JSON.stringify(json).slice(0, 500))
    return { provider: 'gemini-imagen-4', status: 'fail-parse' }
  }
  const saved = await saveB64(b64, 'gemini-imagen-4')
  console.log(`OK (${ms}ms) → ${saved}`)
  return { provider: 'gemini-imagen-4', status: 'ok', file: saved, ms }
}

// ----- Gemini nano-banana via /v1beta/.../:generateContent -----

async function runGeminiNanoBanana() {
  logSection('Gemini gemini-2.5-flash-image-preview "nano-banana" — /v1beta/.../generateContent')
  const key = process.env.GEMINI_TEST_KEY
  if (!key) {
    console.log('SKIP: GEMINI_TEST_KEY 未设置')
    return { provider: 'gemini-nano-banana', status: 'skip-no-key' }
  }
  const baseUrl = (process.env.GEMINI_BASE_URL ?? 'https://www.duckcoding.ai').replace(
    /\/+$/,
    '',
  )
  const model = 'gemini-2.5-flash-image-preview'
  const url = `${baseUrl}/v1beta/models/${model}:generateContent`
  console.log(`POST ${url}`)
  const prompt = buildStructuredImagePrompt(USER_PROMPT)
  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }),
    })
  } catch (err) {
    console.log(`FAIL network: ${err.message}`)
    return { provider: 'gemini-nano-banana', status: 'fail-network', error: err.message }
  }
  const ms = Date.now() - t0
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.log(`FAIL ${res.status} (${ms}ms): ${body.slice(0, 500)}`)
    return {
      provider: 'gemini-nano-banana',
      status: `fail-${res.status}`,
      error: body.slice(0, 500),
    }
  }
  const json = await res.json()
  const parts = json.candidates?.[0]?.content?.parts
  const imgPart = Array.isArray(parts) ? parts.find((p) => p.inlineData?.data) : null
  if (!imgPart) {
    console.log(`FAIL parse (${ms}ms): no candidates[0].content.parts[].inlineData.data`)
    console.log(JSON.stringify(json).slice(0, 600))
    return { provider: 'gemini-nano-banana', status: 'fail-parse' }
  }
  const saved = await saveB64(imgPart.inlineData.data, 'gemini-nano-banana')
  console.log(`OK (${ms}ms) → ${saved}`)
  return { provider: 'gemini-nano-banana', status: 'ok', file: saved, ms }
}

// ----- Claude(Anthropic)说明性 skip -----

async function runClaude() {
  logSection('Anthropic Claude — 无原生 text-to-image API')
  console.log('SKIP: 截至 2026-05 Anthropic 未发布原生图像生成端点')
  console.log('  - Claude 仅支持 vision(读图)+ Artifacts SVG/React 可视化')
  console.log('  - 泄漏的内部配置文件提示未来可能加 create_image/edit_image,尚未上线')
  console.log('  - 如需 Claude-side 图片输出: 走 MCP 接 FLUX/Stable Diffusion 第三方')
  return { provider: 'claude', status: 'skip-no-api' }
}

// ----- main -----

async function main() {
  console.log('User prompt:', JSON.stringify(USER_PROMPT))
  console.log('Size:', SIZE)
  console.log('Output dir:', OUT_DIR)
  const results = []
  results.push(await runOpenAI())
  results.push(await runGeminiImagen())
  results.push(await runGeminiNanoBanana())
  results.push(await runClaude())
  logSection('SUMMARY')
  for (const r of results) {
    const tail = r.file ?? r.error ?? ''
    console.log(`${r.provider.padEnd(22)} ${r.status.padEnd(18)} ${tail}`)
  }
  const okCount = results.filter((r) => r.status === 'ok').length
  console.log(`\n${okCount}/${results.length} provider 出图成功`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
