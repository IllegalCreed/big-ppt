import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ActiveImageStyle, ImageStyleLibraryResponse } from '@big-ppt/shared'
import { HttpResponse, http, server, useMsw } from './_setup/msw'
import ImageStyleLibraryModal from '../src/components/ImageStyleLibraryModal.vue'
import { useImageStyleLibrary } from '../src/composables/useImageStyleLibrary'

useMsw()

function response(overrides: Partial<ImageStyleLibraryResponse> = {}): ImageStyleLibraryResponse {
  return {
    presets: {
      system: [
        {
          id: 'flat-editorial',
          source: 'system',
          name: '扁平编辑插画',
          description: '克制的编辑式插画',
          category: 'editorial',
          tags: ['flat'],
          order: 1,
          palettePolicy: 'template',
          previewUrl: '/api/image-style-presets/system/flat-editorial/preview',
          compatible: true,
        },
      ],
      user: [
        {
          id: 'user-1',
          source: 'user',
          name: '我的纸艺',
          description: '上次保存的纸艺风格',
          category: 'craft',
          tags: ['paper'],
          order: 1,
          palettePolicy: 'template',
          previewUrl: '/api/style-presets/user-1/image',
          compatible: true,
        },
      ],
    },
    generatedCandidates: [],
    active: { mode: 'undecided' },
    draw: {
      state: 'idle',
      jobId: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    },
    remainingExplorations: 3,
    ...overrides,
  }
}

afterEach(() => {
  useImageStyleLibrary().__resetForTesting()
})

async function openAndMount(
  options: { decisionPending?: boolean; hasImageLlm?: boolean; hasMainLlm?: boolean } = {},
) {
  const styles = useImageStyleLibrary()
  await styles.openLibrary(1, { decisionPending: options.decisionPending })
  const wrapper = mount(ImageStyleLibraryModal, {
    props: {
      disableTeleport: true,
      hasImageLlm: options.hasImageLlm ?? true,
      hasMainLlm: options.hasMainLlm ?? true,
    },
  })
  await flushPromises()
  return { styles, wrapper }
}

describe('ImageStyleLibraryModal', () => {
  it('默认展示系统预设，具备 dialog/tab/aria-pressed 语义', async () => {
    server.use(http.get('/api/decks/1/style-library', () => HttpResponse.json(response())))

    const { wrapper } = await openAndMount()
    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.get('[data-style-tab="system"]').attributes('aria-selected')).toBe('true')
    const apply = wrapper.get('button[aria-label="应用扁平编辑插画风格"]')
    expect(apply.attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('不产生模型调用')
  })

  it('切换到我的风格后渲染个人卡片与管理按钮', async () => {
    server.use(http.get('/api/decks/1/style-library', () => HttpResponse.json(response())))

    const { wrapper } = await openAndMount()
    await wrapper.get('[data-style-tab="user"]').trigger('click')
    expect(wrapper.text()).toContain('我的纸艺')
    expect(wrapper.find('button[aria-label="重命名风格"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="删除风格"]').exists()).toBe(true)
  })

  it('手动浏览 undecided deck 点关闭只关闭 UI，不会误切 free 或锁聊天', async () => {
    let freeCount = 0
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(response())),
      http.post('/api/decks/1/style-library/free', () => {
        freeCount += 1
        return HttpResponse.json({ ok: true })
      }),
    )

    const { styles, wrapper } = await openAndMount()
    await wrapper.get('[data-close-style-library]').trigger('click')
    expect(styles.open.value).toBe(false)
    expect(styles.decisionPending.value).toBe(false)
    expect(freeCount).toBe(0)
  })

  it('首次强制决策点关闭等价“暂不指定”，成功后解除等待', async () => {
    let active: ActiveImageStyle = { mode: 'undecided' }
    server.use(
      http.get('/api/decks/1/style-library', () => HttpResponse.json(response({ active }))),
      http.post('/api/decks/1/style-library/free', () => {
        active = { mode: 'free' }
        return HttpResponse.json({ ok: true })
      }),
    )

    const { styles, wrapper } = await openAndMount({ decisionPending: true })
    expect(wrapper.get('[data-close-style-library]').attributes('aria-label')).toContain('暂不指定')
    await wrapper.get('[data-close-style-library]').trigger('click')
    await flushPromises()
    expect(styles.open.value).toBe(false)
    expect(styles.decisionPending.value).toBe(false)
    expect(styles.active.value).toEqual({ mode: 'free' })
  })

  it('无模型仍可浏览预设，AI 探索页显示配置入口', async () => {
    server.use(http.get('/api/decks/1/style-library', () => HttpResponse.json(response())))
    const { wrapper } = await openAndMount({ hasImageLlm: false, hasMainLlm: false })
    expect(wrapper.text()).toContain('扁平编辑插画')
    await wrapper.get('[data-style-tab="explore"]').trigger('click')
    expect(wrapper.text()).toContain('需要先配置生图模型')
    await wrapper.get('button.button-secondary').trigger('click')
    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })

  it('AI 探索必须显式点击；完成后展示候选与保存按钮', async () => {
    let started = false
    let exploreCount = 0
    server.use(
      http.get('/api/decks/1/style-library', () =>
        HttpResponse.json(
          started
            ? response({
                generatedCandidates: [
                  {
                    assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    source: 'explore',
                    style: 'paper cut',
                    prompt: 'prompt',
                    palettePolicy: 'template',
                    previewUrl: '/api/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    compatible: true,
                  },
                ],
                draw: {
                  state: 'done',
                  jobId: 'job-1',
                  startedAt: '2026-07-11T00:00:00Z',
                  finishedAt: '2026-07-11T00:01:00Z',
                  error: null,
                },
                remainingExplorations: 2,
              })
            : response(),
        ),
      ),
      http.post('/api/decks/1/style-library/explore', () => {
        started = true
        exploreCount += 1
        return HttpResponse.json({ jobId: 'job-1', state: 'running' }, { status: 202 })
      }),
    )

    const { wrapper } = await openAndMount()
    expect(exploreCount).toBe(0)
    await wrapper.get('[data-style-tab="explore"]').trigger('click')
    await wrapper.get('[data-explore-styles]').trigger('click')
    await flushPromises()
    expect(exploreCount).toBe(1)
    expect(wrapper.text()).toContain('paper cut')
    expect(wrapper.find('button[aria-label*="保存paper cut"]').exists()).toBe(true)
  })
})
