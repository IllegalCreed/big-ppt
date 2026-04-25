import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import VersionTimeline from '../src/components/VersionTimeline.vue'
import { http, HttpResponse, server, useMsw } from './_setup/msw'

useMsw()

function mockVersions(arr: Array<{ id: number; turnId?: string | null; createdAt: string; message?: string }>) {
  return arr.map((v) => ({
    id: v.id,
    deckId: 1,
    turnId: v.turnId ?? null,
    authorId: 1,
    message: v.message ?? 'edit',
    createdAt: v.createdAt,
  }))
}

async function mountIt(props: { deckId: number; currentVersionId: number | null; open?: boolean; highlightVersionId?: number | null }) {
  const wrapper = mount(VersionTimeline, {
    props: { ...props, open: props.open ?? true },
  })
  await flushPromises()
  return wrapper
}

describe('VersionTimeline', () => {
  it('open=true 时拉 versions 并渲染 items', async () => {
    server.use(
      http.get('/api/decks/1/versions', () =>
        HttpResponse.json({
          versions: mockVersions([
            { id: 3, createdAt: '2026-04-23T10:00:00Z', message: '第三次' },
            { id: 2, createdAt: '2026-04-23T09:00:00Z', message: '第二次' },
            { id: 1, createdAt: '2026-04-23T08:00:00Z', message: 'initial' },
          ]),
        }),
      ),
    )
    const wrapper = await mountIt({ deckId: 1, currentVersionId: 3 })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('第三次')
    expect(text).toContain('第二次')
    expect(text).toContain('initial')
  })

  it('同 turnId 的连续版本被合并为一组，显示"同轮 N 次修改"', async () => {
    server.use(
      http.get('/api/decks/1/versions', () =>
        HttpResponse.json({
          versions: mockVersions([
            { id: 4, turnId: 'T1', createdAt: '2026-04-23T10:02:00Z' },
            { id: 3, turnId: 'T1', createdAt: '2026-04-23T10:01:00Z' },
            { id: 2, turnId: null, createdAt: '2026-04-23T10:00:00Z', message: 'init' },
          ]),
        }),
      ),
    )
    const wrapper = await mountIt({ deckId: 1, currentVersionId: 4 })
    await flushPromises()
    expect(wrapper.text()).toContain('同轮 2 次修改')
  })

  it('current version 渲染"当前"徽章，其他不渲染"回滚"按钮', async () => {
    server.use(
      http.get('/api/decks/1/versions', () =>
        HttpResponse.json({
          versions: mockVersions([
            { id: 2, createdAt: '2026-04-23T10:01:00Z' },
            { id: 1, createdAt: '2026-04-23T10:00:00Z', message: 'init' },
          ]),
        }),
      ),
    )
    const wrapper = await mountIt({ deckId: 1, currentVersionId: 2 })
    await flushPromises()
    expect(wrapper.text()).toContain('当前')
    // 只有非 current 的才有 回滚 按钮
    const restoreBtns = wrapper.findAll('button').filter((b) => b.text().includes('回滚'))
    expect(restoreBtns.length).toBe(1)
  })

  it('点击"回滚"按钮调 POST /api/decks/:id/restore/:vid 并 emit restored', async () => {
    let restoreCalled: number | null = null
    server.use(
      http.get('/api/decks/1/versions', () =>
        HttpResponse.json({
          versions: mockVersions([
            { id: 2, createdAt: '2026-04-23T10:01:00Z' },
            { id: 1, createdAt: '2026-04-23T10:00:00Z', message: 'init' },
          ]),
        }),
      ),
      http.post('/api/decks/1/restore/:vid', ({ params }) => {
        restoreCalled = Number(params.vid)
        return HttpResponse.json({ version: { id: restoreCalled, content: 'x', createdAt: '2026-04-23T10:00:00Z' } })
      }),
    )
    const wrapper = await mountIt({ deckId: 1, currentVersionId: 2 })
    await flushPromises()

    const restoreBtn = wrapper.findAll('button').find((b) => b.text().includes('回滚'))!
    await restoreBtn.trigger('click')
    await flushPromises()
    expect(restoreCalled).toBe(1)
    expect(wrapper.emitted('restored')).toEqual([[1]])
  })

  it('close 按钮 emit close 事件', async () => {
    server.use(http.get('/api/decks/1/versions', () => HttpResponse.json({ versions: [] })))
    const wrapper = await mountIt({ deckId: 1, currentVersionId: null })
    await flushPromises()
    // X 图标的关闭按钮
    const closeBtn = wrapper.find('button[aria-label="关闭"]')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('highlightVersionId 传入时该行加 data-highlighted=true', async () => {
    server.use(
      http.get('/api/decks/1/versions', () =>
        HttpResponse.json({
          versions: mockVersions([
            { id: 5, createdAt: '2026-04-25T10:00:00Z' },
            { id: 4, createdAt: '2026-04-25T09:59:00Z' },
          ]),
        }),
      ),
    )
    const wrapper = await mountIt({
      deckId: 1,
      currentVersionId: 5,
      highlightVersionId: 4,
    })
    await flushPromises()
    const highlighted = wrapper.findAll('[data-highlighted="true"]')
    expect(highlighted.length).toBe(1)
  })
})
