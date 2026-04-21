import { describe, expect, it } from 'vitest'
import { levenshtein, similarity } from '../src/utils/similarity.js'

describe('levenshtein', () => {
  it('identical strings → 0', () => {
    expect(levenshtein('hello', 'hello')).toBe(0)
  })
  it('single char diff → 1', () => {
    expect(levenshtein('hello', 'jello')).toBe(1)
  })
  it('classic kitten vs sitting → 3', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
  it('empty strings → other length', () => {
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
  })
})

describe('similarity', () => {
  it('identical → 1', () => {
    expect(similarity('abc', 'abc')).toBe(1)
  })
  it('completely different → 0', () => {
    expect(similarity('abc', 'xyz')).toBe(0)
  })
  it('empty input → 0', () => {
    expect(similarity('', 'abc')).toBe(0)
    expect(similarity('abc', '')).toBe(0)
  })
  it('partial overlap 0..1 range', () => {
    const s = similarity('hello world', 'hello')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})
