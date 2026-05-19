/**
 * Phase 12.7 dogfood (commit b01c6da):ImageJobsPanel 直接挂测 + ChatPanel 集成。
 *
 * ImageJobsPanel 是 useAIChat.imageJobs ShallowRef<Map<jobId, ImageJobTracking>>
 * 的视图。覆盖:
 * - 空 Map → 整面板 v-if 不渲染(不占 sender 上方空间)
 * - 2 jobs(pending + running) → 渲染 2 行 + 各自 label / detail / 进度条
 * - 1 done + 1 running 混合 → header 「1 / 2」
 * - failed job 错信息(`errorMsg`)进 detail 元素 title 属性(hover tooltip)
 * - 按 slideIndex 升序排,无 slideIndex 落末尾
 *
 * ChatPanel 集成:imageJobs Map 通过 useAIChat 暴露,ChatPanel 直接 `:jobs="imageJobs"`
 * 透传;由于本测专注 ImageJobsPanel 行为,直接挂面板组件比 mount ChatPanel(还得
 * stub @antdv-next/x 的 Sender/Bubble)更直接干净。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import ImageJobsPanel from '../src/components/ImageJobsPanel.vue'
import type { ImageJobTracking } from '../src/composables/useAIChat'
import type { ImageJobState } from '../src/composables/useDecks'

/** 工厂:造一条 ImageJobTracking,test 不关心 instance 字段(渲染层不消费它) */
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
    // instance 仅 useAIChat 内部 abort 用,渲染层不读;给一份 dummy 占位
    instance: {} as ImageJobTracking['instance'],
  }
}

function mkMap(jobs: ImageJobTracking[]): Map<string, ImageJobTracking> {
  return new Map(jobs.map((j) => [j.jobId, j]))
}

