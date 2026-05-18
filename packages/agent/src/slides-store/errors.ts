/**
 * slides-store 公共错误类型。
 *
 * Phase 15.x P0 security hotfix:slides-store DB-based 化后,缺 ALS userId / activeDeckId
 * 时不再静默 fallback 读全局 slides.md,而是抛该错让工具层 catch 后返 LLM 友好提示。
 */
export class NoActiveDeckError extends Error {
  constructor(msg = '无 active deck 上下文:请通过编辑器入口操作幻灯片') {
    super(msg)
    this.name = 'NoActiveDeckError'
  }
}
