import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'NineGrid',
  category: 'grid',
  description: '九宫格 3×3；slot 仅放短文字 / 单 metric / 单图标，避免 chart 撑爆',
  propsOrSlots: 'slots: #slot1..#slot9',
  example:
    '<NineGrid><template #slot1>A</template><template #slot2>B</template>...<template #slot9>I</template></NineGrid>',
  slotCapacity: 'small',
}
