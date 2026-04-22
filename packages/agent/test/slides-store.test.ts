import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetPathsForTesting } from '../src/workspace.js'
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
} from '../src/slides-store/index.js'
import { listHistory, runInTurn } from '../src/slides-store/history.js'
import { parseSlides } from '../src/slides-store/pages.js'

let tmpDir: string
let slidesPath: string
let historyDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slides-'))
  slidesPath = path.join(tmpDir, 'slides.md')
  historyDir = path.join(tmpDir, 'history')
  process.env.BIG_PPT_SLIDES_PATH = slidesPath
  process.env.BIG_PPT_HISTORY_DIR = historyDir
  __resetPathsForTesting()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.BIG_PPT_SLIDES_PATH
  delete process.env.BIG_PPT_HISTORY_DIR
  delete process.env.BIG_PPT_HISTORY_MAX
  __resetPathsForTesting()
})

describe('read/write', () => {
  it('writeSlides writes content and records history snapshots', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    const r = writeSlides('v2')
    expect(r.success).toBe(true)
    expect(readSlides()).toBe('v2')
    const hist = listHistory()
    expect(hist.files.length).toBe(2) // [init v1, write v2]
    expect(hist.currentIndex).toBe(1)
  })

  it('writeSlides on empty slides path records only the new snapshot', () => {
    const r = writeSlides('first')
    expect(r.success).toBe(true)
    expect(readSlides()).toBe('first')
    const hist = listHistory()
    expect(hist.files.length).toBe(1)
    expect(hist.currentIndex).toBe(0)
  })

  it('writeSlides 护栏：slides.md 已有页时拒绝', () => {
    fs.writeFileSync(
      slidesPath,
      '---\nlayout: cover\n---\n\n# P1\n\n---\nlayout: content\n---\n\n# P2\n',
      'utf-8',
    )
    const r = writeSlides('---\nlayout: cover\n---\n\n# overwrite\n')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/已有 2 页/)
    // 文件未被改动
    expect(readSlides()).toContain('P1')
    expect(readSlides()).toContain('P2')
  })
})

describe('editSlides', () => {
  it('replaces a uniquely-matching substring', () => {
    fs.writeFileSync(slidesPath, '# Title\n\n- apple\n- banana\n', 'utf-8')
    const r = editSlides('banana', 'cherry')
    expect(r.success).toBe(true)
    expect(readSlides()).toContain('- cherry')
    expect(readSlides()).not.toContain('banana')
  })

  it('rejects empty old_string', () => {
    fs.writeFileSync(slidesPath, 'x', 'utf-8')
    const r = editSlides('', 'y')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/不能为空/)
  })

  it('returns similarity suggestions when no match', () => {
    fs.writeFileSync(slidesPath, 'the quick brown fox\nanother line', 'utf-8')
    const r = editSlides('the quikc brown fox', 'replaced')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/未找到指定内容/)
    expect(r.error).toContain('the quick brown fox')
  })

  it('reports ambiguity when multiple matches exist', () => {
    fs.writeFileSync(slidesPath, 'foo\nfoo\nfoo', 'utf-8')
    const r = editSlides('foo', 'bar')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/3 处匹配/)
  })
})

describe('undo / redo', () => {
  it('undo (restoreSlides) reverts to previous version', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    const r = restoreSlides()
    expect(r.success).toBe(true)
    expect(readSlides()).toBe('v1')
  })

  it('undo + redo goes back to latest version', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    restoreSlides()
    const r = redoSlides()
    expect(r.success).toBe(true)
    expect(readSlides()).toBe('v2')
  })

  it('consecutive undo steps back through versions', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    writeSlides('v3')
    restoreSlides() // v3 → v2
    expect(readSlides()).toBe('v2')
    restoreSlides() // v2 → v1
    expect(readSlides()).toBe('v1')
  })

  it('undo beyond earliest returns error', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    restoreSlides() // → v1
    const r = restoreSlides() // already earliest
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/最早/)
  })

  it('redo on empty redo stack returns error', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    const r = redoSlides()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/最新/)
  })

  it('new write truncates redo stack', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    writeSlides('v3') // files: [v1, v2, v3], idx=2
    restoreSlides() // idx=1
    restoreSlides() // idx=0
    writeSlides('v4') // truncates v2/v3, appends v4 → [v1, v4], idx=1
    const hist = listHistory()
    expect(hist.files.length).toBe(2)
    expect(hist.currentIndex).toBe(1)
    const r = redoSlides()
    expect(r.success).toBe(false)
  })

  it('ring buffer trims oldest when over limit', () => {
    process.env.BIG_PPT_HISTORY_MAX = '3'
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2') // [v1, v2], idx=1
    writeSlides('v3') // [v1, v2, v3], idx=2
    writeSlides('v4') // trim v1 → [v2, v3, v4], idx=2
    expect(listHistory().files.length).toBe(3)
    restoreSlides() // v4 → v3
    expect(readSlides()).toBe('v3')
    restoreSlides() // v3 → v2
    expect(readSlides()).toBe('v2')
    const r = restoreSlides() // already earliest (v1 was trimmed)
    expect(r.success).toBe(false)
  })

  it('undo after editSlides restores pre-edit content', () => {
    fs.writeFileSync(slidesPath, 'apple\nbanana\n', 'utf-8')
    editSlides('banana', 'cherry')
    expect(readSlides()).toBe('apple\ncherry\n')
    restoreSlides()
    expect(readSlides()).toBe('apple\nbanana\n')
  })

  it('undo returns position info (index/total)', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    writeSlides('v3') // files: [v1, v2, v3]
    const r = restoreSlides()
    expect(r.success).toBe(true)
    expect(r.position).toEqual({ index: 2, total: 3 })
    expect(r.message).toContain('第 2 / 3')
  })
})

