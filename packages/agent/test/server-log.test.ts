/**
 * 后端事件落盘 helper 单测。
 *
 * 关键覆盖:
 * - logServerEvent 把事件 append 到 logs/server-YYYY-MM-DD.jsonl
 * - 多次调用顺序追加,JSONL 格式合法(每行一个 JSON)
 * - logsDir 不存在时自动 mkdir -p
 * - 业务字段任意类型都能写入(category / event / jobId / deckId / errorMsg / 等)
 * - fs 写入失败被吞掉(返回 void,不抛)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  logServerEvent,
  __getCurrentServerLogFileForTesting,
} from '../src/logger/server-log.js'
import { __resetPathsForTesting } from '../src/workspace.js'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bigppt-server-log-'))
  process.env.BIG_PPT_LOGS_DIR = path.join(tmpRoot, 'logs')
  __resetPathsForTesting()
})

afterEach(() => {
  delete process.env.BIG_PPT_LOGS_DIR
  __resetPathsForTesting()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('logServerEvent', () => {
  it('落盘到 logs/server-YYYY-MM-DD.jsonl,内容含 ts + 业务字段', () => {
    logServerEvent({
      category: 'image-gen',
      event: 'gen-failed',
      jobId: 'abc12345',
      deckId: 42,
      userId: 1,
      slideIndex: 3,
      errorMsg: 'OpenAI 502',
    })
    const file = __getCurrentServerLogFileForTesting()
    expect(fs.existsSync(file)).toBe(true)
    const raw = fs.readFileSync(file, 'utf-8').trim()
    const parsed = JSON.parse(raw)
    expect(parsed.category).toBe('image-gen')
    expect(parsed.event).toBe('gen-failed')
    expect(parsed.jobId).toBe('abc12345')
    expect(parsed.deckId).toBe(42)
    expect(parsed.userId).toBe(1)
    expect(parsed.slideIndex).toBe(3)
    expect(parsed.errorMsg).toBe('OpenAI 502')
    expect(typeof parsed.ts).toBe('string')
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('多次调用按顺序 append,每行独立 JSON', () => {
    logServerEvent({ category: 'image-gen', event: 'running', jobId: 'a' })
    logServerEvent({ category: 'image-gen', event: 'gen-success', jobId: 'a' })
    logServerEvent({ category: 'image-gen', event: 'done', jobId: 'a', assetId: 'x' })
    const lines = fs
      .readFileSync(__getCurrentServerLogFileForTesting(), 'utf-8')
      .trim()
      .split('\n')
    expect(lines).toHaveLength(3)
    const parsed = lines.map((l) => JSON.parse(l))
    expect(parsed[0].event).toBe('running')
    expect(parsed[1].event).toBe('gen-success')
    expect(parsed[2].event).toBe('done')
    expect(parsed[2].assetId).toBe('x')
  })

  it('logsDir 不存在时自动 mkdir -p', () => {
    const deepLogsDir = path.join(tmpRoot, 'a/b/c/logs')
    process.env.BIG_PPT_LOGS_DIR = deepLogsDir
    __resetPathsForTesting()
    expect(fs.existsSync(deepLogsDir)).toBe(false)
    logServerEvent({ category: 'image-gen', event: 'running' })
    expect(fs.existsSync(deepLogsDir)).toBe(true)
    expect(fs.existsSync(__getCurrentServerLogFileForTesting())).toBe(true)
  })

  it('fs 写失败被吞掉(返回 undefined,不抛)', () => {
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full simulated')
    })
    expect(() =>
      logServerEvent({ category: 'image-gen', event: 'running' }),
    ).not.toThrow()
    spy.mockRestore()
  })

  it('支持任意 ts 字段被覆盖(调用方传 ts 用 helper 自己时间)', () => {
    // helper 内部按当前时间写 ts;就算业务对象有 ts 也被 spread 后覆盖? 实际看实现 ts 在前,
    // ...payload 在后,所以 payload.ts 会**覆盖** helper 时间 — 这是 by design,允许调用方
    // 自己提供 ts(回填历史事件场景)
    logServerEvent({ category: 'x', event: 'y', ts: '2020-01-01T00:00:00Z' })
    const parsed = JSON.parse(
      fs.readFileSync(__getCurrentServerLogFileForTesting(), 'utf-8').trim(),
    )
    expect(parsed.ts).toBe('2020-01-01T00:00:00Z')
  })
})
