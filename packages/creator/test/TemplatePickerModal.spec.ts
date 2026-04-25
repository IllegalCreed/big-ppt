import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { http, HttpResponse, server, useMsw } from './_setup/msw'
import TemplatePickerModal from '../src/components/TemplatePickerModal.vue'

useMsw()

const MANIFESTS = [
  {
    id: 'beitou-standard',
    name: '北投集团汇报模板',
    description: '商务正式风格 · 暖色调配色',
    tagline: '商务正式 · 暖色调',
    thumbnail: 'thumbnail.png',
    promptPersona: '',
    starterSlidesPath: 'starter.md',
    logos: { primary: 'logo.png' },
    layouts: [{ name: 'cover', description: 'x', frontmatterSchema: { type: 'object', properties: {} } }],
  },
  {
    id: 'jingyeda-standard',
    name: '竞业达汇报模板',
    description: '商务科技风格 · 深色活力',
    tagline: '商务科技 · 深色活力',
    thumbnail: 'thumbnail.png',
    promptPersona: '',
    starterSlidesPath: 'starter.md',
    logos: { primary: 'logo.png' },
    layouts: [{ name: 'cover', description: 'x', frontmatterSchema: { type: 'object', properties: {} } }],
  },
]

function mockListTemplates() {
  server.use(
    http.get('/api/list-templates', () =>
      HttpResponse.json({ success: true, manifests: MANIFESTS, templates: [], usage_guide: '', design_spec: '', available_images: [] }),
    ),
  )
}

describe('TemplatePickerModal · create mode · picker view', () => {
  it('open=true 时拉模板清单并渲染左列表 + 右预览', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create', disableTeleport: true },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('北投集团汇报模板')
    expect(wrapper.text()).toContain('竞业达汇报模板')
    // 默认选中第一项 → 右侧预览渲染 description
    expect(wrapper.text()).toContain('商务正式风格')
  })

  it('点左列切换选中 → 右预览更新', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create', disableTeleport: true },
    })
    await flushPromises()
    const cards = wrapper.findAll('[data-template-card]')
    expect(cards.length).toBe(2)
    await cards[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('商务科技风格')
  })

  it('标题 input 空时创建按钮 disabled，有值时可点', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create', disableTeleport: true },
    })
    await flushPromises()
    const input = wrapper.find<HTMLInputElement>('input[data-title-input]')
    await input.setValue('')
    const btn = wrapper.find<HTMLButtonElement>('button[data-primary-action]')
    expect(btn.attributes('disabled')).toBeDefined()
    await input.setValue('My Deck')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('点"创建"调 POST /api/decks 并 emit created 事件带新 deck', async () => {
    mockListTemplates()
    server.use(
      http.post('/api/decks', async ({ request }) => {
        const body = (await request.json()) as { title: string; templateId: string }
        expect(body.templateId).toBe('beitou-standard')
        expect(body.title).toBe('My Deck')
        return HttpResponse.json({
          deck: {
            id: 42,
            userId: 1,
            title: 'My Deck',
            themeId: 'default',
            templateId: 'beitou-standard',
            currentVersionId: 1,
            status: 'active',
            createdAt: 'x',
            updatedAt: 'x',
          },
        })
      }),
    )
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'create', disableTeleport: true },
    })
    await flushPromises()
    await wrapper.find<HTMLInputElement>('input[data-title-input]').setValue('My Deck')
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    const events = wrapper.emitted('created')
    expect(events).toBeDefined()
    expect(events![0][0]).toMatchObject({ id: 42, templateId: 'beitou-standard' })
  })
})

