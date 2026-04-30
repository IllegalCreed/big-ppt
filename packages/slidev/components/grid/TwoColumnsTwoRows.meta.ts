import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'TwoColumnsTwoRows',
  category: 'grid',
  description: '田字格 2×2，4 个等大单元；适合 4 维度对比 / 4 季度数据',
  propsOrSlots: 'slots: #slot1 / #slot2 / #slot3 / #slot4',
  example:
    '<TwoColumnsTwoRows><template #slot1>A</template><template #slot2>B</template><template #slot3>C</template><template #slot4>D</template></TwoColumnsTwoRows>',
  slotCapacity: 'medium',
}
