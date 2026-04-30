import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'ProcessFlow',
  category: 'decoration',
  description: 'N 步流程箭头横排连接；阶段流程 / 工作流',
  propsOrSlots: 'cols?: number (1-6, 默认 3); slots: #step1..#step6',
  example:
    '<ProcessFlow :cols="4"><template #step1>需求</template><template #step2>设计</template>...<template #step4>上线</template></ProcessFlow>',
}
