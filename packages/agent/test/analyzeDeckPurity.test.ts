import { describe, expect, it } from 'vitest'
import { analyzeDeckPurity } from '../src/templates/analyzeDeckPurity.js'

describe('analyzeDeckPurity', () => {
  it('空 deck → pure / level 1', () => {
    const result = analyzeDeckPurity('')
    expect(result.pure).toBe(true)
    expect(result.level).toBe(1)
    expect(result.chunkLevels).toEqual([])
  })

  it('档 1：纯 markdown + layer-1 layout → pure / level 1', () => {
    const content = `---
layout: beitou-cover
mainTitle: 标题
---

---
layout: beitou-content
heading: 概览
---

正文文字
- 要点 A
- 要点 B
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(true)
    expect(result.level).toBe(1)
  })

  it('档 3：含公共栅格 + 内容块组件 → pure / level 3', () => {
    const content = `---
layout: jingyeda-content
heading: Q1 指标
---

<TwoCol left-title="旧" right-title="新">
  <template #left>
    <MetricCard value="89" unit="%" label="留存率" />
  </template>
  <template #right>
    <BarChart :labels='["Q1","Q2"]' :values='[10,20]' />
  </template>
</TwoCol>
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(true)
    expect(result.level).toBe(3)
  })

  it('档 4：含 chart.js 现场代码 → not-pure / level 4', () => {
    const content = `---
layout: beitou-content
heading: 数据
---

<div ref="chartEl"></div>

new Chart(ctx, { type: 'pie' })
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(4)
    expect(result.reasons.some((r) => r.includes('chart.js'))).toBe(true)
  })

  it('档 5：含 <script setup> → not-pure / level 5', () => {
    const content = `---
layout: beitou-content
heading: 自定义
---

<script setup>
import { ref } from 'vue'
const count = ref(0)
</script>

<button @click="count++">{{ count }}</button>
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(5)
    expect(result.reasons.some((r) => r.includes('<script setup>'))).toBe(true)
  })

  it('档 5：layout 字段不在 layer-1 名单（遗留旧 layout）→ not-pure / level 5', () => {
    const content = `---
layout: beitou-data
heading: 旧
metrics:
  - { value: "100", label: "X" }
---
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(5)
    expect(result.reasons.some((r) => r.includes('beitou-data'))).toBe(true)
  })

  it('档 5：模板私有组件 LBeitouTitleBlock 出现在 deck content → not-pure', () => {
    const content = `---
layout: beitou-content
heading: 异常
---

<LBeitouTitleBlock>这不该出现在 deck</LBeitouTitleBlock>
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(5)
    expect(result.reasons.some((r) => r.includes('LBeitouTitleBlock'))).toBe(true)
  })

  it('档 5：未知 PascalCase 组件标签（自定义）→ not-pure', () => {
    const content = `---
layout: beitou-content
heading: 自定义
---

<MyCustomWidget value="x" />
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(5)
  })

  it('档 5：style 含 hardcode 颜色（应用 token） → not-pure', () => {
    const content = `---
layout: beitou-content
heading: 样式
---

<div style="color: #ff0000; font-size: 20px">硬编码红</div>
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(5)
    expect(result.reasons.some((r) => r.includes('hardcode 颜色'))).toBe(true)
  })

  it('档 2：内联 HTML + style 用 var(--ld-*) → pure / level 2', () => {
    const content = `---
layout: beitou-content
heading: 提示
---

<div style="color: var(--ld-color-brand-primary); font-weight: var(--ld-font-weight-bold)">
  重点提示
</div>
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(true)
    expect(result.level).toBe(2)
  })

  it('多页混合：含一页档 5 → 整 deck not-pure / level 5', () => {
    const content = `---
layout: beitou-cover
mainTitle: 标题
---

---
layout: beitou-content
heading: 普通页
---

<MetricCard value="89" unit="%" label="留存" />

---
layout: beitou-content
heading: 自定义页
---

<script setup>
const x = 1
</script>
`
    const result = analyzeDeckPurity(content)
    expect(result.pure).toBe(false)
    expect(result.level).toBe(5)
    // chunkLevels 数组按 chunk 切片粒度（不严格等于页数；含含 frontmatter 块）
    expect(result.chunkLevels.includes(5)).toBe(true)
    expect(result.chunkLevels.includes(3)).toBe(true)
  })
})
