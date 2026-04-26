/**
 * Phase 7.5D-4：把 deck content 中引用已删除的旧 layout 字段
 * （beitou/jingyeda-data | -two-col | -image-content）重写为
 * `<prefix>-content` + 移除老 layout 特有 frontmatter 字段。
 *
 * 数据保全 MVP 策略（详见 packages/agent/scripts/migrate-deprecated-layouts.ts 头部注释）：
 *   - 仅替换 frontmatter `layout:` 字段值
 *   - 移除 metrics / leftTitle / rightTitle / image / textTitle 字段
 *   - body 文字保留不动（::left:: / ::right:: 等老 slot 语法不渲染但内容不丢）
 *
 * 本模块仅暴露 pure functions；CLI / DB CRUD 放 scripts/migrate-deprecated-layouts.ts。
 */

export const OLD_LAYOUT_PATTERN = /^layout:\s*(beitou|jingyeda)-(data|two-col|image-content)\s*$/m
export const REMOVE_FIELDS = ['metrics', 'leftTitle', 'rightTitle', 'image', 'textTitle'] as const

export interface PageRewriteSummary {
  pageIndex: number
  oldLayout: string
  newLayout: string
  removedFields: string[]
}

export interface MigrateResult {
  newContent: string
  pageRewrites: PageRewriteSummary[]
}

interface Page {
  raw: string
  frontmatter: string
  body: string
}

export function rewriteFrontmatterField(
  frontmatter: string,
  fieldName: string,
): { result: string; removed: boolean } {
  const lines = frontmatter.split('\n')
  const result: string[] = []
  let removed = false
  let inFieldBlock = false

  for (const line of lines) {
    const fieldMatch = line.match(/^(\w+):/)
    if (fieldMatch) {
      if (fieldMatch[1] === fieldName) {
        inFieldBlock = true
        removed = true
        continue
      }
      inFieldBlock = false
      result.push(line)
      continue
    }
    if (inFieldBlock && (line.startsWith(' ') || line.startsWith('\t') || line.startsWith('-'))) {
      continue
    }
    inFieldBlock = false
    result.push(line)
  }
  return { result: result.join('\n'), removed }
}

export function splitDeckPages(content: string): Page[] {
  const lines = content.split('\n')
  const pages: Page[] = []

  let i = 0
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) break

    if (lines[i].trim() !== '---') {
      const bodyStart = i
      while (i < lines.length && lines[i].trim() !== '---') i++
      const body = lines.slice(bodyStart, i).join('\n')
      pages.push({ raw: body, frontmatter: '', body })
      continue
    }

    const fmStart = i
    i++
    const fmContentStart = i
    while (i < lines.length && lines[i].trim() !== '---') i++
    const fmContentEnd = i
    if (i >= lines.length) {
      const raw = lines.slice(fmStart).join('\n')
      pages.push({
        raw,
        frontmatter: lines.slice(fmContentStart, fmContentEnd).join('\n'),
        body: '',
      })
      break
    }
    i++

    const bodyStart = i
    while (i < lines.length && lines[i].trim() !== '---') i++
    const bodyEnd = i

    const frontmatter = lines.slice(fmContentStart, fmContentEnd).join('\n')
    const body = lines.slice(bodyStart, bodyEnd).join('\n')
    const raw = lines.slice(fmStart, bodyEnd).join('\n')
    pages.push({ raw, frontmatter, body })
  }

  return pages
}

export function reassembleDeck(pages: Array<{ frontmatter: string; body: string }>): string {
  return pages
    .map(({ frontmatter, body }) => {
      if (frontmatter === '' && body === '') return ''
      if (frontmatter === '') return body
      const fmBlock = `---\n${frontmatter}\n---`
      return body.length > 0 ? `${fmBlock}\n\n${body}` : fmBlock
    })
    .join('\n\n')
}

export function migrateContent(content: string): MigrateResult {
  const pages = splitDeckPages(content)
  const pageRewrites: PageRewriteSummary[] = []

  const newPages = pages.map((page, idx) => {
    if (page.frontmatter === '') return page

    const layoutMatch = page.frontmatter.match(OLD_LAYOUT_PATTERN)
    if (!layoutMatch) return page

    const oldLayout = `${layoutMatch[1]}-${layoutMatch[2]}`
    const newLayout = `${layoutMatch[1]}-content`

    let newFrontmatter = page.frontmatter.replace(OLD_LAYOUT_PATTERN, `layout: ${newLayout}`)
    const removedFields: string[] = []
    for (const field of REMOVE_FIELDS) {
      const { result, removed } = rewriteFrontmatterField(newFrontmatter, field)
      if (removed) {
        newFrontmatter = result
        removedFields.push(field)
      }
    }
    newFrontmatter = newFrontmatter.replace(/\n{2,}/g, '\n').replace(/^\n+|\n+$/g, '')

    pageRewrites.push({ pageIndex: idx, oldLayout, newLayout, removedFields })
    return { ...page, frontmatter: newFrontmatter }
  })

  return { newContent: reassembleDeck(newPages), pageRewrites }
}
