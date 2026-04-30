import type { ComponentEntry } from '../_catalog/types.js'

export const meta: ComponentEntry = {
  name: 'PetalFour',
  category: 'decoration',
  description:
    '花瓣 4 区：2×4 grid 布局——左/右 4 段标题胶囊 + 列表；中央 4 个对角 round 序号方块拼花瓣',
  propsOrSlots:
    'sections: Array<{ title: string; items: string[] }>（4 段；每段 items ≤ 3 条，超出会撑破花瓣布局）',
  example: `<PetalFour :sections='[{"title":"设计","items":["改版","布局"]},{"title":"开发","items":["开发","对接"]},{"title":"测试","items":["用例","脚本"]},{"title":"文档","items":["报告","手册"]}]' />`,
}
