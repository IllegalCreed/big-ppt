import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'Quote',
  category: 'block',
  description: '引文左侧粗竖线 + 可选 author / cite',
  propsOrSlots: 'author? / cite?; default slot = 引文文字',
  example: '<Quote author="张三" cite="《白皮书》">关键观点文字。</Quote>',
}
