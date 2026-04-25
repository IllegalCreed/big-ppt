import { describe, expect, it, vi } from 'vitest'
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
    http.get('/list-templates', () =>
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
    vi.useFakeTimers()
    const wrapper = mount(TemplatePickerModal, {
      props: { open: true, mode: 'switch', currentTemplateId: 'beitou-standard', deckId: 1, disableTeleport: true },
    })
    await flushPromises()
    await wrapper.find<HTMLButtonElement>('button[data-primary-action]').trigger('click')
    await flushPromises()
    // 视图切到 progress：picker 列表不再显示
    expect(wrapper.find('[data-template-card]').exists()).toBe(false)
    expect(wrapper.text()).toContain('正在切换')
    vi.useRealTimers()
  })
})
