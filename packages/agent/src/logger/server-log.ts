/**
 * 后端关键事件落盘(JSONL)。
 *
 * 跟 console.log 互补:
 * - console.log:给开发者看的实时输出,dev 终端窗口可见;但 stdout 不持久化,关掉终端 / 重启
 *   就丢了。dogfood 时用户反馈"图没出来",dev 终端日志早翻飞,事后无法排查
 * - logServerEvent:落盘到 `<logsDir>/server-YYYY-MM-DD.jsonl`(按日切分,JSONL 格式),
 *   长期保留供事后 grep 分析。所有**异步 worker 关键事件 + 外部 API 调用结果**都应该走这里
 *
 * 失败容错:任何文件写入错误吞掉(不抛),避免日志写失败导致业务挂。
 *
 * 跟 logger/index.ts 的 handleLogEvent 区别:
 * - handleLogEvent:前端 POST /api/log 调用,记 creator UI 行为(`creator-YYYY-MM-DD.jsonl`)
 * - logServerEvent:后端模块直接调用,记 worker / 路由内部事件(`server-YYYY-MM-DD.jsonl`)
 */
import fs from 'node:fs'
import path from 'node:path'
import { getPaths } from '../workspace.js'
import { safeForLog } from '../utils/redact.js'

export interface ServerEventBase {
  /** 模块 / 业务类别,grep 友好。如 'image-gen' / 'template-switch' / 'rewrite-for-template' */
  category: string
  /** 事件名,语义上是 state transition 或 milestone。如 'enqueued' / 'running' / 'gen-success' / 'failed' */
  event: string
}

export type ServerEvent = ServerEventBase & Record<string, unknown>

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function currentLogFile(): string {
  const { logsDir } = getPaths()
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return path.join(logsDir, `server-${yyyy}-${mm}-${dd}.jsonl`)
}

/**
 * 后端关键事件落盘。建议同时镜像一份到 console(开发期友好)。
 *
 * 用法:
 *   logServerEvent({
 *     category: 'image-gen',
 *     event: 'gen-failed',
 *     jobId: 'abc12345',
 *     userId: 1,
 *     deckId: 42,
 *     slideIndex: 3,
 *     errorMsg: 'OpenAI 502',
 *   })
 */
export function logServerEvent(payload: ServerEvent): void {
  // 测试环境(NODE_ENV=test)且未显式覆盖 logsDir → skip,避免污染仓库 logs/(混 dogfood 真日志)。
  // 想验证落盘的测试自己 setEnv BIG_PPT_LOGS_DIR 到 tmp 即可(见 server-log.test.ts)。
  if (process.env.NODE_ENV === 'test' && !process.env.BIG_PPT_LOGS_DIR) {
    return
  }
  try {
    const { logsDir } = getPaths()
    ensureDir(logsDir)
    const line = JSON.stringify(safeForLog({
      ts: new Date().toISOString(),
      ...payload,
    }))
    fs.appendFileSync(currentLogFile(), `${line}\n`)
  } catch {
    // 日志失败不应阻塞业务;最多丢一条事件
  }
}

/** 仅测试用:返回当前日志文件绝对路径(供 vitest 读 + 断言) */
export function __getCurrentServerLogFileForTesting(): string {
  return currentLogFile()
}
