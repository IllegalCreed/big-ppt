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
    // ES2022 起 Error 自带 `cause: unknown`,显式 override 用 readonly 锁定且
    // 让类型签名公开;tsconfig.base.json `noImplicitOverride: true` 要求 modifier。
    // 与 LLMError(src/llm/errors.ts)写法一致。
    override readonly cause?: unknown,
  ) {
    super(userMessage)
    this.name = 'ArchiveError'
  }
}
