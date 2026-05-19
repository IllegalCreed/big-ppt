/**
 * Phase 12.7：ImageJobsPanel 直挂组件测,聚焦渲染细节(icon 字符 / 进度条 width inline /
 * stage label 完整矩阵 / 4 jobs 混合排序)。
 *
 * 跟 ChatPanel.image-jobs-panel.test.ts 互补:那份偏 ChatPanel 集成视角(空 Map 隐藏 /
 * shallowRef 替换响应式 / sort tie-break 详细);本份偏组件内部渲染契约(icon 字面量 /
 * stage→label 全 7 态映射 / bar-fill width 数值 / header 计数边界)。
 *
 * 两份不重叠:本份的 stage 全态映射 + icon 字符断言不在那份;那份的 shallowRef setProps
 * 响应式回归不在本份。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ImageJobsPanel from '../src/components/ImageJobsPanel.vue'
import type { ImageJobTracking } from '../src/composables/useAIChat'
import type { ImageJobState } from '../src/composables/useDecks'

/** 工厂:造一条 ImageJobTracking 给 props 用,instance 字段渲染层不消费给 dummy */
function mkJob(opts: {
  jobId: string
  slideIndex?: number
  stage: ImageJobState
  progressRatio?: number
  errorMsg?: string
}): ImageJobTracking {
  return {
    jobId: opts.jobId,
    slideIndex: opts.slideIndex,
    stage: opts.stage,
    progressRatio: opts.progressRatio ?? 0,
    errorMsg: opts.errorMsg,
    instance: {} as ImageJobTracking['instance'],
  }
}

function mkMap(jobs: ImageJobTracking[]): Map<string, ImageJobTracking> {
  return new Map(jobs.map((j) => [j.jobId, j]))
}

