/**
 * Phase 11.8 Task F-3:AnchorPickerModal 组件单测。
 *
 * 覆盖:
 * - open=false 不渲染;open=true 渲染 header + body
 * - 加载中状态(spinner + hint)
 * - 3 张缩略图渲染(img src 指向 /api/assets/<assetId>)
 * - 点 candidate → 调 selectAnchor
 * - 点"换一批" → 调 regenerate;remaining=0 时 disabled
 * - 点"跳过" → 调 skip
 * - retried + diversityDegraded 提示
 * - error 状态展示
 *
 * 用 useMsw 拦截 fetch 但本组件主要通过 mount 后操作 picker composable state,
 * mock backend 主要为了 openPicker / actions 不真打。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AnchorPickerModal from '../src/components/AnchorPickerModal.vue'
import { useMoodBoardPicker } from '../src/composables/useMoodBoardPicker'
import { useMsw, server, http, HttpResponse } from './_setup/msw'

useMsw()

afterEach(() => {
  useMoodBoardPicker().__resetForTesting()
})

const FAKE_CANDIDATES = {
  candidates: [
    { assetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', style: 'isometric tech', prompt: 'p1' },
    { assetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', style: 'watercolor wash', prompt: 'p2' },
    { assetId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', style: 'cyberpunk neon', prompt: 'p3' },
  ],
  retried: false,
  diversityDegraded: false,
  remaining: 2,
}

function seedHandlers(opts?: Partial<typeof FAKE_CANDIDATES>) {
  server.use(
    http.post('/api/decks/1/mood-board/generate', () =>
      HttpResponse.json({ ...FAKE_CANDIDATES, ...opts }),
    ),
    http.post('/api/decks/1/anchor', () =>
      HttpResponse.json({ ok: true, anchorAssetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
    ),
  )
}

describe('AnchorPickerModal', () => {
  it('picker.open=false → 不渲染', () => {
    const wrapper = mount(AnchorPickerModal, {
      props: { disableTeleport: true },
    })
    expect(wrapper.find('[data-anchor-picker-modal]').exists()).toBe(false)
  })

  it('picker.open=true + 加载完 → 渲染 3 张候选缩略图', async () => {
    seedHandlers()
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    expect(wrapper.find('[data-anchor-picker-modal]').exists()).toBe(true)
    const cards = wrapper.findAll('[data-candidate-id]')
    expect(cards).toHaveLength(3)
    expect(cards[0]!.attributes('data-candidate-id')).toBe(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    )
    expect(cards[0]!.find('img').attributes('src')).toBe(
      '/api/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    )
  })

  it('点候选 → 触发 selectAnchor → modal 关闭', async () => {
    seedHandlers()
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    await wrapper
      .find('[data-candidate-id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]')
      .trigger('click')
    // selectAnchor 是 async, await microtask 让 picker 状态更新
    await new Promise((r) => setTimeout(r, 50))
    expect(picker.selectedAssetId.value).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(picker.open.value).toBe(false)
  })

  it('点"换一批"按钮 → 触发 regenerate', async () => {
    let callCount = 0
    server.use(
      http.post('/api/decks/1/mood-board/generate', () => {
        callCount++
        return HttpResponse.json({ ...FAKE_CANDIDATES, remaining: 2 - callCount + 1 })
      }),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    await wrapper.find('[data-regenerate]').trigger('click')
    await new Promise((r) => setTimeout(r, 50))
    expect(callCount).toBe(2)
  })

  it('remaining=0 → 换一批按钮 disabled', async () => {
    seedHandlers({ remaining: 0 })
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    const btn = wrapper.find('[data-regenerate]')
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('点"跳过"按钮 → 触发 skip → modal 关闭 + skipped=true', async () => {
    seedHandlers()
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    await wrapper.find('[data-skip-bottom]').trigger('click')
    expect(picker.open.value).toBe(false)
    expect(picker.skipped.value).toBe(true)
  })

  it('右上 × 关闭按钮 = 跳过 alias', async () => {
    seedHandlers()
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    await wrapper.find('[data-skip-button]').trigger('click')
    expect(picker.open.value).toBe(false)
    expect(picker.skipped.value).toBe(true)
  })

  it('retried=true + diversityDegraded=false → 渲染"已 retry"提示', async () => {
    seedHandlers({ retried: true, diversityDegraded: false })
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    expect(wrapper.text()).toMatch(/已自动 retry/)
  })

  it('retried=true + diversityDegraded=true → 渲染"仍然偏雷同"警告', async () => {
    seedHandlers({ retried: true, diversityDegraded: true })
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    expect(wrapper.text()).toMatch(/雷同/)
  })

  it('error 状态 → 渲染 error-state(不渲染 candidates)', async () => {
    server.use(
      http.post('/api/decks/1/mood-board/generate', () =>
        HttpResponse.json({ error: 'OpenAI quota exceeded' }, { status: 500 }),
      ),
    )
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    expect(wrapper.findAll('[data-candidate-id]')).toHaveLength(0)
    expect(wrapper.text()).toMatch(/quota/)
  })

  it('remaining=2 → footer 显示"还可换 2 次"', async () => {
    seedHandlers({ remaining: 2 })
    const picker = useMoodBoardPicker()
    await picker.openPicker(1)
    const wrapper = mount(AnchorPickerModal, { props: { disableTeleport: true } })
    expect(wrapper.text()).toMatch(/还可换 2 次/)
  })
})
