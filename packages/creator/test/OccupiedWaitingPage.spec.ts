import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import OccupiedWaitingPage from '../src/components/OccupiedWaitingPage.vue'
import { http, HttpResponse, server, useMsw } from './_setup/msw'

useMsw()

const holder = {
  sessionId: 'other-sid',
  userId: 99,
  email: 'other@a.com',
  deckId: 1,
  deckTitle: '别人的 Deck',
  lockedAt: new Date(Date.now() - 60_000).toISOString(),
  lastHeartbeatAt: new Date(Date.now() - 5_000).toISOString(),
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/decks', component: { template: '<div/>' } },
    ],
  })
}

async function mountIt() {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  return mount(OccupiedWaitingPage, {
    props: { initialHolder: holder, deckId: 1 },
    global: { plugins: [router] },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OccupiedWaitingPage', () => {
  it('渲染 holder.email / holder.deckTitle', async () => {
    const wrapper = await mountIt()
    expect(wrapper.text()).toContain('other@a.com')
    expect(wrapper.text()).toContain('别人的 Deck')
  })

  it('每 5s 轮询 /api/lock-status；锁释放后 emit lock-released', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    server.use(
      http.get('/api/lock-status', () =>
        HttpResponse.json({ locked: true, holder, isMe: false }),
      ),
    )
    const wrapper = await mountIt()

    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(wrapper.emitted('lock-released')).toBeUndefined()

    // 锁释放
    server.use(http.get('/api/lock-status', () => HttpResponse.json({ locked: false })))
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    expect(wrapper.emitted('lock-released')).toBeTruthy()
  })

  it('"立即重试"按钮触发一次轮询', async () => {
    let hits = 0
    server.use(
      http.get('/api/lock-status', () => {
        hits++
        return HttpResponse.json({ locked: true, holder, isMe: false })
      }),
    )
    const wrapper = await mountIt()
    await flushPromises()
    const hitsBefore = hits

    const retryBtn = wrapper.findAll('button').find((b) => b.text().includes('立即重试'))
    expect(retryBtn).toBeTruthy()
    await retryBtn!.trigger('click')
    await flushPromises()
    expect(hits).toBe(hitsBefore + 1)
  })

  it('"返回列表"按钮推到 /decks', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(OccupiedWaitingPage, {
      props: { initialHolder: holder, deckId: 1 },
      global: { plugins: [router] },
    })
    const backBtn = wrapper.findAll('button').find((b) => b.text().includes('返回列表'))
    expect(backBtn).toBeTruthy()
    await backBtn!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/decks')
  })

  it('unmount 清 setInterval，不再触发轮询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let hits = 0
    server.use(
      http.get('/api/lock-status', () => {
        hits++
        return HttpResponse.json({ locked: true, holder, isMe: false })
      }),
    )
    const wrapper = await mountIt()
    await vi.advanceTimersByTimeAsync(5_000)
    await flushPromises()
    const afterFirst = hits

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(20_000)
    await flushPromises()
    expect(hits).toBe(afterFirst) // 没增加
  })
})