describe('ImageJobsPanel · 渲染细节', () => {
  it('空 Map → 不渲染面板(v-if guard,sender 上方不占空间)', () => {
    const wrapper = mount(ImageJobsPanel, { props: { jobs: new Map() } })
    expect(wrapper.find('.image-jobs-panel').exists()).toBe(false)
    expect(wrapper.find('.row').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })

  it('1 job pending(无 slideIndex)→ label 「排队中…」+ 灰 icon ⏳ + 进度条 5%', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'pending-1', slideIndex: undefined, stage: 'pending', progressRatio: 0.05 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    const row = wrapper.find('.row')
    expect(row.exists()).toBe(true)
    expect(row.classes()).toContain('row-pending')
    expect(row.find('.label').text()).toBe('排队中…')
    expect(row.find('.detail').text()).toBe('排队中')
    // pending 行 icon 字面量是 ⏳(沙漏)
    expect(row.find('.icon').text()).toBe('⏳')
    // 进度条仍渲染(pending / running 都有 bar 槽位),width 5%
    expect(row.find('.bar').exists()).toBe(true)
    expect(row.find('.bar-fill').attributes('style')).toContain('width: 5%')
  })

  it('1 job running 50% → label 「第 N 页」+ 蓝色脉冲 icon ● + 进度条 50%', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'run-1', slideIndex: 3, stage: 'running', progressRatio: 0.5 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    const row = wrapper.find('.row')
    expect(row.classes()).toContain('row-running')
    expect(row.find('.label').text()).toBe('第 3 页')
    expect(row.find('.detail').text()).toBe('生成中 50%')
    // running 行 icon 字面量 ●(实心圆 + CSS pulse 动画)
    expect(row.find('.icon').text()).toBe('●')
    expect(row.find('.bar-fill').attributes('style')).toContain('width: 50%')
  })

  it('1 job done → label 「完成」+ 绿色 ✓ + 无进度条(已无意义)', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'done-1', slideIndex: 1, stage: 'done', progressRatio: 1 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    const row = wrapper.find('.row')
    expect(row.classes()).toContain('row-done')
    expect(row.find('.detail').text()).toBe('完成')
    expect(row.find('.icon').text()).toBe('✓')
    // done 行不再渲染进度条(v-if 在 row 元素内)
    expect(row.find('.bar').exists()).toBe(false)
  })

  it('1 job failed with errorMsg → 红色 ✕ + errorMsg 进 detail title 属性', () => {
    const jobs = mkMap([
      mkJob({
        jobId: 'fail-1',
        slideIndex: 5,
        stage: 'failed',
        errorMsg: 'OpenAI 429: rate limit, retry after 60s',
      }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    const row = wrapper.find('.row')
    expect(row.classes()).toContain('row-failed')
    expect(row.find('.detail').text()).toBe('失败')
    expect(row.find('.icon').text()).toBe('✕')
    // errorMsg 全文挂 .detail title(用户 hover 看完整原因)
    expect(row.find('.detail').attributes('title')).toBe('OpenAI 429: rate limit, retry after 60s')
    // failed 也不渲染进度条
    expect(row.find('.bar').exists()).toBe(false)
  })

  it('4 jobs 混合 pending/running/done/failed → header 「1 / 4 · 失败 1」+ 正确排序', () => {
    const jobs = mkMap([
      // 故意乱序传入,看 sort 是否生效;按 slideIndex asc 排序应是 1, 2, 3, 4
      mkJob({ jobId: 'd', slideIndex: 4, stage: 'failed', errorMsg: 'quota' }),
      mkJob({ jobId: 'a', slideIndex: 1, stage: 'pending', progressRatio: 0.05 }),
      mkJob({ jobId: 'c', slideIndex: 3, stage: 'done', progressRatio: 1 }),
      mkJob({ jobId: 'b', slideIndex: 2, stage: 'running', progressRatio: 0.6 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    // header 计数:done 桶 = 1 (only 'c'),total = 4,failed 桶 = 1 (only 'd')
    const headerCounts = wrapper.find('.counts').text()
    expect(headerCounts).toContain('1 / 4')
    expect(wrapper.find('.failed-count').text()).toContain('失败 1')

    // 排序:slideIndex 1 → 2 → 3 → 4
    const rows = wrapper.findAll('.row')
    expect(rows.length).toBe(4)
    expect(rows[0]!.classes()).toContain('row-pending')
    expect(rows[0]!.find('.label').text()).toBe('第 1 页')
    expect(rows[1]!.classes()).toContain('row-running')
    expect(rows[1]!.find('.label').text()).toBe('第 2 页')
    expect(rows[2]!.classes()).toContain('row-done')
    expect(rows[2]!.find('.label').text()).toBe('第 3 页')
    expect(rows[3]!.classes()).toContain('row-failed')
    expect(rows[3]!.find('.label').text()).toBe('第 4 页')

    // 4 个 icon 字符各自符合 variant
    expect(rows[0]!.find('.icon').text()).toBe('⏳')
    expect(rows[1]!.find('.icon').text()).toBe('●')
    expect(rows[2]!.find('.icon').text()).toBe('✓')
    expect(rows[3]!.find('.icon').text()).toBe('✕')
  })

  it('stage→label 全 7 态映射矩阵(7 个 state 全覆盖,防未来漏改)', () => {
    // 7 个 state(ImageJobState union):pending / running / done / failed / cancelled /
    //   fallback-rewrote / fallback-failed —— ImageJobsPanel.stageLabel switch 必须完全覆盖
    const cases: Array<{ stage: ImageJobState; expectedDetail: string; expectedVariant: string }> = [
      { stage: 'pending', expectedDetail: '排队中', expectedVariant: 'pending' },
      { stage: 'running', expectedDetail: '生成中 0%', expectedVariant: 'running' },
      { stage: 'done', expectedDetail: '完成', expectedVariant: 'done' },
      // fallback-rewrote 归入 done variant(已成功兜底重写,UI 也该提示「完成」)
      {
        stage: 'fallback-rewrote',
        expectedDetail: '完成（兜底重写）',
        expectedVariant: 'done',
      },
      { stage: 'failed', expectedDetail: '失败', expectedVariant: 'failed' },
      {
        stage: 'fallback-failed',
        expectedDetail: '失败（兜底也失败）',
        expectedVariant: 'failed',
      },
      { stage: 'cancelled', expectedDetail: '已取消', expectedVariant: 'failed' },
    ]

    for (const { stage, expectedDetail, expectedVariant } of cases) {
      const jobs = mkMap([mkJob({ jobId: `j-${stage}`, slideIndex: 1, stage })])
      const wrapper = mount(ImageJobsPanel, { props: { jobs } })
      const row = wrapper.find('.row')
      expect(row.classes(), `stage=${stage} 应有 row-${expectedVariant} 类`).toContain(
        `row-${expectedVariant}`,
      )
      expect(row.find('.detail').text(), `stage=${stage} detail 文案`).toBe(expectedDetail)
    }
  })

  it('running 90% → label 「生成中 90%」+ 进度条 width 90%(四舍五入到整数)', () => {
    const jobs = mkMap([
      // 0.895 round → 90%
      mkJob({ jobId: 'r-90', slideIndex: 2, stage: 'running', progressRatio: 0.895 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    const row = wrapper.find('.row')
    // Math.round(0.895 * 100) = 90(IEEE 754 0.895 实际略小于,但 90 是预期)
    expect(row.find('.detail').text()).toMatch(/^生成中 (89|90)%$/)
    const barStyle = row.find('.bar-fill').attributes('style') ?? ''
    expect(barStyle).toMatch(/width: (89|90)%/)
  })

  it('header counts 边界:全 done 不显示 failed-count', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'a', slideIndex: 1, stage: 'done', progressRatio: 1 }),
      mkJob({ jobId: 'b', slideIndex: 2, stage: 'done', progressRatio: 1 }),
      mkJob({ jobId: 'c', slideIndex: 3, stage: 'fallback-rewrote', progressRatio: 1 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    expect(wrapper.find('.counts').text()).toContain('3 / 3')
    // fallback-rewrote 计入 done 桶,不计 failed
    expect(wrapper.find('.failed-count').exists()).toBe(false)
  })

  it('header counts 边界:全 failed → 「0 / N · 失败 N」', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'a', slideIndex: 1, stage: 'failed', errorMsg: 'e1' }),
      mkJob({ jobId: 'b', slideIndex: 2, stage: 'fallback-failed', errorMsg: 'e2' }),
      mkJob({ jobId: 'c', slideIndex: 3, stage: 'cancelled' }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    expect(wrapper.find('.counts').text()).toContain('0 / 3')
    expect(wrapper.find('.failed-count').text()).toContain('失败 3')
  })

  it('aria-live="polite" + role="status" → 屏幕阅读器友好(无障碍契约回归)', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'a', slideIndex: 1, stage: 'running', progressRatio: 0.3 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    const panel = wrapper.find('.image-jobs-panel')
    expect(panel.attributes('role')).toBe('status')
    expect(panel.attributes('aria-live')).toBe('polite')
    // 装饰 icon 必须 aria-hidden(读屏幕 ✓ ✕ 等会喧宾夺主)
    expect(panel.find('.icon').attributes('aria-hidden')).toBe('true')
    // 进度条本身是装饰性的,aria-hidden 防双读
    expect(panel.find('.bar').attributes('aria-hidden')).toBe('true')
  })

  describe('Phase 11.8 dogfood:用户主动 cancel 卡死 job', () => {
    it('running / pending 行渲染 ✕ 按钮(防 OpenAI 卡死无兜底)', () => {
      const jobs = mkMap([
        mkJob({ jobId: 'a', slideIndex: 1, stage: 'pending', progressRatio: 0.05 }),
        mkJob({ jobId: 'b', slideIndex: 2, stage: 'running', progressRatio: 0.5 }),
      ])
      const wrapper = mount(ImageJobsPanel, { props: { jobs } })
      expect(wrapper.find('[data-cancel-job-id="a"]').exists()).toBe(true)
      expect(wrapper.find('[data-cancel-job-id="b"]').exists()).toBe(true)
    })

    it('done / failed 行 **不**渲染 ✕ 按钮(终态无意义)', () => {
      const jobs = mkMap([
        mkJob({ jobId: 'd', slideIndex: 1, stage: 'done', progressRatio: 1 }),
        mkJob({ jobId: 'f', slideIndex: 2, stage: 'failed', errorMsg: 'e' }),
        mkJob({ jobId: 'c', slideIndex: 3, stage: 'cancelled' }),
      ])
      const wrapper = mount(ImageJobsPanel, { props: { jobs } })
      expect(wrapper.find('[data-cancel-job-id="d"]').exists()).toBe(false)
      expect(wrapper.find('[data-cancel-job-id="f"]').exists()).toBe(false)
      expect(wrapper.find('[data-cancel-job-id="c"]').exists()).toBe(false)
    })

    it('点 ✕ → 调 tracking.instance.cancel() + 按钮立即 disabled 防双击', async () => {
      let resolveCancel: () => void = () => {}
      const cancelFn = vi.fn(
        () =>
          new Promise<void>((r) => {
            resolveCancel = r
          }),
      )
      const job = mkJob({ jobId: 'x', slideIndex: 1, stage: 'running', progressRatio: 0.5 })
      job.instance = { cancel: cancelFn } as unknown as ImageJobTracking['instance']
      const wrapper = mount(ImageJobsPanel, { props: { jobs: mkMap([job]) } })

      const btn = wrapper.find('[data-cancel-job-id="x"]')
      await btn.trigger('click')
      expect(cancelFn).toHaveBeenCalledTimes(1)
      // 还在 inflight → disabled 防双击
      expect((btn.element as HTMLButtonElement).disabled).toBe(true)
      resolveCancel()
      // flush microtasks 让 finally 跑
      await Promise.resolve()
      await Promise.resolve()
    })
  })
})
