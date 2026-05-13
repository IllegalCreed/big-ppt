#!/usr/bin/env node
// Usage: pnpm -F @big-ppt/agent probe:duckcoding
//        （或 node scripts/probe-duckcoding.mjs，需自行加载 .env.test.local）
//
// 目的：探测 duckcoding.ai 中转是否支持 Anthropic / Gemini native 协议端点
//      —— 决定 Phase 12 smoke test 走 native 还是 OpenAI-兼容 fallback。
//
// 读 ANTHROPIC_TEST_KEY / GEMINI_TEST_KEY / OPENAI_TEST_KEY
// + DUCKCODING_TEST_BASE_URL（默认 https://www.duckcoding.ai）
// 三个端点 curl 一遍，输出 markdown 报告（stdout）。

const baseUrl = process.env.DUCKCODING_TEST_BASE_URL ?? 'https://www.duckcoding.ai'
const anthropicKey = process.env.ANTHROPIC_TEST_KEY
const geminiKey = process.env.GEMINI_TEST_KEY
const openaiKey = process.env.OPENAI_TEST_KEY

async function probe(name, fn) {
  try {
    const r = await fn()
    console.log(`- ${name}: ✅ ${r.status} ${r.statusText}`)
    if (r.body) console.log(`  body sample: ${(await r.text()).slice(0, 200)}`)
  } catch (e) {
    console.log(`- ${name}: ❌ ${e.message}`)
  }
}

await probe('OpenAI /v1/chat/completions', () =>
  fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
  }))

await probe('Anthropic /v1/messages', () =>
  fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
  }))

await probe('Gemini /v1beta/models/gemini-2.5-flash:generateContent', () =>
  fetch(`${baseUrl}/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
  }))
