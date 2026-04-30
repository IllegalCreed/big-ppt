import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'Table',
  category: 'block',
  description:
    '表格：表头主色填充白字 + 斑马条；适合项目清单 / 对比矩阵。行数建议 ≤ 5（slides 视口固定，溢出会裁剪，超过 5 行请拆页或缩描述避免换行）',
  propsOrSlots: 'headers: string[] / rows: (string|number)[][] / variant?: "striped"|"plain"',
  example: `<Table :headers='["项目","负责人","截止"]' :rows='[["登录优化","张三","04-30"],["性能埋点","李四","05-15"]]' />`,
}
