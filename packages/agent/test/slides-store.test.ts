/**
 * Phase 15.x P0 security hotfix(2026-05-18):slides-store 改 DB-based 后,本测重写为
 * useTestDb + ALS `runInRequest` 真 DB 跑;不再 mock fs。
 *
 * 每个 test case 调 `createLoggedInUser + createDeckDirect` 拿 deck/user,然后用
 * `runInRequest({userId, activeDeckId, turnId})` 包住对 readSlides / writeSlides /
 * createSlide / updateSlide / deleteSlide / reorderSlides / editSlides / restoreSlides /
 * redoSlides 的调用。
 *
 * 关键性质覆盖:
 * - read/write 基本通路
 * - undo / redo (DB ring buffer)
 * - 同 turn 合并(turnId 相同 → 覆盖同行)
 * - 跨 turn 截断 redo 栈
 * - ring buffer 裁剪(BIG_PPT_HISTORY_MAX)
 * - 四件套(create / update / delete / reorder)+ history 集成
 * - **跨用户访问 deck → NoActiveDeckError**(P0 漏洞修复核心断言)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSlide,
  deleteSlide,
  editSlides,
  readSlides,
  redoSlides,
  reorderSlides,
  restoreSlides,
  updateSlide,
  writeSlides,
  NoActiveDeckError,
} from '../src/slides-store/index.js'
import { listHistoryDb } from '../src/slides-store/history.js'
import { runInRequest, type RequestContext } from '../src/context.js'
import { parseSlides } from '../src/slides-store/pages.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'

useTestDb()

function ctxOf(overrides: Partial<RequestContext>): RequestContext {
  return { userId: null, sessionId: null, activeDeckId: null, turnId: null, ...overrides }
}

/** 给 test 用的便捷 helper:在 (userId, deckId) 上下文里跑 fn */
function inDeck<T>(userId: number, deckId: number, fn: () => Promise<T>, turnId?: string): Promise<T> {
  return runInRequest(ctxOf({ userId, activeDeckId: deckId, turnId: turnId ?? null }), fn) as Promise<T>
}

beforeEach(() => {
  delete process.env.BIG_PPT_HISTORY_MAX
})

afterEach(() => {
  delete process.env.BIG_PPT_HISTORY_MAX
})

