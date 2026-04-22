/**
 * Slidev slides.md 的 page-aware 解析 / 序列化。
 *
 * 模型：一份 slides.md 是若干页 `---\n<frontmatter>\n---\n<body>` 串联而成。
 * 第一块 frontmatter 通常混入 Slidev 全局配置（theme/title/transition 等），
 * 本模块**不**区分 global vs per-page —— 整块视为 pages[0].frontmatter。
 *
 * 支持的 YAML 子集（Slidev 事实用法）：
 * - 扁平 key:value，value 单行
 * - string / number / boolean / null
 * - inline array / object（JSON 风格）
 * - 注释 `# ...` 和空行
 *
 * 不支持：block scalar (`|` / `>`)、anchor、tag、跨行嵌套。
 * 碰到不支持格式时 parser 抛错，由调用方决定是否用 writeSlides 退化。
 *
 * round-trip 语义：**不追求** `serialize(parse(x)) === x`，而是**幂等**：
 * `serialize(parse(serialize(parse(x)))) === serialize(parse(x))`。
 * 这样 Step 5 规范化 slides.md 写入格式后，round-trip 就会自然稳定。
 */

export interface SlidePage {
  /** 0-based 位置索引 */
  index: number
  /** 解析后的 frontmatter 对象 */
  frontmatter: Record<string, unknown>
  /** frontmatter 闭合 `---` 之后、下一页 `---` 或文件末尾之前的原文 */
  body: string
}

export interface ParsedSlides {
  pages: SlidePage[]
}

export function parseSlides(md: string): ParsedSlides {
  const text = md.replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const pages: SlidePage[] = []

  let i = 0
  // 跳过 BOM / 开头空行
  while (i < lines.length && lines[i]!.trim() === '') i++

  while (i < lines.length) {
    if (lines[i]!.trim() !== '---') {
      throw new Error(`slides.md 第 ${i + 1} 行期望 "---" 作为页起始，实际是："${lines[i]}"`)
    }
    const fmStart = i + 1

    let fmEnd = -1
    for (let j = fmStart; j < lines.length; j++) {
      if (lines[j]!.trim() === '---') {
        fmEnd = j
        break
      }
    }
    if (fmEnd === -1) {
      throw new Error(`slides.md 第 ${i + 1} 行起的 frontmatter 未闭合（缺少收尾 "---"）`)
    }

    const fmLines = lines.slice(fmStart, fmEnd)
    const frontmatter = parseFrontmatterLines(fmLines, fmStart + 1)

    const bodyStart = fmEnd + 1
    let bodyEnd = lines.length
    for (let j = bodyStart; j < lines.length; j++) {
      if (lines[j]!.trim() === '---') {
        bodyEnd = j
        break
      }
    }

    const body = lines.slice(bodyStart, bodyEnd).join('\n')
    pages.push({ index: pages.length, frontmatter, body })

    i = bodyEnd
  }

  return { pages }
}

export function serializeSlides(parsed: ParsedSlides): string {
  let out = ''
  for (let i = 0; i < parsed.pages.length; i++) {
    const p = parsed.pages[i]!
    out += '---\n'
    const fm = serializeFrontmatter(p.frontmatter)
    if (fm) out += fm + '\n'
    out += '---\n'
    const bodyStripped = p.body.replace(/^\n+/, '').replace(/\n+$/, '')
    if (bodyStripped) {
      out += '\n' + bodyStripped + '\n'
    }
    if (i < parsed.pages.length - 1) {
      out += '\n' // 页间空行分隔，紧跟下页的 `---`
    }
  }
  return out
}

function parseFrontmatterLines(
  lines: string[],
  baseLineNumber: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      throw new Error(
        `frontmatter 第 ${baseLineNumber + idx} 行无法解析为 key:value："${line}"`,
      )
    }
    const key = line.slice(0, colonIdx).trim()
    if (!key) {
      throw new Error(`frontmatter 第 ${baseLineNumber + idx} 行 key 为空："${line}"`)
    }
    const rawValue = stripInlineComment(line.slice(colonIdx + 1).trim())
    result[key] = parseFmValue(rawValue)
  }
  return result
}

function stripInlineComment(raw: string): string {
  // 不在引号内的 `#` 视为行尾注释
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\' && (inSingle || inDouble)) {
      i++
      continue
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble) {
      return raw.slice(0, i).trimEnd()
    }
  }
  return raw
}

function parseFmValue(raw: string): unknown {
  if (raw === '' || raw === '~' || raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+$/.test(raw)) return Number(raw)
  if (/^-?\d+\.\d+$/.test(raw)) return Number(raw)

  if (raw.length >= 2) {
    if (raw.startsWith('"') && raw.endsWith('"')) {
      const inner = raw.slice(1, -1)
      return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
    }
    if (raw.startsWith("'") && raw.endsWith("'")) {
      return raw.slice(1, -1).replace(/''/g, "'")
    }
  }

  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      return JSON.parse(raw)
    } catch {
      const inner = raw.slice(1, -1).trim()
      if (!inner) return []
      return inner.split(',').map((x) => parseFmValue(x.trim()))
    }
  }

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      return JSON.parse(raw)
    } catch {
      /* 退化为原字符串 */
    }
  }

  return raw
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm)
  if (keys.length === 0) return ''
  return keys.map((k) => `${k}: ${serializeFmValue(fm[k])}`).join('\n')
}

function serializeFmValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return JSON.stringify(String(value))
    return String(value)
  }
  if (typeof value === 'string') {
    return needsQuotes(value) ? JSON.stringify(value) : value
  }
  if (Array.isArray(value)) return JSON.stringify(value)
  return JSON.stringify(value)
}

function needsQuotes(s: string): boolean {
  if (s === '') return true
  if (s !== s.trim()) return true
  // YAML 指示符 / 特殊字符
  if (/[:#[\]{},&*!|>'"%@`]/.test(s)) return true
  // 以 `-` 开头（会被误认作 list item）
  if (s.startsWith('-')) return true
  // 反查保险：不加引号 parseFmValue 回来值不等于原字符串（变成了 null/bool/number 等）→ 必须加引号
  try {
    const back = parseFmValue(s)
    if (back !== s) return true
  } catch {
    return true
  }
  return false
}
