import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'OneTopThreeBottom',
  category: 'grid',
  description: '上主下从（上 1 主 + 下 3 等列），适合"主题句 + 3 阶段"。#main 偏 large 可放主旨段，#item1/2/3 偏 small 适合 2-4 字阶段名',
  propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
  example:
    '<OneTopThreeBottom><template #main>主</template><template #item1>1</template>...</OneTopThreeBottom>',
  slotCapacity: 'medium',
}
