import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'ThreeCol',
  category: 'grid',
  description: '三列均分，中间常放装饰组件、左右放文字',
  propsOrSlots: 'cols?: string (CSS grid-template-columns); slots: #left / #center / #right',
  example: '<ThreeCol><template #left>...</template><template #center>...</template></ThreeCol>',
  slotCapacity: 'medium',
}
