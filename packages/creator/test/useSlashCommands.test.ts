/** useSlashCommands composable 单测：6 指令行为 + slashItems 候选 + handleSenderChange + handleSlashSubmit/Select 各分支。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSlashCommands } from '../src/composables/useSlashCommands'

interface Stubs {
  clearHistory: ReturnType<typeof vi.fn>
  appendLocalMessage: ReturnType<typeof vi.fn>
  retryLastUserMessage: ReturnType<typeof vi.fn>
  fetcher: ReturnType<typeof vi.fn>
}

function mkStubs(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>): Stubs {
  return {
    clearHistory: vi.fn(),
    appendLocalMessage: vi.fn(),
    retryLastUserMessage: vi.fn(),
    fetcher: vi.fn(fetchImpl ?? (async () => new Response('{}'))),
  }
}

function mkApi(stubs: Stubs) {
  return useSlashCommands({
    deckId: 42,
    clearHistory: stubs.clearHistory,
    appendLocalMessage: stubs.appendLocalMessage,
    retryLastUserMessage: stubs.retryLastUserMessage,
    fetcher: stubs.fetcher as unknown as typeof fetch,
  })
}

describe('useSlashCommands · commands', () => {
  let stubs: Stubs
  beforeEach(() => {
    stubs = mkStubs()
  })

  it('/clear 调 clearHistory + appendLocalMessage', async () => {
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'clear')!.run()
    expect(stubs.clearHistory).toHaveBeenCalledOnce()
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith('对话已清空。')
  })

  it('/retry 调 retryLastUserMessage', async () => {
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'retry')!.run()
    expect(stubs.retryLastUserMessage).toHaveBeenCalledOnce()
  })

  it('/undo 成功时展示 ✅ + message', async () => {
    stubs = mkStubs(async (url, init) => {
      expect(url).toBe('/api/restore-slides')
      expect(new Headers(init?.headers).get('X-Deck-Id')).toBe('42')
      return new Response(JSON.stringify({ success: true, message: '已撤销到第 1 / 2 版' }))
    })
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'undo')!.run()
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith('✅ 已撤销到第 1 / 2 版')
  })

  it('/undo 失败时展示 ❌ + error', async () => {
    stubs = mkStubs(async () =>
      new Response(JSON.stringify({ success: false, error: '已到最早的历史，无法继续撤销' })),
    )
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'undo')!.run()
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith('❌ 已到最早的历史，无法继续撤销')
  })

  it('/redo 调 /api/redo-slides', async () => {
    stubs = mkStubs(async (url, init) => {
      expect(url).toBe('/api/redo-slides')
      expect(new Headers(init?.headers).get('X-Deck-Id')).toBe('42')
      return new Response(JSON.stringify({ success: true, message: 'redone' }))
    })
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'redo')!.run()
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith('✅ redone')
  })

  it('/log 空事件列表时提示', async () => {
    stubs = mkStubs(async () =>
      new Response(JSON.stringify({ success: true, session: 'abc12345', events: [] })),
    )
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'log')!.run()
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith('还没有会话日志。')
  })

  it('/log 格式化 user_message / tool_call / session_end', async () => {
    stubs = mkStubs(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            session: 'abc12345',
            events: [
              { ts: '2026-04-22T00:00:00Z', kind: 'user_message', text: '你好' },
              {
                ts: '2026-04-22T00:00:01Z',
                kind: 'tool_call',
                tool: 'read_slides',
                args: '{}',
              },
              {
                ts: '2026-04-22T00:00:02Z',
                kind: 'session_end',
                reason: 'completed',
                duration_ms: 500,
              },
            ],
          }),
        ),
    )
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'log')!.run()
    const msg = stubs.appendLocalMessage.mock.calls[0]![0] as string
    expect(msg).toContain('共 3 个事件')
    expect(msg).toContain('👤 你好')
    expect(msg).toContain('🔧 调用 `read_slides`')
    expect(msg).toContain('🏁 结束（completed，总耗时 500ms）')
  })

  it('/help 列出所有指令', async () => {
    const api = mkApi(stubs)
    await api.commands.find((c) => c.value === 'help')!.run()
    const msg = stubs.appendLocalMessage.mock.calls[0]![0] as string
    expect(msg).toContain('/clear')
    expect(msg).toContain('/retry')
    expect(msg).toContain('/undo')
    expect(msg).toContain('/redo')
    expect(msg).toContain('/log')
    expect(msg).toContain('/help')
  })
})

describe('useSlashCommands · slashItems', () => {
  it('query 前缀过滤候选', () => {
    const api = mkApi(mkStubs())
    expect(api.slashItems({ query: 'u' }).map((i) => i.value)).toEqual(['undo'])
    expect(api.slashItems({ query: 're' }).map((i) => i.value)).toEqual(['retry', 'redo'])
    expect(api.slashItems({ query: '' }).length).toBe(6)
  })
})

describe('useSlashCommands · handleSenderChange', () => {
  it('空 value / 无前缀 / 正常前缀分别触发 off / off / on', () => {
    const api = mkApi(mkStubs())
    const onTrigger = vi.fn()
    api.handleSenderChange('', onTrigger)
    api.handleSenderChange('hello', onTrigger)
    api.handleSenderChange('/un', onTrigger)
    expect(onTrigger.mock.calls).toEqual([[false], [false], [{ query: 'un' }]])
  })
})

describe('useSlashCommands · handleSlashSubmit', () => {
  let stubs: Stubs
  beforeEach(() => {
    stubs = mkStubs()
  })

  it('完整匹配指令时执行并返回 true', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('/clear')).toBe(true)
    expect(stubs.clearHistory).toHaveBeenCalledOnce()
  })

  it('未知指令返回 true 且提示', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('/nope')).toBe(true)
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith(
      expect.stringContaining('未知指令 `/nope`'),
    )
  })

  it('非斜杠开头返回 false 不处理', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('hello world')).toBe(false)
    expect(stubs.clearHistory).not.toHaveBeenCalled()
    expect(stubs.appendLocalMessage).not.toHaveBeenCalled()
  })

  it('/retry 走 handleSlashSubmit 路径 → 调 retryLastUserMessage', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('/retry')).toBe(true)
    expect(stubs.retryLastUserMessage).toHaveBeenCalledOnce()
  })

  it('/help 走 handleSlashSubmit 路径 → appendLocalMessage 列出全部指令', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('/help')).toBe(true)
    const msg = stubs.appendLocalMessage.mock.calls[0]![0] as string
    for (const v of ['/clear', '/retry', '/undo', '/redo', '/log', '/help']) {
      expect(msg).toContain(v)
    }
  })

  it('指令后跟参数仍按指令名匹配（/clear extra args 也走 clearHistory）', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('/clear   extra ignored')).toBe(true)
    expect(stubs.clearHistory).toHaveBeenCalledOnce()
  })

  it('空字符串返回 false', () => {
    const api = mkApi(stubs)
    expect(api.handleSlashSubmit('')).toBe(false)
    expect(api.handleSlashSubmit('   ')).toBe(false)
  })
})

describe('useSlashCommands · handleSlashSelect', () => {
  let stubs: Stubs
  beforeEach(() => {
    stubs = mkStubs()
  })

  it('已知指令 value → 调对应 run（/clear → clearHistory）', () => {
    const api = mkApi(stubs)
    api.handleSlashSelect('clear')
    expect(stubs.clearHistory).toHaveBeenCalledOnce()
    expect(stubs.appendLocalMessage).toHaveBeenCalledWith('对话已清空。')
  })

  it('已知指令 value → /retry → retryLastUserMessage', () => {
    const api = mkApi(stubs)
    api.handleSlashSelect('retry')
    expect(stubs.retryLastUserMessage).toHaveBeenCalledOnce()
  })

  it('未知 value → 静默不动 callback', () => {
    const api = mkApi(stubs)
    api.handleSlashSelect('unknown-value')
    expect(stubs.clearHistory).not.toHaveBeenCalled()
    expect(stubs.appendLocalMessage).not.toHaveBeenCalled()
    expect(stubs.retryLastUserMessage).not.toHaveBeenCalled()
  })
})

describe('useSlashCommands · commands metadata（6 个 value/label）', () => {
  it('commands 列表恰好 6 个,value/label 顺序固定', () => {
    const api = mkApi(mkStubs())
    expect(api.commands).toHaveLength(6)
    expect(api.commands.map((c) => c.value)).toEqual([
      'clear',
      'retry',
      'undo',
      'redo',
      'log',
      'help',
    ])
    expect(api.commands.map((c) => c.label)).toEqual([
      '/clear',
      '/retry',
      '/undo',
      '/redo',
      '/log',
      '/help',
    ])
    // 每个 command 都有 description 字符串
    for (const c of api.commands) {
      expect(typeof c.description).toBe('string')
      expect(c.description.length).toBeGreaterThan(0)
    }
  })

  it('slashItems(空 query) 返 6 个候选,顺序对齐 commands', () => {
    const api = mkApi(mkStubs())
    const items = api.slashItems({})
    expect(items.map((i) => i.value)).toEqual([
      'clear',
      'retry',
      'undo',
      'redo',
      'log',
      'help',
    ])
  })

  it('slashItems(query=c) 只剩 /clear', () => {
    const api = mkApi(mkStubs())
    const items = api.slashItems({ query: 'c' })
    expect(items.map((i) => i.value)).toEqual(['clear'])
  })

  it('slashItems(query=h) 只剩 /help', () => {
    const api = mkApi(mkStubs())
    const items = api.slashItems({ query: 'h' })
    expect(items.map((i) => i.value)).toEqual(['help'])
  })

  it('slashItems 接受 undefined info(默认走空 query 返全部)', () => {
    const api = mkApi(mkStubs())
    expect(api.slashItems().length).toBe(6)
  })
})
