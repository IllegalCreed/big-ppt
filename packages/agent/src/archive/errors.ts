/**
 * Phase 15:归档 import / export 链路的 typed error。
 *
 * code 用 kebab-case,routes 层根据 code map 成 HTTP status + 用户友好文案;
 * userMessage 直出给前端,不需要再翻译。
 */
export type ArchiveErrorCode =
  | 'not-a-zip'
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'schema-unsupported'
  | 'asset-missing'
  | 'asset-corrupt'
  | 'content-missing'
  | 'oversized'
  | 'db-failure'

export class ArchiveError extends Error {
  constructor(
    public code: ArchiveErrorCode,
    public userMessage: string,
    cause?: unknown,
  ) {
    super(userMessage)
    this.name = 'ArchiveError'
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause
  }
}