describe('slides-store DB-based(P0 fix)', () => {
  describe('read/write', () => {
    it('readSlides 拿当前 deck 的 currentVersion.content', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      const content = await inDeck(user.id, deck.id, () => readSlides())
      expect(content).toBe('v1')
    })

    it('writeSlides 走 starter→真实首次生成路径,后续 readSlides 反映新内容', async () => {
      const { user } = await createLoggedInUser()
      const starter = '---\nlayout: cover\nmainTitle: 请填写标题\nsubtitle: 请填写副标题\ndate: YYYY/MM/DD\n---\n'
      const { deck } = await createDeckDirect(user.id, 'D', starter)
      const r = await inDeck(user.id, deck.id, () => writeSlides('---\nlayout: cover\nmainTitle: real\n---\n'))
      expect(r.success).toBe(true)
      expect(await inDeck(user.id, deck.id, () => readSlides())).toContain('real')
      expect(await inDeck(user.id, deck.id, () => readSlides())).not.toContain('请填写标题')
    })

    it('writeSlides 护栏:已有真实内容时拒绝整体覆盖', async () => {
      const { user } = await createLoggedInUser()
      const real =
        '---\nlayout: cover\nmainTitle: 真实标题\n---\n\n# P1\n\n---\nlayout: content\nheading: 二\n---\n\n# P2\n'
      const { deck } = await createDeckDirect(user.id, 'D', real)
      const r = await inDeck(user.id, deck.id, () => writeSlides('---\nlayout: cover\nmainTitle: X\n---\n'))
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/已有 2 页/)
    })

    it('无 ALS deckId / userId → readSlides throw NoActiveDeckError', async () => {
      await expect(readSlides()).rejects.toThrow(NoActiveDeckError)
    })

    it('IDOR:用户 B 用 A 的 deckId → readSlides throw', async () => {
      const a = await createLoggedInUser('a@a.com')
      const b = await createLoggedInUser('b@a.com')
      const { deck } = await createDeckDirect(a.user.id, 'A-deck', 'secret-content')
      await expect(inDeck(b.user.id, deck.id, () => readSlides())).rejects.toThrow(NoActiveDeckError)
    })
  })

  describe('editSlides', () => {
    it('替换唯一匹配字符串', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', '# Title\n\n- apple\n- banana\n')
      const r = await inDeck(user.id, deck.id, () => editSlides('banana', 'cherry'))
      expect(r.success).toBe(true)
      const c = await inDeck(user.id, deck.id, () => readSlides())
      expect(c).toContain('- cherry')
      expect(c).not.toContain('banana')
    })

    it('多处匹配 → 拒收', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'foo\nfoo\nfoo')
      const r = await inDeck(user.id, deck.id, () => editSlides('foo', 'bar'))
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/3 处匹配/)
    })

    it('无匹配 → 给相似建议', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'the quick brown fox\nanother line')
      const r = await inDeck(user.id, deck.id, () => editSlides('the quikc brown fox', 'replaced'))
      expect(r.success).toBe(false)
      expect(r.error).toContain('the quick brown fox')
    })

    it('空 old_string 拒收', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'x')
      const r = await inDeck(user.id, deck.id, () => editSlides('', 'y'))
      expect(r.success).toBe(false)
    })
  })

  describe('undo / redo', () => {
    it('undo 回到上一版本', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      // 用 editSlides 串字符串替换路径(避开 writeSlides 的"已有页"护栏)
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v2')
      await inDeck(user.id, deck.id, () => restoreSlides())
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v1')
    })

    it('undo + redo 走回最新', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      await inDeck(user.id, deck.id, () => restoreSlides())
      const r = await inDeck(user.id, deck.id, () => redoSlides())
      expect(r.success).toBe(true)
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v2')
    })

    it('连续 undo 一步步往回', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      await inDeck(user.id, deck.id, () => editSlides('v2', 'v3'))
      await inDeck(user.id, deck.id, () => restoreSlides())
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v2')
      await inDeck(user.id, deck.id, () => restoreSlides())
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v1')
    })

    it('undo 到最早 → 再 undo 返 error', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      await inDeck(user.id, deck.id, () => restoreSlides()) // → v1
      const r = await inDeck(user.id, deck.id, () => restoreSlides())
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/最早/)
    })

    it('redo 栈空时返 error', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      const r = await inDeck(user.id, deck.id, () => redoSlides())
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/最新/)
    })

    it('新写截断 redo 栈', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      await inDeck(user.id, deck.id, () => editSlides('v2', 'v3'))
      await inDeck(user.id, deck.id, () => restoreSlides()) // → v2
      await inDeck(user.id, deck.id, () => restoreSlides()) // → v1
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v4')) // truncates v2/v3
      const hist = await inDeck(user.id, deck.id, () => listHistoryDb())
      expect(hist.ids.length).toBe(2) // [v1, v4]
      const r = await inDeck(user.id, deck.id, () => redoSlides())
      expect(r.success).toBe(false)
    })

    it('ring buffer 裁掉最旧', async () => {
      process.env.BIG_PPT_HISTORY_MAX = '3'
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2')) // [v1,v2]
      await inDeck(user.id, deck.id, () => editSlides('v2', 'v3')) // [v1,v2,v3]
      await inDeck(user.id, deck.id, () => editSlides('v3', 'v4')) // trim v1 → [v2,v3,v4]
      const hist = await inDeck(user.id, deck.id, () => listHistoryDb())
      expect(hist.ids.length).toBe(3)
      await inDeck(user.id, deck.id, () => restoreSlides()) // v4 → v3
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v3')
      await inDeck(user.id, deck.id, () => restoreSlides()) // v3 → v2
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v2')
      const r = await inDeck(user.id, deck.id, () => restoreSlides()) // 最旧 v1 已 trim
      expect(r.success).toBe(false)
    })

    it('undo 返 position', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v1')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'))
      await inDeck(user.id, deck.id, () => editSlides('v2', 'v3'))
      const r = await inDeck(user.id, deck.id, () => restoreSlides())
      expect(r.success).toBe(true)
      expect(r.position).toEqual({ index: 2, total: 3 })
    })
  })

  describe('turn-based aggregation', () => {
    it('同 turnId 多次写合并成一条 history', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v0')
      await inDeck(
        user.id,
        deck.id,
        async () => {
          await editSlides('v0', 'v1')
          await editSlides('v1', 'v2')
          await editSlides('v2', 'v3')
        },
        'turn-a',
      )
      const hist = await inDeck(user.id, deck.id, () => listHistoryDb())
      // 初始 v0 + turn-a 合并后一条 = 2 行
      expect(hist.ids.length).toBe(2)
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v3')
    })

    it('不同 turnId 分别建条', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v0')
      await inDeck(user.id, deck.id, () => editSlides('v0', 'v1'), 'turn-a')
      await inDeck(user.id, deck.id, () => editSlides('v1', 'v2'), 'turn-b')
      await inDeck(user.id, deck.id, () => editSlides('v2', 'v3'), 'turn-c')
      const hist = await inDeck(user.id, deck.id, () => listHistoryDb())
      expect(hist.ids.length).toBe(4) // init + 3 turns
    })

    it('一次 undo 回退整个聚合 turn', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', 'v0')
      await inDeck(
        user.id,
        deck.id,
        async () => {
          await editSlides('v0', 'v1')
          await editSlides('v1', 'v2') // 同 turn → 覆盖,而非新增
        },
        'turn-a',
      )
      const r = await inDeck(user.id, deck.id, () => restoreSlides())
      expect(r.success).toBe(true)
      expect(await inDeck(user.id, deck.id, () => readSlides())).toBe('v0')
    })
  })

  describe('四件套 create/update/delete/reorder', () => {
    const twoPageMd =
      '---\nlayout: cover\nmainTitle: hi\n---\n\n# P1\n\n---\nlayout: content\nheading: Second\n---\n\n# P2\n'

    it('createSlide append', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      const r = await inDeck(user.id, deck.id, () =>
        createSlide({ layout: 'content', frontmatter: { heading: 'New' }, body: '# New' }),
      )
      expect(r.success).toBe(true)
      expect(r.index).toBe(3)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages.length).toBe(3)
      expect(pages[2]!.frontmatter.heading).toBe('New')
    })

    it('createSlide 插入中间', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      const r = await inDeck(user.id, deck.id, () =>
        createSlide({ index: 2, layout: 'content', frontmatter: { heading: 'Middle' }, body: '# M' }),
      )
      expect(r.success).toBe(true)
      expect(r.index).toBe(2)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages.length).toBe(3)
      expect(pages[0]!.frontmatter.mainTitle).toBe('hi')
      expect(pages[1]!.frontmatter.heading).toBe('Middle')
      expect(pages[2]!.frontmatter.heading).toBe('Second')
    })

    it('createSlide index 超范围拒收', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      const r = await inDeck(user.id, deck.id, () => createSlide({ index: 99, layout: 'content', body: 'x' }))
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/超出范围/)
    })

    it('updateSlide 合并 frontmatter', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      const r = await inDeck(user.id, deck.id, () =>
        updateSlide({ index: 2, frontmatter: { heading: 'Renamed' } }),
      )
      expect(r.success).toBe(true)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages[1]!.frontmatter.heading).toBe('Renamed')
      expect(pages[1]!.frontmatter.layout).toBe('content')
    })

    it('updateSlide replaceFrontmatter=true 完全替换', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      const r = await inDeck(user.id, deck.id, () =>
        updateSlide({
          index: 2,
          frontmatter: { layout: 'two-col', heading: 'N', leftTitle: 'L', rightTitle: 'R' },
          replaceFrontmatter: true,
        }),
      )
      expect(r.success).toBe(true)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages[1]!.frontmatter).toEqual({
        layout: 'two-col',
        heading: 'N',
        leftTitle: 'L',
        rightTitle: 'R',
      })
    })

    it('updateSlide 仅替换 body', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      const r = await inDeck(user.id, deck.id, () => updateSlide({ index: 1, body: '# New P1 Body' }))
      expect(r.success).toBe(true)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages[0]!.body.trim()).toBe('# New P1 Body')
      expect(pages[0]!.frontmatter.mainTitle).toBe('hi')
    })

    it('deleteSlide 删中间页', async () => {
      const { user } = await createLoggedInUser()
      const threePageMd = twoPageMd + '\n---\nlayout: back-cover\n---\n\n# P3\n'
      const { deck } = await createDeckDirect(user.id, 'D', threePageMd)
      const r = await inDeck(user.id, deck.id, () => deleteSlide(2))
      expect(r.success).toBe(true)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages.length).toBe(2)
      expect(pages[0]!.frontmatter.mainTitle).toBe('hi')
      expect(pages[1]!.frontmatter.layout).toBe('back-cover')
    })

    it('deleteSlide 仅剩一页时拒收', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', '---\nlayout: cover\n---\n\n# lone\n')
      const r = await inDeck(user.id, deck.id, () => deleteSlide(1))
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/最后一页/)
    })

    it('reorderSlides 合法排列', async () => {
      const { user } = await createLoggedInUser()
      const fourPageMd =
        '---\na: 1\n---\n\n# A\n\n---\na: 2\n---\n\n# B\n\n---\na: 3\n---\n\n# C\n\n---\na: 4\n---\n\n# D\n'
      const { deck } = await createDeckDirect(user.id, 'D', fourPageMd)
      const r = await inDeck(user.id, deck.id, () => reorderSlides([4, 2, 3, 1]))
      expect(r.success).toBe(true)
      const pages = parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages
      expect(pages.map((p) => p.frontmatter.a)).toEqual([4, 2, 3, 1])
    })

    it('reorderSlides 长度错 / 重复 / 越界 → 拒收', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      expect((await inDeck(user.id, deck.id, () => reorderSlides([1]))).success).toBe(false)
      expect((await inDeck(user.id, deck.id, () => reorderSlides([1, 1]))).success).toBe(false)
      expect((await inDeck(user.id, deck.id, () => reorderSlides([1, 3]))).success).toBe(false)
    })

    it('四件套 与 history 集成:createSlide → undo 回滚页数', async () => {
      const { user } = await createLoggedInUser()
      const { deck } = await createDeckDirect(user.id, 'D', twoPageMd)
      await inDeck(user.id, deck.id, () => createSlide({ layout: 'content', body: '# third' }))
      expect(parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages.length).toBe(3)
      await inDeck(user.id, deck.id, () => restoreSlides())
      expect(parseSlides(await inDeck(user.id, deck.id, () => readSlides())).pages.length).toBe(2)
    })
  })

  describe('P0 漏洞修复 — 跨用户 / 跨 deck 串扰防护', () => {
    it('user A 写后 user B 读 A 的 deckId → 拒(NoActiveDeckError),不串扰', async () => {
      const a = await createLoggedInUser('a@a.com')
      const b = await createLoggedInUser('b@a.com')
      const { deck: aDeck } = await createDeckDirect(a.user.id, 'A-deck', 'a-secret')
      const { deck: bDeck } = await createDeckDirect(b.user.id, 'B-deck', 'b-content')

      // A 写
      await inDeck(a.user.id, aDeck.id, () => editSlides('a-secret', 'a-NEW'))
      // B 读自己的 deck → 拿自己的内容,不受 A 写入污染
      const bContent = await inDeck(b.user.id, bDeck.id, () => readSlides())
      expect(bContent).toBe('b-content')

      // B 用 A 的 deckId 来 read → throw(IDOR)
      await expect(inDeck(b.user.id, aDeck.id, () => readSlides())).rejects.toThrow(NoActiveDeckError)
      await expect(inDeck(b.user.id, aDeck.id, () => writeSlides('hack'))).rejects.toThrow(NoActiveDeckError)
      await expect(inDeck(b.user.id, aDeck.id, () => editSlides('a-NEW', 'hack'))).rejects.toThrow(
        NoActiveDeckError,
      )
    })

    it('user A 切到 user B 的 deck 后,readSlides 拿到的是 B 自己的当前内容', async () => {
      // 这条断言不同 deck 之间 read 完全独立,不存在"全局共享 slides.md"残留
      const a = await createLoggedInUser('a@a.com')
      const b = await createLoggedInUser('b@a.com')
      const { deck: aDeck } = await createDeckDirect(a.user.id, 'A-deck', 'a-content')
      const { deck: bDeck } = await createDeckDirect(b.user.id, 'B-deck', 'b-content')
      await inDeck(a.user.id, aDeck.id, () => editSlides('a-content', 'a-V2'))
      expect(await inDeck(b.user.id, bDeck.id, () => readSlides())).toBe('b-content')
      expect(await inDeck(a.user.id, aDeck.id, () => readSlides())).toBe('a-V2')
    })
  })
})
