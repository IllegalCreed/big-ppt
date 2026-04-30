/**
 * Phase 11.6：rewriteSinglePageToComponents 模块单测。
 *
 * 单元层覆盖:
 * - skeleton 模式(BIG_PPT_TEST_REWRITE_MODE=skeleton)直接返回 fallback 页,不发 LLM 请求
 * - 输出能 parse 成 frontmatter + body(给 worker 用 update_slide)
 * - 模块对外暴露 RewriteSinglePageFn 接口(供 worker DI 注入)
 *
 * 真 LLM 路径(fetch / acquireLlmSlot)由 image-gen-job-fallback.test.ts 通过 mock 覆盖。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  rewriteSinglePageToComponents,
  type RewriteSinglePageFn,
  type RewriteSinglePageInput,
  type RewriteSinglePageOutput,
} from '../src/prompts/rewriteSinglePageToComponents.js'

const BASE_INPUT: RewriteSinglePageInput = {
  currentSlidesContent: `---
layout: beitou-cover
mainTitle: 测
---

---
layout: beitou-image-content
heading: 系统架构
---

`,
  slideIndex: 2,
  heading: '系统架构',
  fallbackSummary: '列举 RAG 系统的 4 个核心模块及作用',
  templateId: 'beitou-standard',
  userId: 1,
}

describe('rewriteSinglePageToComponents（skeleton 模式）', () => {
  let prevMode: string | undefined

  beforeEach(() => {
    prevMode = process.env.BIG_PPT_TEST_REWRITE_MODE
    process.env.BIG_PPT_TEST_REWRITE_MODE = 'skeleton'
  })

  afterEach(() => {
    if (prevMode === undefined) delete process.env.BIG_PPT_TEST_REWRITE_MODE
    else process.env.BIG_PPT_TEST_REWRITE_MODE = prevMode
  })

  it('skeleton 模式返回 frontmatter + body,跳真 LLM', async () => {
    const result = await rewriteSinglePageToComponents(BASE_INPUT)
    expect(result.frontmatter).toBeDefined()
    expect(typeof result.body).toBe('string')
    expect(result.frontmatter.layout).toMatch(/-content$/)
    expect(result.frontmatter.heading).toBe('系统架构')
    // body 应包含 fallbackSummary 的中文
    expect(result.body).toContain('列举')
  })

  it('skeleton:heading 缺失时给 fallback 标题,不抛错', async () => {
    const result = await rewriteSinglePageToComponents({
      ...BASE_INPUT,
      heading: undefined,
    })
    expect(typeof result.frontmatter.heading).toBe('string')
    expect((result.frontmatter.heading as string).length).toBeGreaterThan(0)
  })

  it('skeleton:fallbackSummary 缺失时也能输出有效页', async () => {
    const result = await rewriteSinglePageToComponents({
      ...BASE_INPUT,
      fallbackSummary: undefined,
    })
    expect(result.frontmatter.layout).toMatch(/-content$/)
    expect(typeof result.body).toBe('string')
  })

  it('rawPageMarkdown 字段含输出原文（用于审计/调试）', async () => {
    const result = await rewriteSinglePageToComponents(BASE_INPUT)
    expect(result.rawPageMarkdown).toContain('---')
    expect(result.rawPageMarkdown).toContain('layout:')
  })
})

describe('rewriteSinglePageToComponents（DI seam 类型契约）', () => {
  it('rewriteSinglePageToComponents 满足 RewriteSinglePageFn 接口（可作为 DI 注入）', async () => {
    // 静态类型断言:能赋值即说明接口契约成立
    const fn: RewriteSinglePageFn = rewriteSinglePageToComponents
    expect(typeof fn).toBe('function')
  })

  it('mock RewriteSinglePageFn 可替换默认实现（worker DI seam 验证）', async () => {
    const mockOutput: RewriteSinglePageOutput = {
      frontmatter: { layout: 'beitou-content', heading: 'mock' },
      body: 'mock body',
      rawPageMarkdown: '---\nlayout: beitou-content\nheading: mock\n---\n\nmock body',
    }
    const mockFn: RewriteSinglePageFn = async () => mockOutput
    const result = await mockFn(BASE_INPUT)
    expect(result.frontmatter.heading).toBe('mock')
    expect(result.body).toBe('mock body')
  })
})
