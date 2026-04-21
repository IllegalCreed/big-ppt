import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetPathsForTesting } from '../src/workspace.js'
import { getLatestSession, handleLogEvent } from '../src/logger/index.js'

let tmpLogs: string

beforeEach(() => {
  tmpLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-logger-'))
  process.env.BIG_PPT_LOGS_DIR = tmpLogs
  // slides/templates 用默认（monorepo root 定位），logger 测试只碰 logs 目录
  __resetPathsForTesting()
})

afterEach(() => {
  fs.rmSync(tmpLogs, { recursive: true, force: true })
  delete process.env.BIG_PPT_LOGS_DIR
  __resetPathsForTesting()
})

describe('handleLogEvent', () => {
  it('appends index line to creator-YYYY-MM-DD.jsonl', () => {
    const res = handleLogEvent({ kind: 'user_message', session: 'sess-1', text: 'hi' })
    expect(res.success).toBe(true)
    const files = fs.readdirSync(tmpLogs).filter((f) => f.startsWith('creator-'))
    expect(files).toHaveLength(1)
    const lines = fs.readFileSync(path.join(tmpLogs, files[0]!), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const ev = JSON.parse(lines[0]!)
    expect(ev.kind).toBe('user_message')
    expect(ev.session).toBe('sess-1')
    expect(ev.text).toBe('hi')
    expect(ev.ts).toBeTruthy()
  })

  it('shards large payload to payloads/<session>/<file>.json and replaces with payload_file ref', () => {
    const bigPayload = { text: 'x'.repeat(2000), meta: { a: 1 } }
    handleLogEvent({ kind: 'llm_request', session: 'sess-2', payload: bigPayload })
    const sessionDir = path.join(tmpLogs, 'payloads', 'sess-2')
    expect(fs.existsSync(sessionDir)).toBe(true)
    const payloadFiles = fs.readdirSync(sessionDir)
    expect(payloadFiles).toHaveLength(1)
    const stored = JSON.parse(fs.readFileSync(path.join(sessionDir, payloadFiles[0]!), 'utf-8'))
    expect(stored).toEqual(bigPayload)

    const indexFile = fs.readdirSync(tmpLogs).find((f) => f.startsWith('creator-'))!
    const line = JSON.parse(fs.readFileSync(path.join(tmpLogs, indexFile), 'utf-8').trim())
    expect(line.payload).toBeUndefined()
    expect(line.payload_file).toMatch(/^payloads\/sess-2\//)
    expect(line.payload_bytes).toBeGreaterThan(0)
  })

  it('sanitizes weird session id characters in payload dir name', () => {
    handleLogEvent({ kind: 'x', session: 'foo/bar baz!@#', payload: { a: 1 } })
    const sessionDirs = fs.readdirSync(path.join(tmpLogs, 'payloads'))
    expect(sessionDirs).toHaveLength(1)
    // 非法字符都应被替换成 _
    expect(sessionDirs[0]).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})

describe('getLatestSession', () => {
  it('returns empty events when logs dir missing', () => {
    fs.rmSync(tmpLogs, { recursive: true })
    const r = getLatestSession()
    expect(r.success).toBe(true)
    expect(r.events).toEqual([])
    expect(r.session).toBeNull()
  })

  it('returns events of the latest closed session', () => {
    handleLogEvent({ kind: 'user_message', session: 'sess-A', t: 1 })
    handleLogEvent({ kind: 'session_end', session: 'sess-A', reason: 'completed' })
    handleLogEvent({ kind: 'user_message', session: 'sess-B', t: 2 })
    handleLogEvent({ kind: 'session_end', session: 'sess-B', reason: 'completed' })

    const r = getLatestSession()
    expect(r.session).toBe('sess-B')
    expect(r.events).toHaveLength(2)
    expect(r.events.map((e) => e.kind)).toEqual(['user_message', 'session_end'])
  })

  it('falls back to most recent session when no session_end exists', () => {
    handleLogEvent({ kind: 'user_message', session: 'sess-live', text: 'a' })
    handleLogEvent({ kind: 'llm_request', session: 'sess-live' })
    const r = getLatestSession()
    expect(r.session).toBe('sess-live')
    expect(r.events).toHaveLength(2)
  })
})