describe('turn-based aggregation (轮次聚合)', () => {
  it('same turnId merges consecutive writes into one history entry', () => {
    fs.writeFileSync(slidesPath, 'v0', 'utf-8')
    runInTurn('turn-a', () => {
      writeSlides('v1')
      writeSlides('v2')
      writeSlides('v3')
    })
    // files: [init v0, turn-a (holds v3 via overwrite)]
    const hist = listHistory()
    expect(hist.files.length).toBe(2)
    expect(hist.currentIndex).toBe(1)
    expect(hist.lastTurnId).toBe('turn-a')
    expect(readSlides()).toBe('v3')
  })

  it('different turnIds create separate history entries', () => {
    fs.writeFileSync(slidesPath, 'v0', 'utf-8')
    runInTurn('turn-a', () => writeSlides('v1'))
    runInTurn('turn-b', () => writeSlides('v2'))
    runInTurn('turn-c', () => writeSlides('v3'))
    const hist = listHistory()
    expect(hist.files.length).toBe(4) // init + 3 turns
    expect(hist.currentIndex).toBe(3)
  })

  it('one undo rolls back entire aggregated turn', () => {
    fs.writeFileSync(slidesPath, 'v0', 'utf-8')
    runInTurn('turn-a', () => {
      writeSlides('v1')
      writeSlides('v2') // merged with v1 under turn-a
    })
    const r = restoreSlides()
    expect(r.success).toBe(true)
    expect(readSlides()).toBe('v0') // 一次 undo 就回到最初，而不是 v1 中间态
    expect(r.position).toEqual({ index: 1, total: 2 })
  })

  it('undo clears lastTurnId so next write in same turn starts new entry', () => {
    fs.writeFileSync(slidesPath, 'v0', 'utf-8')
    runInTurn('turn-a', () => writeSlides('v1'))
    restoreSlides() // back to v0; lastTurnId cleared
    runInTurn('turn-a', () => writeSlides('v2'))
    // Even though turnId is same as before, undo truncated and cleared lastTurnId
    // so this starts a fresh entry (not merging with the trimmed v1)
    const hist = listHistory()
    expect(hist.files.length).toBe(2) // [init v0, turn-a v2]
    expect(readSlides()).toBe('v2')
  })

  it('writes without turnId never merge (legacy behavior)', () => {
    fs.writeFileSync(slidesPath, 'v0', 'utf-8')
    writeSlides('v1')
    writeSlides('v2')
    writeSlides('v3')
    const hist = listHistory()
    expect(hist.files.length).toBe(4) // init + 3 pushes
    expect(hist.lastTurnId).toBe(null)
  })
})

