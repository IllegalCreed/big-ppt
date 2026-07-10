/**
 * Phase 10.5 落地 Task 25-A-2：body markdown + Vue 标签运行时编译。
 *
 * 链路：
 *   marked → 把标准 markdown 转 HTML（标题/列表/段落/inline 代码）
 *   保留嵌入的大写 Vue 自定义标签（marked 默认 inline HTML 透传）
 *   Vue.compile(html) 出 render
 *   defineComponent({ render }) 包成动态组件
 *
 * 缓存：相同 body 字符串 → 同一组件实例。避免每次响应式 trigger 都重编译。
 *
 * 不在范围：deck-level frontmatter / `<v-clicks>` / Slidev 演讲特殊指令 ——
 * 这些上下文 Slidev SPA 跑得到，DeckRenderer 编辑视图不渲染。
 */

import { compile, defineComponent, type Component } from 'vue'
import { marked } from 'marked'

const cache = new Map<string, Component>()

const SAFE_HTML_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
])
const VOID_HTML_TAGS = new Set(['br', 'hr', 'img'])
const SAFE_BODY_COMPONENTS = new Set([
  'EqualSplit',
  'OneVsThree',
  'TwoColumnsTwoRows',
  'SixGrid',
  'NineGrid',
  'ImageText',
  'PetalFour',
  'ProcessFlow',
  'MetricCard',
  'Table',
  'Quote',
  'BarChart',
  'LineChart',
  'PieChart',
])
const ATTR_RE = /([:@#A-Za-z_][^\s=/>]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const DANGEROUS_BLOCK_RE =
  /<\s*(script|style|iframe|object|embed|link|meta|base|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi
const DANGEROUS_STANDALONE_RE = /<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|svg|math)\b[^>]*>/gi

export function compileBody(body: string): Component {
  const cached = cache.get(body)
  if (cached) return cached
  // breaks: false 跟 Slidev 默认对齐；async: false 走同步路径
  const rawHtml = marked.parse(body, { async: false, breaks: false }) as string
  const render = compile(sanitizeBodyHtml(rawHtml))
  const comp = defineComponent({ render })
  cache.set(body, comp)
  return comp
}

/** 测试场景重置缓存 */
export function _resetBodyCache(): void {
  cache.clear()
}

export function sanitizeBodyHtml(html: string): string {
  return html
    .replace(DANGEROUS_BLOCK_RE, '')
    .replace(DANGEROUS_STANDALONE_RE, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, sanitizeTag)
    .replace(/\{\{/g, '&#123;&#123;')
    .replace(/\}\}/g, '&#125;&#125;')
}

function sanitizeTag(raw: string): string {
  const isClosing = /^<\s*\//.test(raw)
  const match = raw.match(/^<\/?\s*([A-Za-z][A-Za-z0-9:-]*)/)
  if (!match) return ''

  const originalName = match[1]!
  const lowerName = originalName.toLowerCase()
  const isTemplate = lowerName === 'template'
  const isComponent = SAFE_BODY_COMPONENTS.has(originalName)
  const isHtmlTag = SAFE_HTML_TAGS.has(lowerName)
  if (!isTemplate && !isComponent && !isHtmlTag) return ''

  const tagName = isComponent ? originalName : lowerName
  if (isClosing) return `</${tagName}>`

  const end = raw.lastIndexOf('>')
  const attrText = raw
    .slice(match[0].length, end === -1 ? raw.length : end)
    .replace(/\/\s*$/, '')
  const attrs = sanitizeAttrs(tagName, attrText, { isComponent, isTemplate })
  const selfClosing = VOID_HTML_TAGS.has(lowerName) || /\/\s*>$/.test(raw)

  return `<${tagName}${attrs}${selfClosing ? ' />' : '>'}`
}

function sanitizeAttrs(
  tagName: string,
  attrText: string,
  options: { isComponent: boolean; isTemplate: boolean },
): string {
  const rendered: string[] = []
  const seen = new Set<string>()

  for (const match of attrText.matchAll(ATTR_RE)) {
    const name = match[1]!
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    const hasValue = match[2] !== undefined || match[3] !== undefined || match[4] !== undefined
    const safe = sanitizeAttr(tagName, name, value, hasValue, options)
    if (!safe) continue

    const seenKey = name.toLowerCase()
    if (seen.has(seenKey)) continue
    seen.add(seenKey)
    rendered.push(safe)
  }

  return rendered.length ? ` ${rendered.join(' ')}` : ''
}

function sanitizeAttr(
  tagName: string,
  name: string,
  value: string,
  hasValue: boolean,
  options: { isComponent: boolean; isTemplate: boolean },
): string | null {
  const lower = name.toLowerCase()
  if (lower.startsWith('on')) return null
  if (name.startsWith('@') || lower.startsWith('v-')) return null
  if (name.startsWith('#')) {
    if (!options.isTemplate || hasValue || !/^#[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return null
    return name
  }
  if (name.startsWith(':')) {
    if (!options.isComponent || !hasValue || !/^:[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return null
    if (!isSafeLiteralExpression(value)) return null
    return renderAttr(name, value, true)
  }
  if (options.isTemplate) return null
  if (lower === 'style' || lower === 'srcdoc' || lower === 'is') return null
  if (!/^[A-Za-z][A-Za-z0-9:_-]*$/.test(name)) return null

  if (!options.isComponent && !isSafeHtmlAttr(tagName, lower)) return null
  if ((lower === 'href' || lower === 'src' || lower === 'image') && !isSafeUrl(value)) return null

  return hasValue ? renderAttr(name, value, false) : name
}

function isSafeHtmlAttr(tagName: string, lowerName: string): boolean {
  if (lowerName === 'class' || lowerName === 'title' || lowerName === 'alt') return true
  if (lowerName === 'role' || lowerName.startsWith('aria-') || lowerName.startsWith('data-')) return true
  if (tagName === 'a') return lowerName === 'href' || lowerName === 'target' || lowerName === 'rel'
  if (tagName === 'img') return lowerName === 'src' || lowerName === 'width' || lowerName === 'height' || lowerName === 'loading'
  if (tagName === 'td' || tagName === 'th') return lowerName === 'colspan' || lowerName === 'rowspan'
  return false
}

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim().replace(/[\u0000-\u001F\u007F\s]+/g, '')
  if (!trimmed) return false
  if (/^(https?:|\/|\.\/|\.\.\/|#)/i.test(trimmed)) return true
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(trimmed)) return true
  return false
}

function renderAttr(name: string, value: string, isBinding: boolean): string | null {
  const quote = value.includes('"') && !value.includes("'") ? "'" : '"'
  if (value.includes(quote)) return null
  return `${name}=${quote}${escapeAttr(value, quote, isBinding)}${quote}`
}

function escapeAttr(value: string, quote: '"' | "'", isBinding: boolean): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  if (isBinding) return escaped
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : escaped.replace(/'/g, '&#39;')
}

function isSafeLiteralExpression(source: string): boolean {
  const input = source.trim()
  if (!input) return false
  const stack: string[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]!
    if (/\s/.test(ch) || ch === ',' || ch === ':') {
      i += 1
      continue
    }
    if (ch === '[' || ch === '{') {
      stack.push(ch)
      i += 1
      continue
    }
    if (ch === ']' || ch === '}') {
      const expected = ch === ']' ? '[' : '{'
      if (stack.pop() !== expected) return false
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const next = scanString(input, i)
      if (next === -1) return false
      i = next
      continue
    }
    const number = input.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (number) {
      i += number[0].length
      continue
    }
    const literal = input.slice(i).match(/^(?:true|false|null)\b/)
    if (literal) {
      i += literal[0].length
      continue
    }
    return false
  }

  return stack.length === 0
}

function scanString(input: string, start: number): number {
  const quote = input[start]!
  for (let i = start + 1; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === quote) return i + 1
  }
  return -1
}
