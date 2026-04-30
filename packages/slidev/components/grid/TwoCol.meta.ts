import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'TwoCol',
  category: 'grid',
  description: '两栏对比 50/50；中间可选分隔条',
  propsOrSlots: 'leftTitle? / rightTitle? / divider?: "on"|"off"; slots: #left / #right',
  example:
    '<TwoCol left-title="旧" right-title="新"><template #left>A</template><template #right>B</template></TwoCol>',
  slotCapacity: 'large',
}