describe('create/update/delete/reorder slide (四件套)', () => {
  const twoPageMd =
    '---\nlayout: cover\nmainTitle: hi\n---\n\n# P1\n\n---\nlayout: content\nheading: Second\n---\n\n# P2\n'

  function seed(md: string) {
    fs.writeFileSync(slidesPath, md, 'utf-8')
  }

  describe('createSlide', () => {
    it('append 到末尾（默认 index）', () => {
      seed(twoPageMd)
      const r = createSlide({ layout: 'content', frontmatter: { heading: 'New' }, body: '# New' })
      expect(r.success).toBe(true)
      expect(r.index).toBe(3)
      const pages = parseSlides(readSlides()).pages
      expect(pages.length).toBe(3)
      expect(pages[2]!.frontmatter.layout).toBe('content')
      expect(pages[2]!.frontmatter.heading).toBe('New')
    })

    it('插入中间（index=2 把原第 2 页顺延到第 3）', () => {
      seed(twoPageMd)
      const r = createSlide({
        index: 2,
        layout: 'content',
        frontmatter: { heading: 'Middle' },
        body: '# M',
      })
      expect(r.success).toBe(true)
      expect(r.index).toBe(2)
      const pages = parseSlides(readSlides()).pages
      expect(pages.length).toBe(3)
      expect(pages[0]!.frontmatter.mainTitle).toBe('hi') // 第 1 页不动
      expect(pages[1]!.frontmatter.heading).toBe('Middle') // 新页在中间
      expect(pages[2]!.frontmatter.heading).toBe('Second') // 原第 2 页被挤到第 3
    })

    it('插入头部 index=1', () => {
      seed(twoPageMd)
      const r = createSlide({ index: 1, layout: 'cover', body: '# First' })
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages.length).toBe(3)
      expect(pages[0]!.frontmatter.layout).toBe('cover')
      expect(pages[0]!.body.trim()).toBe('# First')
    })

    it('index 超出范围拒绝', () => {
      seed(twoPageMd)
      const r = createSlide({ index: 99, layout: 'content', body: 'x' })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/超出范围/)
    })

    it('空 layout 拒绝', () => {
      seed(twoPageMd)
      const r = createSlide({ layout: '' })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/layout/)
    })
  })

  describe('updateSlide', () => {
    it('合并 frontmatter（默认不 replace）', () => {
      seed(twoPageMd)
      const r = updateSlide({ index: 2, frontmatter: { heading: 'Renamed' } })
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages[1]!.frontmatter.heading).toBe('Renamed')
      expect(pages[1]!.frontmatter.layout).toBe('content') // 原字段保留
    })

    it('replaceFrontmatter=true 完全替换', () => {
      seed(twoPageMd)
      const r = updateSlide({
        index: 2,
        frontmatter: { layout: 'two-col', heading: 'N', leftTitle: 'L', rightTitle: 'R' },
        replaceFrontmatter: true,
      })
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages[1]!.frontmatter).toEqual({
        layout: 'two-col',
        heading: 'N',
        leftTitle: 'L',
        rightTitle: 'R',
      })
    })

    it('仅替换 body', () => {
      seed(twoPageMd)
      const r = updateSlide({ index: 1, body: '# New P1 Body' })
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages[0]!.body.trim()).toBe('# New P1 Body')
      expect(pages[0]!.frontmatter.mainTitle).toBe('hi') // FM 不变
    })

    it('同时传 frontmatter 和 body', () => {
      seed(twoPageMd)
      const r = updateSlide({
        index: 1,
        frontmatter: { subtitle: 'added' },
        body: '# Both',
      })
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages[0]!.frontmatter.subtitle).toBe('added')
      expect(pages[0]!.body.trim()).toBe('# Both')
    })

    it('未提供 frontmatter 也未提供 body 拒绝', () => {
      seed(twoPageMd)
      const r = updateSlide({ index: 1 })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/至少提供/)
    })

    it('index 超出范围拒绝', () => {
      seed(twoPageMd)
      const r = updateSlide({ index: 5, body: 'x' })
      expect(r.success).toBe(false)
    })
  })

  describe('deleteSlide', () => {
    it('删除中间页', () => {
      const threePageMd =
        twoPageMd + '\n---\nlayout: back-cover\n---\n\n# P3\n'
      seed(threePageMd)
      const r = deleteSlide(2)
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages.length).toBe(2)
      expect(pages[0]!.frontmatter.mainTitle).toBe('hi')
      expect(pages[1]!.frontmatter.layout).toBe('back-cover')
    })

    it('只剩一页时拒绝删', () => {
      seed('---\nlayout: cover\n---\n\n# lone\n')
      const r = deleteSlide(1)
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/最后一页/)
    })

    it('index 超出范围拒绝', () => {
      seed(twoPageMd)
      const r = deleteSlide(5)
      expect(r.success).toBe(false)
    })
  })

  describe('reorderSlides', () => {
    it('合法排列生效', () => {
      const fourPageMd =
        '---\na: 1\n---\n\n# A\n\n---\na: 2\n---\n\n# B\n\n---\na: 3\n---\n\n# C\n\n---\na: 4\n---\n\n# D\n'
      seed(fourPageMd)
      const r = reorderSlides([4, 2, 3, 1])
      expect(r.success).toBe(true)
      const pages = parseSlides(readSlides()).pages
      expect(pages.map((p) => p.frontmatter.a)).toEqual([4, 2, 3, 1])
    })

    it('长度不匹配拒绝', () => {
      seed(twoPageMd)
      const r = reorderSlides([1])
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/长度/)
    })

    it('含重复元素拒绝', () => {
      seed(twoPageMd)
      const r = reorderSlides([1, 1])
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/重复/)
    })

    it('含越界元素拒绝', () => {
      seed(twoPageMd)
      const r = reorderSlides([1, 3])
      expect(r.success).toBe(false)
    })
  })

  describe('四件套 与 history 集成', () => {
    it('createSlide 写入 history，undo 回滚', () => {
      seed(twoPageMd)
      createSlide({ layout: 'content', body: '# third' })
      expect(parseSlides(readSlides()).pages.length).toBe(3)
      restoreSlides()
      expect(parseSlides(readSlides()).pages.length).toBe(2)
    })

    it('updateSlide + deleteSlide 在同 turn 合并为一条 history', () => {
      seed(twoPageMd)
      runInTurn('turn-x', () => {
        updateSlide({ index: 1, body: '# new P1' })
        deleteSlide(2)
      })
      const hist = listHistory()
      // files: [init twoPageMd, turn-x 最终态（1 页）]
      expect(hist.files.length).toBe(2)
      expect(parseSlides(readSlides()).pages.length).toBe(1)
    })
  })
})