describe('TemplatePickerModal · switch mode', () => {
  it('默认选中 current 之外的模板', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
    })
    await flushPromises()
    // 选中应为 jingyeda
    expect(wrapper.text()).toContain('商务科技风格')
  })

  it('switch 模式下选中 current 时主按钮 disabled', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
    })
    await flushPromises()
    // 点回 beitou 卡片
    const cards = wrapper.findAll('[data-template-card]')
    await cards[0].trigger('click')
    const btn = wrapper.find<HTMLButtonElement>('button[data-primary-action]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('右预览 switch 模式渲染警告条', async () => {
    mockListTemplates()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('AI 用新模板风格重写')
  })

  describe('switch → progress（fake timer）', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('点"切换"调 switchTemplate API 并进入 progress 视图', async () => {
      mockListTemplates()
      server.use(
        http.post('/api/decks/1/switch-template', () =>
          HttpResponse.json({ jobId: 'job-x', state: 'pending' }),
        ),
        http.get('/api/switch-template-jobs/job-x', () =>
          HttpResponse.json({ job: { id: 'job-x', state: 'migrating' } }),
        ),
      )
      const wrapper = mount(TemplatePickerModal, {
        props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
      })
      await flushPromises()
      await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
      await flushPromises()
      // 视图切到 progress：picker 列表不再显示
      expect(wrapper.find('[data-template-card]').exists()).toBe(false)
      expect(wrapper.text()).toContain('正在切换')
    })

    it('progress 阶段点 X 关闭按钮无效，view 不退回 picker（防误关丢任务）', async () => {
      mockListTemplates()
      server.use(
        http.post('/api/decks/1/switch-template', () =>
          HttpResponse.json({ jobId: 'job-y', state: 'pending' }),
        ),
        http.get('/api/switch-template-jobs/job-y', () =>
          HttpResponse.json({ job: { id: 'job-y', state: 'migrating' } }),
        ),
      )
      const wrapper = mount(TemplatePickerModal, {
        props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
      })
      await flushPromises()
      await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
      await flushPromises()
      // 现在在 progress 视图
      expect(wrapper.text()).toContain('正在切换')

      // 点 X 关闭按钮
      await wrapper.find<HTMLButtonElement>('button[aria-label="关闭"]').trigger('click')
      await flushPromises()

      // update:open 不应被 emit
      expect(wrapper.emitted('update:open')).toBeUndefined()
      // view 仍然是 progress
      expect(wrapper.text()).toContain('正在切换')
    })
  })
})

describe('TemplatePickerModal · progress / success / error', () => {
  describe('fake timer block', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('progress view 显示 stage list，完成后进 success view 并带"查看"按钮', async () => {
      mockListTemplates()
      let count = 0
      server.use(
        http.post('/api/decks/1/switch-template', () =>
          HttpResponse.json({ jobId: 'jp', state: 'pending' }),
        ),
        http.get('/api/switch-template-jobs/jp', () => {
          count++
          if (count === 1) return HttpResponse.json({ job: { id: 'jp', state: 'snapshotting' } })
          if (count === 2) return HttpResponse.json({ job: { id: 'jp', state: 'migrating' } })
          return HttpResponse.json({
            job: {
              id: 'jp',
              state: 'success',
              snapshotVersionId: 7,
              newVersionId: 8,
            },
          })
        }),
      )
      const wrapper = mount(TemplatePickerModal, {
        props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
      })
      await flushPromises()
      await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(0)
      expect(wrapper.text()).toContain('保存当前版本快照')  // stage list 渲染
      await vi.advanceTimersByTimeAsync(1500)
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1500)
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1500)
      await flushPromises()
      expect(wrapper.text()).toContain('切换完成')
      expect(wrapper.find<HTMLButtonElement>('button[data-success-view]').exists()).toBe(true)
    })

    it('点"查看"关窗 + emit switched 带 snapshotVersionId / newTemplateName', async () => {
      mockListTemplates()
      server.use(
        http.post('/api/decks/1/switch-template', () =>
          HttpResponse.json({ jobId: 'jp2', state: 'pending' }),
        ),
        http.get('/api/switch-template-jobs/jp2', () =>
          HttpResponse.json({
            job: { id: 'jp2', state: 'success', snapshotVersionId: 9, newVersionId: 10 },
          }),
        ),
      )
      const wrapper = mount(TemplatePickerModal, {
        props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
      })
      await flushPromises()
      await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1500)
      await flushPromises()
      await wrapper.find<HTMLButtonElement>('button[data-success-view]').trigger('click')
      await flushPromises()
      const events = wrapper.emitted('switched')
      expect(events).toBeDefined()
      expect(events![0][0]).toMatchObject({
        snapshotVersionId: 9,
        newTemplateName: '竞业达汇报模板',
      })
      expect(wrapper.emitted('update:open')).toBeDefined()
    })

    it('error view 显示 retry 按钮，点击重新进 progress', async () => {
      mockListTemplates()
      let tries = 0
      server.use(
        http.post('/api/decks/1/switch-template', () => {
          tries++
          return HttpResponse.json({ jobId: `jr${tries}`, state: 'pending' })
        }),
        http.get(/switch-template-jobs\/jr1/, () =>
          HttpResponse.json({ job: { id: 'jr1', state: 'failed', error: 'boom' } }),
        ),
        http.get(/switch-template-jobs\/jr2/, () =>
          HttpResponse.json({ job: { id: 'jr2', state: 'migrating' } }),
        ),
      )
      const wrapper = mount(TemplatePickerModal, {
        props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
      })
      await flushPromises()
      await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1500)
      await flushPromises()
      expect(wrapper.text()).toContain('切换失败')
      expect(wrapper.text()).toContain('boom')
      await wrapper.find<HTMLButtonElement>('button[data-retry]').trigger('click')
      await flushPromises()
      expect(tries).toBe(2)
      // 应回到 progress 视图
      expect(wrapper.text()).toContain('正在切换')
    })
  })
})
