import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShareModal from '../ShareModal.vue'

const getDeckShare = vi.fn()
const createDeckShare = vi.fn()
const revokeDeckShare = vi.fn()

vi.mock('../../api/sharing', () => ({
  getDeckShare: (...args: unknown[]) => getDeckShare(...args),
  createDeckShare: (...args: unknown[]) => createDeckShare(...args),
  revokeDeckShare: (...args: unknown[]) => revokeDeckShare(...args),
}))

const activeShare = {
  slug: 'slug-1',
  path: '/share/slug-1',
  status: 'active' as const,
  expiresAt: null,
  revokedAt: null,
  accessCount: 3,
  lastAccessedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('ShareModal', () => {
  beforeEach(() => {
    getDeckShare.mockReset().mockResolvedValue(null)
    createDeckShare.mockReset().mockResolvedValue(activeShare)
    revokeDeckShare.mockReset().mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('首次创建链接并显示复制入口', async () => {
    const wrapper = mount(ShareModal, {
      attachTo: document.body,
      props: { open: true, deckId: 7, deckTitle: 'Roadmap' },
    })
    await flushPromises()
    const createButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('创建链接'),
    ) as HTMLButtonElement
    createButton.click()
    await flushPromises()

    expect(createDeckShare).toHaveBeenCalledWith(7, 7)
    expect(document.body.querySelector('input[aria-label="分享链接"]')).not.toBeNull()
    expect(document.body.textContent).toContain('访问 3 次')
    wrapper.unmount()
  })

  it('活动链接可撤销并重新加载状态', async () => {
    getDeckShare.mockResolvedValueOnce(activeShare).mockResolvedValueOnce({
      ...activeShare,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
    })
    const wrapper = mount(ShareModal, {
      attachTo: document.body,
      props: { open: true, deckId: 8, deckTitle: 'Demo' },
    })
    await flushPromises()
    const revokeButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('撤销'),
    ) as HTMLButtonElement | undefined
    expect(revokeButton).toBeDefined()
    revokeButton!.click()
    await flushPromises()

    expect(revokeDeckShare).toHaveBeenCalledWith(8)
    expect(document.body.textContent).toContain('已撤销')
    wrapper.unmount()
  })

  it('切换 deck 时立即清空旧链接，等待新分享状态返回', async () => {
    let resolveNext: ((share: typeof activeShare) => void) | undefined
    getDeckShare.mockResolvedValueOnce(activeShare).mockImplementationOnce(
      () =>
        new Promise<typeof activeShare>((resolve) => {
          resolveNext = resolve
        }),
    )
    const wrapper = mount(ShareModal, {
      attachTo: document.body,
      props: { open: true, deckId: 7, deckTitle: 'First' },
    })
    await flushPromises()
    expect(document.body.querySelector('input[aria-label="分享链接"]')).not.toBeNull()

    await wrapper.setProps({ deckId: 9, deckTitle: 'Second' })
    expect(document.body.querySelector('input[aria-label="分享链接"]')).toBeNull()
    expect(document.body.textContent).toContain('加载中...')

    resolveNext?.({ ...activeShare, slug: 'slug-2', path: '/share/slug-2' })
    await flushPromises()
    expect(getDeckShare).toHaveBeenLastCalledWith(9)
    expect(
      document.body.querySelector<HTMLInputElement>('input[aria-label="分享链接"]')?.value,
    ).toContain('/share/slug-2')
    wrapper.unmount()
  })
})
