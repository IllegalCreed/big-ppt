import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'NineGrid',
  category: 'grid',
  description:
    '九宫格 3×3；slot 仅放短文字 / 单 metric / 单图标，避免 chart 撑爆。开 :show-center-decoration="true" 时 slot1..slot8 占外圈、中央 cell 渲染 #decoration（放 icon / logo / 主题图等装饰）',
  propsOrSlots:
    'showCenterDecoration?: boolean (默认 false); slots: #slot1..#slot9 (默认) 或 #slot1..#slot8 + #decoration (showCenterDecoration=true 时)',
  example:
    '<NineGrid :show-center-decoration="true"><template #slot1>1</template>...<template #slot8>8</template><template #decoration><Icon name="lucide:zap"/></template></NineGrid>',
  slotCapacity: 'small',
}
