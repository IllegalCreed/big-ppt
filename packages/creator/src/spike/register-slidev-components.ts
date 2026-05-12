/**
 * Phase 10.5 spike Task D：把 slidev 包内的公共组件注册到 Vue app。
 *
 * 背景：Slidev 通过 unplugin-vue-components 自动注册 components/ 下的 .vue 为
 * 全局组件，layout 模板里 `<LBeitouCoverLogo />` 这类 unimported global 才能
 * 解析。creator SPA 没装 unplugin-vue-components，需要手工 app.component()。
 *
 * Spike 范围：layouts 实际只用到 4 个 private 组件；grid/block/decoration 组件
 * 是 body markdown 里出现的（如 `<TwoCol />`），spike 暂不渲染 body 内 Vue 标签，
 * 但顺手把它们也注册上，未来 Task D 接 markdown body 编译时直接复用。
 */

import type { App } from 'vue'

// 4 个 private（layout 内部）
import LBeitouCoverLogo from '@big-ppt/slidev/components/private/LBeitouCoverLogo.vue'
import LBeitouTitleBlock from '@big-ppt/slidev/components/private/LBeitouTitleBlock.vue'
import LBtHeader from '@big-ppt/slidev/components/private/LBtHeader.vue'
import LJydHeader from '@big-ppt/slidev/components/private/LJydHeader.vue'

// 6 grid
import EqualSplit from '@big-ppt/slidev/components/grid/EqualSplit.vue'
import OneVsThree from '@big-ppt/slidev/components/grid/OneVsThree.vue'
import TwoColumnsTwoRows from '@big-ppt/slidev/components/grid/TwoColumnsTwoRows.vue'
import SixGrid from '@big-ppt/slidev/components/grid/SixGrid.vue'
import NineGrid from '@big-ppt/slidev/components/grid/NineGrid.vue'
import ImageText from '@big-ppt/slidev/components/grid/ImageText.vue'

// 2 decoration
import PetalFour from '@big-ppt/slidev/components/decoration/PetalFour.vue'
import ProcessFlow from '@big-ppt/slidev/components/decoration/ProcessFlow.vue'

// 6 block
import MetricCard from '@big-ppt/slidev/components/block/MetricCard.vue'
import Table from '@big-ppt/slidev/components/block/Table.vue'
import Quote from '@big-ppt/slidev/components/block/Quote.vue'
import BarChart from '@big-ppt/slidev/components/block/BarChart.vue'
import LineChart from '@big-ppt/slidev/components/block/LineChart.vue'
import PieChart from '@big-ppt/slidev/components/block/PieChart.vue'

export function registerSlidevComponents(app: App): void {
  const components = {
    LBeitouCoverLogo,
    LBeitouTitleBlock,
    LBtHeader,
    LJydHeader,
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
  for (const [name, component] of Object.entries(components)) {
    app.component(name, component)
  }
}
