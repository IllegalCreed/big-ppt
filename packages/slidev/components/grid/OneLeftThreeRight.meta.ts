import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'OneLeftThreeRight',
  category: 'grid',
  description: '左主右从（左 1 主 + 右 3 列），适合"主标题 + 3 要点"',
  propsOrSlots: 'mainFr?: number; slots: #main / #item1 / #item2 / #item3',
  example:
    '<OneLeftThreeRight><template #main>主</template><template #item1>1</template>...</OneLeftThreeRight>',
}
