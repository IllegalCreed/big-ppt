/**
 * Phase 7.5D-2：公共组件 catalog（栅格 / 装饰 / 内容块），供 buildSystemPrompt
 * 拼装"## 可用 Components"段使用。
 *
 * 列在此处的组件名必须与 packages/slidev/components/ 下的 .vue 实现一致；
 * AI 在 markdown body 里写组件标签，由 Slidev 自动解析（无需在 frontmatter
 * 声明）。
 *
 * **未来扩展**：组件库扩到 25+ 个时，本 catalog 会切到 lazy-load 模式（详
 * 见 99-tech-debt P3-12）：精简版 catalog（name + 1 行职责）驻留 system
 * prompt，详细 props / 示例移到 get_component_doc tool 按需查。
 */

export type ComponentCategory = 'grid' | 'decoration' | 'block'

export interface ComponentEntry {
  /** Vue 组件名（PascalCase） */
  name: string
  /** 分类，决定 prompt 拼装时进哪个 sub-section */
  category: ComponentCategory
  /** 一句话职责 */
  description: string
  /** 一行 props / slots 概要 */
  propsOrSlots: string
  /** 一行最小用法示例（markdown 内） */
  example: string
}

export const commonComponentsCatalog: ComponentEntry[] = [
  // ── 栅格类 grid（8） ─────────────────────────────────────────────
  {
    name: 'TwoCol',
    category: 'grid',
    description: '两栏对比 50/50；中间可选分隔条',
    propsOrSlots: 'leftTitle? / rightTitle? / divider?: "on"|"off"; slots: #left / #right',
    example:
      '<TwoCol left-title="旧" right-title="新"><template #left>A</template><template #right>B</template></TwoCol>',
  },
  {
    name: 'ThreeCol',
    category: 'grid',
    description: '三列均分，中间常放装饰组件、左右放文字',
    propsOrSlots: 'cols?: string (CSS grid-template-columns); slots: #left / #center / #right',
    example: '<ThreeCol><template #left>...</template><template #center>...</template></ThreeCol>',
  },
  {
    name: 'OneLeftThreeRight',
    category: 'grid',
    description: '左主右从（左 1 主 + 右 3 列），适合"主标题 + 3 要点"',
    propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
    example:
      '<OneLeftThreeRight><template #main>主</template><template #item1>1</template>...</OneLeftThreeRight>',
  },
  {
    name: 'OneRightThreeLeft',
    category: 'grid',
    description: '右主左从，OneLeftThreeRight 镜像版',
    propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
    example:
      '<OneRightThreeLeft><template #main>主</template><template #item1>1</template>...</OneRightThreeLeft>',
  },
  {
    name: 'OneTopThreeBottom',
    category: 'grid',
    description: '上主下从（上 1 主 + 下 3 等列），适合"主题句 + 3 阶段"',
    propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
    example:
      '<OneTopThreeBottom><template #main>主</template><template #item1>1</template>...</OneTopThreeBottom>',
  },
  {
    name: 'TwoColumnsTwoRows',
    category: 'grid',
    description: '田字格 2×2，4 个等大单元；适合 4 维度对比 / 4 季度数据',
    propsOrSlots: 'slots: #slot1 / #slot2 / #slot3 / #slot4',
    example:
      '<TwoColumnsTwoRows><template #slot1>A</template><template #slot2>B</template><template #slot3>C</template><template #slot4>D</template></TwoColumnsTwoRows>',
  },
  {
    name: 'NineGrid',
    category: 'grid',
    description: '九宫格 3×3；slot 仅放短文字 / 单 metric / 单图标，避免 chart 撑爆',
    propsOrSlots: 'slots: #slot1..#slot9',
    example:
      '<NineGrid><template #slot1>A</template><template #slot2>B</template>...<template #slot9>I</template></NineGrid>',
  },
  {
    name: 'ImageText',
    category: 'grid',
    description: '图文 45/55，可切左右；image prop 必填',
    propsOrSlots:
      'image: string / alt? / imageBorder?: "none"|"thin"|"thick" / direction?: "image-left"|"image-right"; slots: #text',
    example:
      '<ImageText image="/templates/X/y.png" direction="image-right"><template #text>说明</template></ImageText>',
  },

  // ── 装饰类 decoration（2 种子） ─────────────────────────────────
  {
    name: 'PetalFour',
    category: 'decoration',
    description: '花瓣 4 区中央对称排列；4 小节方阵展示（设计/开发/测试/文档）',
    propsOrSlots:
      'borderWidth?: "thin"|"thick"; slots: #slot1 / #slot2 / #slot3 / #slot4（上/右/下/左）',
    example:
      '<PetalFour><template #slot1>1</template><template #slot2>2</template><template #slot3>3</template><template #slot4>4</template></PetalFour>',
  },
  {
    name: 'ProcessFlow',
    category: 'decoration',
    description: 'N 步流程箭头横排连接；阶段流程 / 工作流',
    propsOrSlots: 'cols?: number (1-6, 默认 3); slots: #step1..#step6',
    example:
      '<ProcessFlow :cols="4"><template #step1>需求</template><template #step2>设计</template>...<template #step4>上线</template></ProcessFlow>',
  },

  // ── 内容块类 block（6） ─────────────────────────────────────────
  {
    name: 'MetricCard',
    category: 'block',
    description: '单数字卡（value + unit + label），3 种 variant',
    propsOrSlots: 'value: string|number / unit? / label / variant?: "fill"|"subtle"|"outline"',
    example: '<MetricCard value="89" unit="%" label="客户留存率" />',
  },
  {
    name: 'KVList',
    category: 'block',
    description: '键值对列表（label : value），columns 控制几列',
    propsOrSlots: 'items: Array<{label, value}> / columns?: number(默认 2)',
    example: `<KVList :items='[{"label":"部门","value":"研发部"},{"label":"负责人","value":"张三"}]' />`,
  },
  {
    name: 'Quote',
    category: 'block',
    description: '引文左侧粗竖线 + 可选 author / cite',
    propsOrSlots: 'author? / cite?; default slot = 引文文字',
    example: '<Quote author="张三" cite="《白皮书》">关键观点文字。</Quote>',
  },
  {
    name: 'Callout',
    category: 'block',
    description: '高亮信息块，3 种 type（info/warning/success）',
    propsOrSlots: 'type?: "info"|"warning"|"success" / title?; default slot = 正文',
    example: '<Callout type="warning" title="注意">部署前必须备份。</Callout>',
  },
  {
    name: 'BarChart',
    category: 'block',
    description: '柱状图，数据可视化必选；颜色读 ld-chart token',
    propsOrSlots: 'labels: string[] / values: number[] / label? / height?: number',
    example: `<BarChart :labels='["Q1","Q2","Q3","Q4"]' :values='[120,180,150,210]' label="季度营收" />`,
  },
  {
    name: 'LineChart',
    category: 'block',
    description: '折线图（带填充），接口同 BarChart',
    propsOrSlots: 'labels: string[] / values: number[] / label? / height?: number',
    example: `<LineChart :labels='["1月","2月","3月"]' :values='[10,28,55]' label="月活" />`,
  },
]

/** 所有合法组件名集合（用于 manifest commonComponents 字段值校验） */
export const ALL_COMPONENT_NAMES: string[] = commonComponentsCatalog.map((c) => c.name)

/** 按分类分组返回，已过滤到只含 allowedNames 中的项；保留 catalog 顺序 */
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
