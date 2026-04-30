/**
 * 公共组件 prompt catalog 的类型定义。
 *
 * 设计动机:模板的 prompt 元数据已经在 packages/slidev/templates 各模板的 manifest.json
 * 跟模板同包,但组件的 prompt 元数据原先在 packages/agent 里 —— 不对称。
 * Phase 11.6 起把组件 prompt catalog 也挪到组件旁(每个组件配 .meta.ts 兄弟文件),
 * agent 通过 `@big-ppt/slidev/components-catalog` workspace 包导入。
 *
 * 写组件的人在改 props/slots 时同时维护 .meta.ts,避免 agent 那边 catalog drift。
 */

export type ComponentCategory = 'grid' | 'decoration' | 'block'

/**
 * Slot 容量等级,告诉 LLM 该组件的 slot 适合塞多大尺度的内容,避免 NineGrid 里塞 BarChart
 * 撑爆 / TwoCol 里塞「89%」单数字浪费空间这类错配。仅 grid / decoration 类有 slot 概念,
 * block 类是叶子组件不填。
 *
 * - small : 仅适合 1-3 字短词 / 单数字 / 单图标(NineGrid 每格、ProcessFlow 每 step)
 * - medium: 适合 ≤30 字短句 / 单 metric 卡 / icon+标签(田字格、PetalFour 每段)
 * - large : 适合整段(≤80 字) + 子组件(图表/卡)(TwoCol、ImageText #text)
 */
export type SlotCapacity = 'small' | 'medium' | 'large'

export interface ComponentEntry {
  /** Vue 组件名(PascalCase),与 .vue 文件名一致 */
  name: string
  /** 分类,决定 prompt 拼装时进哪个 sub-section */
  category: ComponentCategory
  /** 一句话职责 */
  description: string
  /** 一行 props / slots 概要 */
  propsOrSlots: string
  /** 一行最小用法示例(markdown 内) */
  example: string
  /** Slot 容量等级,仅 grid / decoration 类填(block 类是叶子无 slot) */
  slotCapacity?: SlotCapacity
}
