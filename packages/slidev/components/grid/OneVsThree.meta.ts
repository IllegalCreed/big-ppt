import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'OneVsThree',
  category: 'grid',
  description:
    '一主三从（1 大 + 3 小），适合"主标题 + 3 要点"或"主图 + 3 注解"。direction 4 方向:left(默认)/right 横版主从,top/bottom 竖版主从。#main 偏 large 可放整段+子组件，#item1/2/3 偏 small 仅放 1-2 行短文字 / 单 metric',
  propsOrSlots:
    'direction?: "left"|"right"|"top"|"bottom" (默认 "left") / mainFr?: number (主区占比,默认 1); slots: #main / #item1 / #item2 / #item3',
  example:
    '<OneVsThree direction="top" :main-fr="1.5"><template #main>主</template><template #item1>1</template><template #item2>2</template><template #item3>3</template></OneVsThree>',
  slotCapacity: 'medium',
}
