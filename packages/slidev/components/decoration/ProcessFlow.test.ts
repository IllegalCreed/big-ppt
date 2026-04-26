import { describe, expect, it } from 'vitest'
import { mountWithTokens } from '../../test/_setup/index.js'
import ProcessFlow from './ProcessFlow.vue'

describe('ProcessFlow', () => {
  it('默认 cols=3：渲染 3 个 step + 2 个箭头', () => {
    const wrapper = mountWithTokens(ProcessFlow, {
      slots: {
        step1: '需求',
        step2: '设计',
        step3: '上线',
      },
    })
    expect(wrapper.findAll('.ld-step')).toHaveLength(3)
    expect(wrapper.findAll('.ld-arrow')).toHaveLength(2)
    const stepTexts = wrapper.findAll('.ld-step').map((w) => w.text())
    expect(stepTexts).toEqual(['需求', '设计', '上线'])
  })

  it('cols=5 渲染 5 个 step + 4 个箭头', () => {
    const wrapper = mountWithTokens(ProcessFlow, {
      props: { cols: 5 },
      slots: {
        step1: 'A',
        step2: 'B',
        step3: 'C',
        step4: 'D',
        step5: 'E',
      },
    })
    expect(wrapper.findAll('.ld-step')).toHaveLength(5)
    expect(wrapper.findAll('.ld-arrow')).toHaveLength(4)
  })

  it('cols 越界（0 / 100）被钳到 [1, 6]', () => {
    const tooFew = mountWithTokens(ProcessFlow, {
      props: { cols: 0 },
      slots: { step1: 'X' },
    })
    expect(tooFew.findAll('.ld-step')).toHaveLength(1)
    expect(tooFew.findAll('.ld-arrow')).toHaveLength(0)

    const tooMany = mountWithTokens(ProcessFlow, {
      props: { cols: 100 },
      slots: {
        step1: '1',
        step2: '2',
        step3: '3',
        step4: '4',
        step5: '5',
        step6: '6',
      },
    })
    expect(tooMany.findAll('.ld-step')).toHaveLength(6)
    expect(tooMany.findAll('.ld-arrow')).toHaveLength(5)
  })
})
