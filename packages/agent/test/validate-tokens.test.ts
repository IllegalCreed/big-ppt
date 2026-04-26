import { describe, expect, it } from 'vitest'
import {
  LD_TOKEN_SPEC,
  parseLdTokens,
  validateManifestComponents,
  validateTokens,
} from '../src/templates/validate-tokens.js'

const FULL_SPEC_CSS = LD_TOKEN_SPEC.map((t) => `  ${t.name}: var(--placeholder);`).join('\n')

describe('parseLdTokens', () => {
  it('extracts all --ld-* declarations and ignores values / non-ld vars', () => {
    const css = `
      :root {
        --bt-brand: #d00d14;
        --ld-color-brand-primary: var(--bt-brand);
        --ld-radius-sm: 4px;
        --some-other: red;
      }
    `
    expect(parseLdTokens(css)).toEqual(['--ld-color-brand-primary', '--ld-radius-sm'])
  })

  it('dedupes across multiple selectors', () => {
    const css = `
      :root { --ld-color-brand-primary: red; }
      .foo { --ld-color-brand-primary: blue; }
    `
    expect(parseLdTokens(css)).toEqual(['--ld-color-brand-primary'])
  })
})

describe('validateTokens', () => {
  it('full spec css → ok=true, missing=[], counts.matched=26', () => {
    const result = validateTokens(`:root {\n${FULL_SPEC_CSS}\n}`)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual([])
    expect(result.counts.spec).toBe(26)
    expect(result.counts.matched).toBe(26)
  })

  it('missing 1 token → ok=false, missing reports which one', () => {
    const reduced = LD_TOKEN_SPEC.filter((t) => t.name !== '--ld-shadow-md')
      .map((t) => `  ${t.name}: var(--x);`)
      .join('\n')
    const result = validateTokens(`:root {\n${reduced}\n}`)
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['--ld-shadow-md'])
    expect(result.counts.matched).toBe(25)
  })

  it('extra --ld-* tokens → ok=true with warning in extra[]', () => {
    const css = `:root {
${FULL_SPEC_CSS}
  --ld-extra-experimental: 42px;
  --ld-color-brand-tertiary: pink;
}`
    const result = validateTokens(css)
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.extra).toEqual(['--ld-color-brand-tertiary', '--ld-extra-experimental'])
  })

  it('completely empty css → ok=false, missing covers all 26', () => {
    const result = validateTokens(':root { --bt-brand: red; }')
    expect(result.ok).toBe(false)
    expect(result.missing.length).toBe(26)
    expect(result.counts.matched).toBe(0)
  })
})

describe('LD_TOKEN_SPEC structure', () => {
  it('exactly 26 tokens distributed 13/7/4/2 across categories', () => {
    expect(LD_TOKEN_SPEC.length).toBe(26)
    const byCategory = LD_TOKEN_SPEC.reduce<Record<string, number>>((acc, t) => {
      acc[t.category] = (acc[t.category] ?? 0) + 1
      return acc
    }, {})
    expect(byCategory).toEqual({ colors: 13, fonts: 7, shapes: 4, shadows: 2 })
  })

  it('all token names are unique and start with --ld-', () => {
    const names = LD_TOKEN_SPEC.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((n) => n.startsWith('--ld-'))).toBe(true)
  })
})

describe('validateManifestComponents', () => {
  const allowed = ['MetricCard', 'BarChart', 'TwoColLayout'] as const

  it('field absent → ok=true (首版未 opt-in 也允许)', () => {
    expect(validateManifestComponents({}, allowed)).toEqual({ ok: true, invalid: [] })
  })

  it('all values in allowed set → ok=true', () => {
    const result = validateManifestComponents(
      { commonComponents: ['MetricCard', 'BarChart'] },
      allowed,
    )
    expect(result).toEqual({ ok: true, invalid: [] })
  })

  it('any value outside allowed set → ok=false with invalid listed', () => {
    const result = validateManifestComponents(
      { commonComponents: ['MetricCard', 'NotAComponent', 'AlsoFake'] },
      allowed,
    )
    expect(result.ok).toBe(false)
    expect(result.invalid).toEqual(['NotAComponent', 'AlsoFake'])
  })

  it('non-array value → structureError', () => {
    const result = validateManifestComponents(
      { commonComponents: 'MetricCard' as unknown as string[] },
      allowed,
    )
    expect(result.ok).toBe(false)
    expect(result.structureError).toBeDefined()
  })
})
