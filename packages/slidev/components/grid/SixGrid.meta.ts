import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'SixGrid',
  category: 'grid',
  description:
    '6 个等分平级元素，介于田字格(4)和九宫格(9)之间。layout: "3x2"(默认 3 行 2 列) / "2x3"(2 行 3 列)。slot 容量比九宫格大但比田字格小，适合短文字 + 单 metric / icon+短标签',
  propsOrSlots: 'layout?: "2x3" | "3x2" (默认 "3x2"); slots: #slot1..#slot6',
  example:
    '<SixGrid layout="2x3"><template #slot1>A</template><template #slot2>B</template>...<template #slot6>F</template></SixGrid>',
  slotCapacity: 'medium',
}
