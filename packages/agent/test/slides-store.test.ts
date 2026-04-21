import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetPathsForTesting } from '../src/workspace.js'
import {
  backupSlides,
  editSlides,
  readSlides,
  restoreSlides,
  writeSlides,
} from '../src/slides-store/index.js'

let tmpDir: string
let slidesPath: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slides-'))
  slidesPath = path.join(tmpDir, 'slides.md')
  process.env.BIG_PPT_SLIDES_PATH = slidesPath
  __resetPathsForTesting()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.BIG_PPT_SLIDES_PATH
  __resetPathsForTesting()
})

describe('read/write/backup', () => {
  it('writeSlides writes content and creates .bak from previous content', () => {
    fs.writeFileSync(slidesPath, 'v1', 'utf-8')
    writeSlides('v2')
    expect(readSlides()).toBe('v2')
    expect(fs.readFileSync(`${slidesPath}.bak`, 'utf-8')).toBe('v1')
  })

  it('backupSlides is a no-op when no slides file exists', () => {
    backupSlides()
    expect(fs.existsSync(`${slidesPath}.bak`)).toBe(false)
  })

  it('restoreSlides reverts to .bak', () => {
    fs.writeFileSync(slidesPath, 'initial', 'utf-8')
    writeSlides('modified')
    const r = restoreSlides()
    expect(r.success).toBe(true)
    expect(readSlides()).toBe('initial')
  })

  it('restoreSlides returns error when no backup', () => {
    fs.writeFileSync(slidesPath, 'only', 'utf-8')
    const r = restoreSlides()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/slides.md.bak 不存在/)
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
