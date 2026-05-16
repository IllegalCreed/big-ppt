/** Phase 13 Task C: 进程内 extractor 队列 + worker pool(concurrency=3, timeout=30s)。 */
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { userAssets } from '../db/schema.js'
import { getAssetBytes } from './storage.js'
import { parsePdf } from './parsers/pdf.js'
import { parseDocx } from './parsers/docx.js'
import { parseXlsx } from './parsers/xlsx.js'
import { parseText } from './parsers/text.js'
import { logServerEvent } from '../logger/server-log.js'

const CONCURRENCY = 3
const TIMEOUT_MS = 30_000

export type ExtractorJob = { assetId: string; userId: number; mime: string }

// 进程内 queue:重启丢失可接受(用户重传即可),跟 image-gen-job 同策略
const queue: ExtractorJob[] = []
let active = 0

/** 用户上传后调用,异步入队,worker pool 自动 drain */
export function enqueueExtraction(job: ExtractorJob): void {
  queue.push(job)
  drain()
}

/** worker pool dispatcher:active < CONCURRENCY 且 queue 非空时启动 runJob */
function drain(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()
    if (!job) break
    active++
    void runJob(job).finally(() => {
      active--
      drain()
    })
  }
}

async function runJob(job: ExtractorJob): Promise<void> {
  const db = getDb()
  await db.update(userAssets).set({ extractStatus: 'running' }).where(eq(userAssets.id, job.assetId))
  logServerEvent({
    category: 'extractor',
    event: 'started',
    assetId: job.assetId,
    userId: job.userId,
    mime: job.mime,
  })

  let timeoutHandle: NodeJS.Timeout | undefined
  try {
    const bytes = await getAssetBytes(job.userId, job.assetId)
    const text = await Promise.race([
      runParser(job.mime, bytes),
      new Promise<string>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`extractor timeout ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        )
      }),
    ])
    if (timeoutHandle) clearTimeout(timeoutHandle)
    await db
      .update(userAssets)
      .set({ extractedText: text, extractStatus: 'done', extractErrorMsg: null })
      .where(eq(userAssets.id, job.assetId))
    logServerEvent({
      category: 'extractor',
      event: 'done',
      assetId: job.assetId,
      chars: text.length,
    })
  } catch (e) {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    const msg = e instanceof Error ? e.message : String(e)
    await db
      .update(userAssets)
      .set({ extractStatus: 'failed', extractErrorMsg: msg })
      .where(eq(userAssets.id, job.assetId))
    logServerEvent({
      category: 'extractor',
      event: 'failed',
      assetId: job.assetId,
      errorMsg: msg,
    })
  }
}

/** mime 路由分派 */
export async function runParser(mime: string, bytes: Buffer): Promise<string> {
  if (mime === 'application/pdf') return parsePdf(bytes)
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return parseDocx(bytes)
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    return parseXlsx(bytes)
  if (mime === 'text/csv' || mime === 'text/markdown' || mime === 'text/plain')
    return parseText(bytes)
  throw new Error(`extractor: unsupported mime ${mime}`)
}

/** 测试 seam:轮询等队列彻底空闲(active=0 && queue=[])。 */
export async function waitForQueueIdle(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while ((active > 0 || queue.length > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50))
  }
  if (active > 0 || queue.length > 0) throw new Error('extractor queue not idle within timeout')
}

/** 测试 seam:暴露当前 active worker 数量,用于并发上限断言 */
export function __getActiveCountForTesting(): number {
  return active
}

/** 测试 seam:暴露 timeout 常量供单测断言 */
export const __TIMEOUT_MS_FOR_TESTING = TIMEOUT_MS

/** 测试 seam:暴露 concurrency 常量 */
export const __CONCURRENCY_FOR_TESTING = CONCURRENCY
