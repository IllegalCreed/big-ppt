/**
 * Phase 10.5：把 layouts + 公共组件全部注册成全局 Vue 组件。
 *
 * 为什么必须手工 app.component()：
 *   - DeckRenderer 用 `<component :is="slide.layout">` 动态查找 layout（kebab 字符串）
 *   - body markdown 编译出的 render 函数里包含 `<TwoCol>` 等 Vue 标签，运行时
 *     按 PascalCase 找全局组件
 *   unplugin-vue-components 只在编译期扫描 .vue 模板的字面量标签把组件按需
 *   import 进来；对「动态 :is 字符串」「runtime 编译出的标签」都看不见 →
 *   不会被打包 + 没注册到 app.component() → 渲染空白。
 *
 * 解法：DeckRenderer 使用面经过的所有动态组件全部静态 import + app.component()。
 * unplugin-vue-components 仍保留，处理 layouts 内部的 `<LBeitouCoverLogo />`
 * 这种字面量标签（layouts 自身 .vue 模板里的引用，编译期能扫到）。
 *
 * 加新组件流程（同 slidev 包内的 _catalog/index.ts）：
 *   1. components/{cat}/Foo.vue + Foo.meta.ts 在 slidev 包
 *   2. 本文件 import + 加进 commonComponents
 */
import type { App } from 'vue'

// ── layouts (DeckRenderer 用 <component :is> 解析) ──────────────────
import BeitouCover from '@big-ppt/slidev/layouts/beitou/beitou-cover.vue'
import BeitouContent from '@big-ppt/slidev/layouts/beitou/beitou-content.vue'
import BeitouToc from '@big-ppt/slidev/layouts/beitou/beitou-toc.vue'
import BeitouSectionTitle from '@big-ppt/slidev/layouts/beitou/beitou-section-title.vue'
import BeitouBackCover from '@big-ppt/slidev/layouts/beitou/beitou-back-cover.vue'
import BeitouImageContent from '@big-ppt/slidev/layouts/beitou/beitou-image-content.vue'

import JingyedaCover from '@big-ppt/slidev/layouts/jingyeda/jingyeda-cover.vue'
import JingyedaContent from '@big-ppt/slidev/layouts/jingyeda/jingyeda-content.vue'
import JingyedaToc from '@big-ppt/slidev/layouts/jingyeda/jingyeda-toc.vue'
import JingyedaSectionTitle from '@big-ppt/slidev/layouts/jingyeda/jingyeda-section-title.vue'
import JingyedaBackCover from '@big-ppt/slidev/layouts/jingyeda/jingyeda-back-cover.vue'
import JingyedaImageContent from '@big-ppt/slidev/layouts/jingyeda/jingyeda-image-content.vue'

// ── grid (body markdown 里出现) ─────────────────────────────────────
import EqualSplit from '@big-ppt/slidev/components/grid/EqualSplit.vue'
import OneVsThree from '@big-ppt/slidev/components/grid/OneVsThree.vue'
import TwoColumnsTwoRows from '@big-ppt/slidev/components/grid/TwoColumnsTwoRows.vue'
import SixGrid from '@big-ppt/slidev/components/grid/SixGrid.vue'
import NineGrid from '@big-ppt/slidev/components/grid/NineGrid.vue'
import ImageText from '@big-ppt/slidev/components/grid/ImageText.vue'

// ── decoration ─────────────────────────────────────────────────────
import PetalFour from '@big-ppt/slidev/components/decoration/PetalFour.vue'
import ProcessFlow from '@big-ppt/slidev/components/decoration/ProcessFlow.vue'

// ── block ──────────────────────────────────────────────────────────
import MetricCard from '@big-ppt/slidev/components/block/MetricCard.vue'
import Table from '@big-ppt/slidev/components/block/Table.vue'
import Quote from '@big-ppt/slidev/components/block/Quote.vue'
import BarChart from '@big-ppt/slidev/components/block/BarChart.vue'
import LineChart from '@big-ppt/slidev/components/block/LineChart.vue'
import PieChart from '@big-ppt/slidev/components/block/PieChart.vue'

/**
 * Layouts key 用 kebab-case（跟 frontmatter `layout:` 字段一致）；
 * Vue 内部 PascalCase 兜底匹配，一条 kebab 注册就够。
 *
 * Common components key 用 PascalCase（跟 body markdown 里 `<TwoCol>` 写法一致）；
 * Vue 同样会做 kebab/PascalCase 兜底，但 prompt 里都是 PascalCase，对齐为主。
 */
const layouts = {
  'beitou-cover': BeitouCover,
  'beitou-content': BeitouContent,
  'beitou-toc': BeitouToc,
  'beitou-section-title': BeitouSectionTitle,
  'beitou-back-cover': BeitouBackCover,
  'beitou-image-content': BeitouImageContent,
  'jingyeda-cover': JingyedaCover,
  'jingyeda-content': JingyedaContent,
  'jingyeda-toc': JingyedaToc,
  'jingyeda-section-title': JingyedaSectionTitle,
  'jingyeda-back-cover': JingyedaBackCover,
  'jingyeda-image-content': JingyedaImageContent,
} as const

const commonComponents = {
  EqualSplit,
  OneVsThree,
  TwoColumnsTwoRows,
  SixGrid,
  NineGrid,
  ImageText,
  PetalFour,
  ProcessFlow,
  MetricCard,
  Table,
  Quote,
  BarChart,
  LineChart,
  PieChart,
} as const

export function registerDeckRendererComponents(app: App): void {
  for (const [name, component] of Object.entries(layouts)) {
    app.component(name, component)
  }
  for (const [name, component] of Object.entries(commonComponents)) {
    app.component(name, component)
  }
}