describe('ImageJobsPanel', () => {
  it('空 Map → 整面板不渲染(v-if 隐藏)', () => {
    const wrapper = mount(ImageJobsPanel, {
      props: { jobs: new Map() },
    })
    expect(wrapper.find('.image-jobs-panel').exists()).toBe(false)
  })

  it('2 jobs(pending + running 50%) → 渲染 2 行,label / detail / 进度条正确', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'a', slideIndex: 1, stage: 'pending', progressRatio: 0.05 }),
      mkJob({ jobId: 'b', slideIndex: 2, stage: 'running', progressRatio: 0.5 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    expect(wrapper.find('.image-jobs-panel').exists()).toBe(true)
    const rows = wrapper.findAll('.row')
    expect(rows.length).toBe(2)

    // 第 1 行:slideIndex=1 pending
    expect(rows[0]!.classes()).toContain('row-pending')
    expect(rows[0]!.find('.label').text()).toBe('第 1 页')
    expect(rows[0]!.find('.detail').text()).toBe('排队中')

    // 第 2 行:slideIndex=2 running 50%
    expect(rows[1]!.classes()).toContain('row-running')
    expect(rows[1]!.find('.label').text()).toBe('第 2 页')
    expect(rows[1]!.find('.detail').text()).toBe('生成中 50%')

    // 进度条仅 pending / running 行渲染(done / failed 不再有进度条 — 也无意义)
    expect(rows[0]!.find('.bar').exists()).toBe(true)
    expect(rows[1]!.find('.bar').exists()).toBe(true)

    // bar-fill width 用 inline style
    expect(rows[1]!.find('.bar-fill').attributes('style')).toContain('width: 50%')
  })

  it('1 done + 1 running 混合 → header 显示「1 / 2」', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'a', slideIndex: 1, stage: 'done', progressRatio: 1 }),
      mkJob({ jobId: 'b', slideIndex: 2, stage: 'running', progressRatio: 0.7 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    // header 「图片生成进度」 + counts 「1 / 2」
    expect(wrapper.find('.title').text()).toBe('图片生成进度')
    const counts = wrapper.find('.counts').text()
    expect(counts).toContain('1 / 2')
    // 没有 failed → 不显示 failed-count
    expect(wrapper.find('.failed-count').exists()).toBe(false)

    // done 行 variant 类 + label 文案
    const rows = wrapper.findAll('.row')
    const doneRow = rows.find((r) => r.classes().includes('row-done'))!
    expect(doneRow.find('.detail').text()).toBe('完成')
    // running 进度 70% running
    const runningRow = rows.find((r) => r.classes().includes('row-running'))!
    expect(runningRow.find('.detail').text()).toBe('生成中 70%')
  })

  it('failed job:errorMsg 写到 detail 的 title 属性(hover 看完整原因)', () => {
    const jobs = mkMap([
      mkJob({
        jobId: 'fail-1',
        slideIndex: 3,
        stage: 'failed',
        errorMsg: 'quota exceeded; retry after 60s',
      }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })

    const row = wrapper.find('.row')
    expect(row.classes()).toContain('row-failed')
    expect(row.find('.detail').text()).toBe('失败')
    expect(row.find('.detail').attributes('title')).toBe('quota exceeded; retry after 60s')
    // failed 行无进度条(用户已不关心进度)
    expect(row.find('.bar').exists()).toBe(false)

    // header counts 失败计 1 单独显示
    expect(wrapper.find('.counts').text()).toContain('0 / 1')
    expect(wrapper.find('.failed-count').text()).toContain('失败 1')
  })

  it('fallback-rewrote:Phase 11.8 dogfood 归 warning(降级,而非完成),计入失败桶', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'fb', slideIndex: 4, stage: 'fallback-rewrote', progressRatio: 1 }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    const row = wrapper.find('.row')
    expect(row.classes()).toContain('row-warning')
    expect(row.find('.detail').text()).toBe('出图失败,已降级为组件版')
    // done=0 / total=1,fallback-rewrote 计入失败桶让用户看见(之前归 done 被错过)
    expect(wrapper.find('.counts').text()).toContain('0 / 1')
    expect(wrapper.find('.failed-count').text()).toContain('失败 1')
  })

  it('fallback-failed / cancelled:fallback-failed 归 warning,cancelled 归 failed', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'ff', slideIndex: 5, stage: 'fallback-failed', errorMsg: '兜底也崩' }),
      mkJob({ jobId: 'c', slideIndex: 6, stage: 'cancelled' }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    const rows = wrapper.findAll('.row')
    expect(rows[0]!.classes()).toContain('row-warning')
    expect(rows[0]!.find('.detail').text()).toBe('失败(兜底重写也失败)')
    expect(rows[1]!.classes()).toContain('row-failed')
    expect(rows[1]!.find('.detail').text()).toBe('已取消')
    // counts 「0 / 2」+ 失败 2(warning + failed 都计入失败桶)
    expect(wrapper.find('.counts').text()).toContain('0 / 2')
    expect(wrapper.find('.failed-count').text()).toContain('失败 2')
  })

  it('按 slideIndex 升序排,无 slideIndex 落末尾;同 slideIndex 走 jobId 字典序', () => {
    const jobs = mkMap([
      mkJob({ jobId: 'zzz', slideIndex: 3, stage: 'pending' }),
      mkJob({ jobId: 'no-idx', slideIndex: undefined, stage: 'pending' }),
      mkJob({ jobId: 'aaa', slideIndex: 1, stage: 'pending' }),
      mkJob({ jobId: 'a-same', slideIndex: 2, stage: 'pending' }),
      mkJob({ jobId: 'b-same', slideIndex: 2, stage: 'pending' }),
    ])
    const wrapper = mount(ImageJobsPanel, { props: { jobs } })
    const rows = wrapper.findAll('.row')
    expect(rows.length).toBe(5)
    expect(rows[0]!.find('.label').text()).toBe('第 1 页') // aaa
    expect(rows[1]!.find('.label').text()).toBe('第 2 页') // a-same (字典序在 b 前)
    expect(rows[2]!.find('.label').text()).toBe('第 2 页') // b-same
    expect(rows[3]!.find('.label').text()).toBe('第 3 页') // zzz
    expect(rows[4]!.find('.label').text()).toBe('排队中…') // no-idx
  })

  it('reactive:props.jobs 引用替换(shallowRef 套路)后视图更新', async () => {
    const jobsRef = shallowRef<Map<string, ImageJobTracking>>(
      mkMap([mkJob({ jobId: 'a', slideIndex: 1, stage: 'running', progressRatio: 0.3 })]),
    )
    // 用一个父组件 host 把 ref 透传给 panel(模拟 ChatPanel 的 :jobs="imageJobs" 绑定)
    const wrapper = mount(ImageJobsPanel, { props: { jobs: jobsRef.value } })
    expect(wrapper.findAll('.row').length).toBe(1)
    expect(wrapper.find('.detail').text()).toBe('生成中 30%')

    // 模拟 useAIChat watch handler 替换 Map 引用(immutable update,符合 shallowRef 用法)
    await wrapper.setProps({
      jobs: mkMap([
        mkJob({ jobId: 'a', slideIndex: 1, stage: 'done', progressRatio: 1 }),
        mkJob({ jobId: 'b', slideIndex: 2, stage: 'running', progressRatio: 0.6 }),
      ]),
    })
    expect(wrapper.findAll('.row').length).toBe(2)
    expect(wrapper.find('.counts').text()).toContain('1 / 2')
  })
})
