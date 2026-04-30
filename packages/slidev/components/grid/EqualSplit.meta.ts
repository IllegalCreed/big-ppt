import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'EqualSplit',
  category: 'grid',
  description:
    '2-4 个等分平级元素，适合"N 个并列要点 / N 个阶段 / N 列对比"。`count` 决定数量，`direction` 决定横排（默认 row）或竖排（col）',
  propsOrSlots:
    'count: 2|3|4 / direction?: "row"|"col" (默认 "row"); slots: #slot1..#slot{count}',
  example:
    '<EqualSplit :count="3"><template #slot1>A</template><template #slot2>B</template><template #slot3>C</template></EqualSplit>',
  slotCapacity: 'medium',
}
