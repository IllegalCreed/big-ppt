import fs from 'node:fs'
import path from 'node:path'
import type { LogPayload } from '@big-ppt/shared'
import { getPaths } from '../workspace.js'

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function currentLogFile(): string {
  const { logsDir } = getPaths()
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return path.join(logsDir, `creator-${yyyy}-${mm}-${dd}.jsonl`)
}

function sanitizeSegment(s: string, max = 64): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max)
}

export interface LogEventResult {
  success: boolean
  session?: string
  error?: string
}

/**
 * 处理一条事件：大 payload 单独落盘到 logs/payloads/<session>/，索引行只保留 payload_file 引用。
 */
export function handleLogEvent(raw: LogPayload): LogEventResult {
  const { logsDir } = getPaths()
  ensureDir(logsDir)
  const { payload, ...indexFields } = raw

  if (payload !== undefined && payload !== null) {
    const session = sanitizeSegment(String(indexFields.session ?? 'no-session'))
    const payloadDir = path.join(logsDir, 'payloads', session)
    ensureDir(payloadDir)
    const seq = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const kindSafe = sanitizeSegment(String(indexFields.kind ?? 'event'), 40)
    const filename = `${seq}-${kindSafe}.json`
    fs.writeFileSync(path.join(payloadDir, filename), JSON.stringify(payload, null, 2))
    ;(indexFields as Record<string, unknown>).payload_file = `payloads/${session}/${filename}`
    ;(indexFields as Record<string, unknown>).payload_bytes = Buffer.byteLength(JSON.stringify(payload))
  }

  const line = JSON.stringify({ ts: new Date().toISOString(), ...indexFields })
  fs.appendFileSync(currentLogFile(), `${line}\n`)
  return { success: true, session: typeof indexFields.session === 'string' ? indexFields.session : undefined }
}

export interface LogLatestResult {
  success: boolean
  session: string | null
  path: string | null
  events: LogPayload[]
  error?: string
}

/** 返回最近一次完整会话的事件（供 /log 斜杠指令） */
export function getLatestSession(): LogLatestResult {
  const { logsDir } = getPaths()
  if (!fs.existsSync(logsDir)) {
    return { success: true, session: null, path: null, events: [] }
  }
  const files = fs
    .readdirSync(logsDir)
    .filter((f) => /^creator-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
  if (files.length === 0) {
    return { success: true, session: null, path: null, events: [] }
  }
  const latest = path.join(logsDir, files[files.length - 1]!)
  const raw = fs.readFileSync(latest, 'utf-8')
  const events = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l): LogPayload | null => {
      try {
        return JSON.parse(l) as LogPayload
      } catch {
        return null
      }
    })
    .filter((e): e is LogPayload => e !== null)

  let sessionId: string | null = null
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.kind === 'session_end') {
      sessionId = (events[i]!.session as string | undefined) ?? null
      break
    }
  }
  if (!sessionId && events.length > 0) {
    sessionId = (events[events.length - 1]!.session as string | undefined) ?? null
  }
  const sessionEvents = sessionId ? events.filter((e) => e.session === sessionId) : []
  return { success: true, session: sessionId, path: latest, events: sessionEvents }
}
