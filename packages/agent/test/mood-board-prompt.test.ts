/**
 * Phase 11.8 Task B-1: mood-board/prompt.ts 纯函数单测。
 * 不依赖 DB / network,covers system prompt 锁 + outline 截取 + JSON parse + diversity 算法。
 */
import { describe, expect, it } from 'vitest'
import {
  MOOD_BOARD_SYSTEM_PROMPT,
  buildRetrySystemPrompt,
  extractDeckOutlineForPrompt,
  OUTLINE_MAX_BYTES,
  parseMoodBoardLlmResponse,
  MoodBoardParseError,
  assessStyleDiversity,
  STYLE_SIMILARITY_RETRY_THRESHOLD,
} from '../src/mood-board/prompt.js'

describe('MOOD_BOARD_SYSTEM_PROMPT', () => {
  it('含 3 条 / CLEARLY DIFFERENT / 严格 JSON 三个核心约束(防未来误改弱化)', () => {
    expect(MOOD_BOARD_SYSTEM_PROMPT).toMatch(/3 different image prompts/)
    expect(MOOD_BOARD_SYSTEM_PROMPT).toMatch(/CLEARLY DIFFERENT visual style/)
    expect(MOOD_BOARD_SYSTEM_PROMPT).toMatch(/STRICT JSON/i)
    expect(MOOD_BOARD_SYSTEM_PROMPT).toMatch(/no markdown fence/)
    expect(MOOD_BOARD_SYSTEM_PROMPT).toMatch(/"samples":/)
  })

  it('不喂模板色板 hint(plan 32 抉择 7:让用户挑调性不被锁死)', () => {
    expect(MOOD_BOARD_SYSTEM_PROMPT.toLowerCase()).not.toMatch(/palette|color hex|#[0-9a-f]{6}/)
  })
})

describe('buildRetrySystemPrompt', () => {
  it('包含前一轮的 style label + 差异化加强指令', () => {
    const prev = ['flat infographic', 'flat geometric', 'flat illustration']
    const retry = buildRetrySystemPrompt(prev)
    expect(retry).toContain('PREVIOUS ATTEMPT')
    expect(retry).toContain('"flat infographic"')
    expect(retry).toContain('"flat geometric"')
    expect(retry).toContain('"flat illustration"')
    expect(retry).toMatch(/genuinely distinct/)
    // 继承原 system prompt 核心约束
    expect(retry).toContain('STRICT JSON')
  })
})

describe('extractDeckOutlineForPrompt', () => {
  it('短内容直接返(不截断)', () => {
    const md = '---\nlayout: cover\n---\n\n# 测试 deck'
    expect(extractDeckOutlineForPrompt(md)).toBe(md)
  })

  it('空字符串返空,不抛错', () => {
    expect(extractDeckOutlineForPrompt('')).toBe('')
  })

  it('超长内容截到 ≤ OUTLINE_MAX_BYTES,并附 (...deck truncated...) 标记', () => {
    // 构造 10KB 内容(确保超阈值)
    const longPage = `---\nlayout: content\nheading: Page\n---\n\n${'word '.repeat(500)}\n\n`
    const md = longPage.repeat(20)
    const out = extractDeckOutlineForPrompt(md)
    expect(Buffer.byteLength(out, 'utf-8')).toBeLessThanOrEqual(OUTLINE_MAX_BYTES + 100) // 含尾标记
    expect(out).toMatch(/deck truncated for prompt brevity/)
  })

  it('截断时尽量落到段落边界 \\n---\\n 或 \\n\\n', () => {
    const sections: string[] = []
    for (let i = 0; i < 40; i++) {
      sections.push(`---\nlayout: c\nheading: Page ${i}\n---\n\nbody ${i}`)
    }
    const md = sections.join('\n\n')
    const out = extractDeckOutlineForPrompt(md)
    // 截断后不应在某行的中间结束(应该以 page body 或 frontmatter 边界为止)
    const truncatedPart = out.replace(/\n\n\(\.\.\.deck truncated for prompt brevity\)$/, '')
    expect(truncatedPart.endsWith('\n') || truncatedPart.length === md.length).toBe(true)
  })
})

describe('parseMoodBoardLlmResponse', () => {
  const validJson = JSON.stringify({
    samples: [
      { style: 'isometric tech', prompt: 'An isometric tech illustration of...' },
      { style: 'hand-drawn doodle', prompt: 'A hand-drawn doodle showing...' },
      { style: 'watercolor wash', prompt: 'A soft watercolor painting...' },
    ],
  })

  it('合法 JSON → 解析出 3 个 sample', () => {
    const out = parseMoodBoardLlmResponse(validJson)
    expect(out.samples).toHaveLength(3)
    expect(out.samples[0]!.style).toBe('isometric tech')
    expect(out.samples[2]!.prompt).toBe('A soft watercolor painting...')
  })

  it('去掉 ```json fence', () => {
    const fenced = `\`\`\`json\n${validJson}\n\`\`\``
    const out = parseMoodBoardLlmResponse(fenced)
    expect(out.samples).toHaveLength(3)
  })

  it('去掉 ``` fence(无 json 标识)', () => {
    const fenced = `\`\`\`\n${validJson}\n\`\`\``
    const out = parseMoodBoardLlmResponse(fenced)
    expect(out.samples).toHaveLength(3)
  })

  it('两端含空白 → trim 后解析', () => {
    const out = parseMoodBoardLlmResponse(`  \n${validJson}\n  `)
    expect(out.samples).toHaveLength(3)
  })

  it('非法 JSON → MoodBoardParseError', () => {
    expect(() => parseMoodBoardLlmResponse('not json')).toThrow(MoodBoardParseError)
    expect(() => parseMoodBoardLlmResponse('not json')).toThrow(/不是合法 JSON/)
  })

  it('顶层不是 object(数组 / 字符串) → MoodBoardParseError', () => {
    expect(() => parseMoodBoardLlmResponse('["a", "b"]')).toThrow(MoodBoardParseError)
    expect(() => parseMoodBoardLlmResponse('"just a string"')).toThrow(MoodBoardParseError)
  })

  it('缺 samples 数组 → 错', () => {
    expect(() => parseMoodBoardLlmResponse('{}')).toThrow(/缺少 samples 数组/)
    expect(() => parseMoodBoardLlmResponse('{"samples": "not array"}')).toThrow(/缺少 samples 数组/)
  })

  it('samples 长度 ≠ 3 → 错', () => {
    const bad = JSON.stringify({
      samples: [
        { style: 'a', prompt: 'a' },
        { style: 'b', prompt: 'b' },
      ],
    })
    expect(() => parseMoodBoardLlmResponse(bad)).toThrow(/长度必须是 3/)
  })

  it('samples[i].style 或 prompt 为空 → 错', () => {
    const empty = JSON.stringify({
      samples: [
        { style: '', prompt: 'p' },
        { style: 's', prompt: 'p' },
        { style: 's', prompt: 'p' },
      ],
    })
    expect(() => parseMoodBoardLlmResponse(empty)).toThrow(/style 非空字符串/)
    const noPrompt = JSON.stringify({
      samples: [
        { style: 's', prompt: '' },
        { style: 's', prompt: 'p' },
        { style: 's', prompt: 'p' },
      ],
    })
    expect(() => parseMoodBoardLlmResponse(noPrompt)).toThrow(/prompt 非空字符串/)
  })

  it('解析后 style / prompt 被 trim', () => {
    const padded = JSON.stringify({
      samples: [
        { style: '  isometric  ', prompt: '  prompt 1  ' },
        { style: 'doodle', prompt: 'prompt 2' },
        { style: 'watercolor', prompt: 'prompt 3' },
      ],
    })
    const out = parseMoodBoardLlmResponse(padded)
    expect(out.samples[0]!.style).toBe('isometric')
    expect(out.samples[0]!.prompt).toBe('prompt 1')
  })
})

describe('assessStyleDiversity (Jaccard token-based)', () => {
  it('3 个完全不同 token 的 style → Jaccard = 0', () => {
    const sim = assessStyleDiversity([
      { style: 'isometric tech' },
      { style: 'watercolor wash' },
      { style: 'cyberpunk neon' },
    ])
    expect(sim).toBe(0)
  })

  it('3 个完全相同的 style → 1', () => {
    const sim = assessStyleDiversity([
      { style: 'flat infographic' },
      { style: 'flat infographic' },
      { style: 'flat infographic' },
    ])
    expect(sim).toBeCloseTo(1, 2)
  })

  it('3 个共享"flat"的 style → Jaccard 1/3=0.33 → 高于阈值 0.3 触发 retry', () => {
    const sim = assessStyleDiversity([
      { style: 'flat infographic' },
      { style: 'flat geometric' },
      { style: 'flat illustration' },
    ])
    // pairwise: {flat,a}∩{flat,b}=1, union=3, jaccard=1/3 ≈ 0.333
    expect(sim).toBeCloseTo(1 / 3, 2)
    expect(sim).toBeGreaterThanOrEqual(STYLE_SIMILARITY_RETRY_THRESHOLD)
  })

  it('部分共享 token:1 对共享 flat,其它两对不共享 → 平均 ≈ 0.11 低于阈值放行', () => {
    // pairwise:
    //   flat infographic vs flat geometric → {flat} / {flat,infographic,geometric} = 1/3
    //   flat infographic vs isometric tech → 0
    //   flat geometric vs isometric tech → 0
    // avg = (1/3 + 0 + 0) / 3 ≈ 0.111
    const sim = assessStyleDiversity([
      { style: 'flat infographic' },
      { style: 'flat geometric' },
      { style: 'isometric tech' },
    ])
    expect(sim).toBeCloseTo(1 / 9, 2)
    expect(sim).toBeLessThan(STYLE_SIMILARITY_RETRY_THRESHOLD)
  })

  it('大小写不敏感(toLowerCase 归一化)', () => {
    const upper = assessStyleDiversity([
      { style: 'ISOMETRIC' },
      { style: 'isometric' },
      { style: 'Isometric' },
    ])
    expect(upper).toBeCloseTo(1, 2)
  })

  it('连字符 / 空格作分隔符等价(tokenize 多分隔符)', () => {
    const sim = assessStyleDiversity([
      { style: 'hand-drawn doodle' },
      { style: 'hand drawn doodle' },
      { style: 'hand_drawn_doodle' },
    ])
    // 全 3 个 label tokenize 后都是 {hand, drawn, doodle},完全相同
    expect(sim).toBeCloseTo(1, 2)
  })

  it('单条 / 空数组 → 返 0(no pairs)', () => {
    expect(assessStyleDiversity([])).toBe(0)
    expect(assessStyleDiversity([{ style: 'lonely' }])).toBe(0)
  })

  it('阈值常量导出且 = 0.3(plan 32 抉择 1 实施期偏离,Jaccard 后下调)', () => {
    expect(STYLE_SIMILARITY_RETRY_THRESHOLD).toBe(0.3)
  })
})
