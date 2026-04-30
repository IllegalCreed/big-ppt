import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'OneRightThreeLeft',
  category: 'grid',
  description: '右主左从，OneLeftThreeRight 镜像版。#main 偏 large、#item1/2/3 偏 small',
  propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
  example:
    '<OneRightThreeLeft><template #main>主</template><template #item1>1</template>...</OneRightThreeLeft>',
  slotCapacity: 'medium',
}
