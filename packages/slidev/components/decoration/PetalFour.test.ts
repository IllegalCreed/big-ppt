import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import PetalFour from './PetalFour.vue'

const SAMPLE_SECTIONS = [
  { title: '设计', items: ['对网站整体改版', '支持自定义布局'] },
  { title: '开发', items: ['新版门户开发', '对接用户系统'] },
  { title: '测试', items: ['测试用例设计', '300+ 自动化脚本'] },
  { title: '文档', items: ['测试报告', '用户手册'] },
]

describe('PetalFour', () => {
  it('渲染 4 个序号方块（对角 round 类）', () => {
    const wrapper = mountWithTokens(PetalFour, { props: { sections: SAMPLE_SECTIONS } })
    const cells = wrapper.findAll('.ld-petal-cell')
    expect(cells).toHaveLength(4)
    expect(cells.map((c) => c.text())).toEqual(['1', '2', '3', '4'])
    // 对角圆角 class 各 2 个
    expect(wrapper.findAll('.ld-petal-cell--bl-tr')).toHaveLength(2)
    expect(wrapper.findAll('.ld-petal-cell--tl-br')).toHaveLength(2)
  })

  it('sections 数据透出到内容区（标题胶囊 + 列表）', () => {
    const wrapper = mountWithTokens(PetalFour, { props: { sections: SAMPLE_SECTIONS } })
    const titles = wrapper.findAll('.ld-petal-title').map((w) => w.text())
    expect(titles).toEqual(['设计', '开发', '测试', '文档'])
    const lists = wrapper.findAll('.ld-petal-list')
    expect(lists).toHaveLength(4)
    // 第一组应含两个 li
    expect(lists[0].findAll('li').map((li) => li.text())).toEqual([
      '对网站整体改版',
      '支持自定义布局',
    ])
  })

  it('sections 不足 4 个时多余位置不渲染 title / list', () => {
    const wrapper = mountWithTokens(PetalFour, {
      props: { sections: [SAMPLE_SECTIONS[0], SAMPLE_SECTIONS[1]] },
    })
    expect(wrapper.findAll('.ld-petal-title')).toHaveLength(2)
    // 但 4 个序号方块仍渲染
    expect(wrapper.findAll('.ld-petal-cell')).toHaveLength(4)
  })
})
