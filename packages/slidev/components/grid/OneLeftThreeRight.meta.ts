import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'OneLeftThreeRight',
  category: 'grid',
  description: '左主右从（左 1 主 + 右 3 列），适合"主标题 + 3 要点"。#main 偏 large 可放整段+子组件，#item1/2/3 偏 small 仅放 1-2 行短文字 / 单 metric',
  propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
  example:
    '<OneLeftThreeRight><template #main>主</template><template #item1>1</template>...</OneLeftThreeRight>',
  slotCapacity: 'medium',
}
