/**
 * Phase 15 Task A:rewriteAssetUrls(markdown, idMap) 测试。
 *
 * 覆盖单图 / 多图 / 同 id 重复出现 / map 中无对应 id graceful degrade
 * + case sensitive(/API/Assets 不被替换)四 case。
 */
import { describe, expect, it } from 'vitest'
import { rewriteAssetUrls } from '../src/archive/rewrite-asset-urls.js'

const OLD_A = '11111111-aaaa-1111-aaaa-111111111111'
const NEW_A = 'aaaaaaaa-2222-aaaa-2222-aaaaaaaaaaaa'
const OLD_B = '22222222-bbbb-2222-bbbb-222222222222'
const NEW_B = 'bbbbbbbb-3333-bbbb-3333-bbbbbbbbbbbb'
const OLD_UNMAPPED = '33333333-cccc-3333-cccc-333333333333'

describe('archive/rewrite-asset-urls', () => {
  it('单图:替换单个 /api/assets/<uuid>', () => {
    const md = `# Title\n\n![](/api/assets/${OLD_A})\n`
    const out = rewriteAssetUrls(md, new Map([[OLD_A, NEW_A]]))
    expect(out).toBe(`# Title\n\n![](/api/assets/${NEW_A})\n`)
  })

  it('多图:多个不同 uuid 各自替换', () => {
    const md = `![a](/api/assets/${OLD_A}) and ![b](/api/assets/${OLD_B})`
    const out = rewriteAssetUrls(
      md,
      new Map([
        [OLD_A, NEW_A],
        [OLD_B, NEW_B],
      ]),
    )
    expect(out).toBe(`![a](/api/assets/${NEW_A}) and ![b](/api/assets/${NEW_B})`)
  })

  it('同 id 重复出现:每处都被替换', () => {
    const md = `1: /api/assets/${OLD_A}\n2: /api/assets/${OLD_A}\n3: /api/assets/${OLD_A}`
    const out = rewriteAssetUrls(md, new Map([[OLD_A, NEW_A]]))
    expect(out).toBe(`1: /api/assets/${NEW_A}\n2: /api/assets/${NEW_A}\n3: /api/assets/${NEW_A}`)
  })

  it('map 中无对应 id:保持原样(graceful degrade,不抛错)', () => {
    const md = `![mapped](/api/assets/${OLD_A}) ![orphan](/api/assets/${OLD_UNMAPPED})`
    const out = rewriteAssetUrls(md, new Map([[OLD_A, NEW_A]]))
    expect(out).toBe(`![mapped](/api/assets/${NEW_A}) ![orphan](/api/assets/${OLD_UNMAPPED})`)
  })

  it('空 idMap:整个 markdown 原样返回', () => {
    const md = `![](/api/assets/${OLD_A}) ![](/api/assets/${OLD_B})`
    expect(rewriteAssetUrls(md, new Map())).toBe(md)
  })

  it('case sensitive:/API/Assets/<uuid> 不被替换', () => {
    const md = `![upper](/API/Assets/${OLD_A}) ![lower](/api/assets/${OLD_A})`
    const out = rewriteAssetUrls(md, new Map([[OLD_A, NEW_A]]))
    expect(out).toBe(`![upper](/API/Assets/${OLD_A}) ![lower](/api/assets/${NEW_A})`)
  })

  it('非 uuid 形状(短 hex / 大写)不匹配,原样保留', () => {
    const md = `/api/assets/short-id /api/assets/${OLD_A.toUpperCase()}`
    const out = rewriteAssetUrls(md, new Map([[OLD_A, NEW_A]]))
    expect(out).toBe(md)
  })
})
