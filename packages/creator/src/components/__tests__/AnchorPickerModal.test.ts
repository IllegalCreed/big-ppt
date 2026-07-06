/**
 * AnchorPickerModal 组件单测（2026-07 dogfood）。
 *
 * 焦点:生成风格图期间(loading)「暂不指定风格」按钮必须可点——用户想直接走默认风格兜底,
 * 不该被逼等 3 张样张生成完(约几分钟)。skip() 本身无 loading 守卫,只是按钮 UI 之前被
 * `:disabled="loading"` 一刀切禁掉了。
 *
 * 走 ExportModal.test.ts 套路:mock composable 注入可控 ref + attachTo body + querySelector。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import type { MoodBoardCandidate } from '@big-ppt/shared'

const open = ref(true)
const loading = ref(false)
const candidates = ref<MoodBoardCandidate[]>([])
const error = ref<string | null>(null)
const retried = ref(false)
const diversityDegraded = ref(false)
const remainingGenerations = ref(2)
const selectedAssetId = ref<string | null>(null)
const canRegenerate = ref(false)
const primaryActionMode = computed<'clear' | 'skip'>(() =>
  selectedAssetId.value !== null ? 'clear' : 'skip',
)
const triggerPrimaryAction = vi.fn()

vi.mock('../../composables/useMoodBoardPicker', () => ({
  useMoodBoardPicker: () => ({
    open,
    loading,
    candidates,
    error,
    retried,
    diversityDegraded,
    remainingGenerations,
    selectedAssetId,
    canRegenerate,
    primaryActionMode,
    selectAnchor: vi.fn(),
    regenerate: vi.fn(),
    triggerPrimaryAction,
    closePicker: vi.fn(),
  }),
}))

import AnchorPickerModal from '../AnchorPickerModal.vue'

function $(sel: string): HTMLElement | null {
  return document.body.querySelector(sel) as HTMLElement | null
}

function resetState(): void {
  open.value = true
  loading.value = false
  candidates.value = []
  error.value = null
  selectedAssetId.value = null
  remainingGenerations.value = 2
  triggerPrimaryAction.mockClear()
}

afterEach(() => {
  document.body.innerHTML = ''
  resetState()
})

describe('AnchorPickerModal 跳过按钮', () => {
  it('生成中(loading)且未选风格 → 「暂不指定风格」可点(不禁用)', () => {
    resetState()
    loading.value = true // 3 张样张生成中
    selectedAssetId.value = null // skip 模式
    mount(AnchorPickerModal, { attachTo: document.body, props: { disableTeleport: true } })

    const btn = $('[data-primary-action]') as HTMLButtonElement | null
    expect(btn).toBeTruthy()
    expect(btn!.disabled).toBe(false) // 关键:生成中也能跳过
    expect(btn!.textContent).toContain('暂不指定风格')
  })

  it('点击生成中的跳过按钮 → triggerPrimaryAction 被调(走 skip)', async () => {
    resetState()
    loading.value = true
    mount(AnchorPickerModal, { attachTo: document.body, props: { disableTeleport: true } })

    const btn = $('[data-primary-action]') as HTMLButtonElement
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(triggerPrimaryAction).toHaveBeenCalledOnce()
  })

  it('已选风格(clear 模式)+ loading 中 → 「取消风格限制」仍禁用(防清除操作双击)', () => {
    resetState()
    loading.value = true
    selectedAssetId.value = 'asset-1' // clear 模式
    mount(AnchorPickerModal, { attachTo: document.body, props: { disableTeleport: true } })

    const btn = $('[data-primary-action]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('取消风格限制')
  })
})
