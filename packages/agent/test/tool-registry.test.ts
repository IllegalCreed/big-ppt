import { beforeEach, describe, expect, it } from 'vitest'
import { __resetRegistry, getTool, hasTool, listTools, register, unregister } from '../src/tools/registry.js'

beforeEach(() => {
  __resetRegistry()
})

describe('tool-registry', () => {
  it('registers and retrieves a tool', () => {
    register({
      name: 'read_slides',
      description: 'read current slides',
      parameters: { type: 'object', properties: {} },
      exec: async () => 'ok',
    })
    expect(hasTool('read_slides')).toBe(true)
    const def = getTool('read_slides')
    expect(def?.name).toBe('read_slides')
  })

  it('rejects duplicate registration', () => {
    register({
      name: 'dup',
      parameters: { type: 'object', properties: {} },
      exec: async () => 'x',
    })
    expect(() =>
      register({
        name: 'dup',
        parameters: { type: 'object', properties: {} },
        exec: async () => 'y',
      }),
    ).toThrow(/duplicate/i)
  })

  it('listTools returns OpenAI-compatible LLMTool entries', () => {
    register({
      name: 'list_templates',
      description: 'list',
      parameters: { type: 'object', properties: {} },
      exec: async () => '[]',
    })
    const tools = listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0]!.type).toBe('function')
    expect(tools[0]!.function.name).toBe('list_templates')
    expect(tools[0]!.function.parameters).toEqual({ type: 'object', properties: {} })
  })

  it('returns undefined for unknown name', () => {
    expect(getTool('nonexistent')).toBeUndefined()
    expect(hasTool('nonexistent')).toBe(false)
  })

  it('unregister 删除已注册工具并返回 true', () => {
    register({
      name: 'tmp_tool',
      description: 't',
      parameters: { type: 'object', properties: {} },
      exec: async () => 'ok',
    })
    expect(hasTool('tmp_tool')).toBe(true)
    expect(unregister('tmp_tool')).toBe(true)
    expect(hasTool('tmp_tool')).toBe(false)
    expect(unregister('tmp_tool')).toBe(false)
  })
})
