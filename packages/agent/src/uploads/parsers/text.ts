/** Phase 13 Task C: MD/TXT/CSV 直读,UTF-8 兜底失败时尝试 GBK(iconv-lite 可选)。 */
const MAX_CHARS = 50_000

export async function parseText(buffer: Buffer): Promise<string> {
  // 优先 UTF-8;兜底:若大量替换字符(U+FFFD)说明编码错,尝试 GBK
  let text = buffer.toString('utf8')
  const replacementCount = (text.match(/�/g) ?? []).length
  if (replacementCount > text.length * 0.05) {
    try {
      // dynamic import 让 iconv-lite 保持 optional;未在我们 deps 但 transitive 可解析,
      // 装与不装都走 try/catch 路径(production 期可能没有,本地有则正确处理 GBK)
      const iconv = (await import('iconv-lite')) as { decode: (b: Buffer, enc: string) => string }
      text = iconv.decode(buffer, 'gbk')
    } catch {
      // iconv-lite 未安装:用户中文 GBK 文件需自行装,不阻塞主流程
    }
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n... (truncated)'
  return text
}
