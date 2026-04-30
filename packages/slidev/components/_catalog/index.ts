/**
 * 公共组件 prompt catalog 聚合器。
 *
 * 静态 import 各组件目录的 .meta.ts 文件,统一暴露给 agent 拼 system prompt。
 * 加新组件流程:
 *   1. 在 components/{category}/{Name}.vue 加实现
 *   2. 在同目录加 {Name}.meta.ts 写 prompt 元数据(用 ComponentEntry 类型)
 *   3. 在本文件下方 import + push 到 commonComponentsCatalog
 */
export type { ComponentCategory, ComponentEntry } from './types.js'

import type { ComponentEntry } from './types.js'

// ── 栅格类 grid (6) ─────────────────────────────────────────────
// Phase 11.6 起 OneLeftThreeRight + OneRightThreeLeft 合并为 OneVsThree(direction)
// Phase 11.7 起 TwoCol + ThreeCol 合并为 EqualSplit(count + direction)
import { meta as EqualSplitMeta } from '../grid/EqualSplit.meta.js'
import { meta as OneVsThreeMeta } from '../grid/OneVsThree.meta.js'
import { meta as OneTopThreeBottomMeta } from '../grid/OneTopThreeBottom.meta.js'
import { meta as TwoColumnsTwoRowsMeta } from '../grid/TwoColumnsTwoRows.meta.js'
import { meta as NineGridMeta } from '../grid/NineGrid.meta.js'
import { meta as ImageTextMeta } from '../grid/ImageText.meta.js'

// ── 装饰类 decoration (2) ───────────────────────────────────────
import { meta as PetalFourMeta } from '../decoration/PetalFour.meta.js'
import { meta as ProcessFlowMeta } from '../decoration/ProcessFlow.meta.js'

// ── 内容块类 block (6) ──────────────────────────────────────────
import { meta as MetricCardMeta } from '../block/MetricCard.meta.js'
import { meta as TableMeta } from '../block/Table.meta.js'
import { meta as QuoteMeta } from '../block/Quote.meta.js'
import { meta as BarChartMeta } from '../block/BarChart.meta.js'
import { meta as LineChartMeta } from '../block/LineChart.meta.js'
import { meta as PieChartMeta } from '../block/PieChart.meta.js'

export const commonComponentsCatalog: ComponentEntry[] = [
  // grid
  EqualSplitMeta,
  OneVsThreeMeta,
  OneTopThreeBottomMeta,
  TwoColumnsTwoRowsMeta,
  NineGridMeta,
  ImageTextMeta,
  // decoration
  PetalFourMeta,
  ProcessFlowMeta,
  // block
  MetricCardMeta,
  TableMeta,
  QuoteMeta,
  BarChartMeta,
  LineChartMeta,
  PieChartMeta,
]

/** 所有合法组件名集合(用于 manifest commonComponents 字段值校验) */
export const ALL_COMPONENT_NAMES: string[] = commonComponentsCatalog.map((c) => c.name)

/** 按分类分组返回,已过滤到只含 allowedNames 中的项;保留 catalog 顺序 */
export function getCatalogByCategory(allowedNames: readonly string[]): {
  grid: ComponentEntry[]
  decoration: ComponentEntry[]
  block: ComponentEntry[]
} {
  const allowed = new Set(allowedNames)
  const filtered = commonComponentsCatalog.filter((c) => allowed.has(c.name))
  return {
    grid: filtered.filter((c) => c.category === 'grid'),
    decoration: filtered.filter((c) => c.category === 'decoration'),
    block: filtered.filter((c) => c.category === 'block'),
  }
}
