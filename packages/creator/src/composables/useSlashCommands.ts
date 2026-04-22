import { h, type VNodeChild } from 'vue'
import type { LogLatestResponse, LogPayload, RedoSlidesResponse, RestoreSlidesResponse } from '@big-ppt/shared'

export interface SlashCommand {
  value: string
  label: string
  description: string
  run: () => void | Promise<void>
}

export interface SlashCommandsDeps {
  clearHistory: () => void
  appendLocalMessage: (content: string) => void
  retryLastUserMessage: () => void
  /** 测试注入点；默认用 window.fetch */
  fetcher?: typeof fetch
}

export interface SlashSuggestionItem {
  value: string
  label: VNodeChild
}

export interface UseSlashCommandsReturn {
  commands: readonly SlashCommand[]
  slashItems: (info?: { query?: string }) => SlashSuggestionItem[]
  handleSlashSelect: (value: string) => void
  handleSenderChange: (
    value: string,
    onTrigger: (info: false | { query: string }) => void,
  ) => void
  /** 若 `message` 是斜杠指令（完整匹配 or 未知 `/...`），执行并返回 true；否则返回 false（调用方应按普通消息发送） */
  handleSlashSubmit: (message: string) => boolean
}

export function useSlashCommands(deps: SlashCommandsDeps): UseSlashCommandsReturn {
  const fetchFn = deps.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchFn(path, init)
    return (await res.json()) as T
  }

  function formatLogEvents(events: LogPayload[], session: string): string {
    if (events.length === 0) return '还没有会话日志。'
    const lines: string[] = [
      `**会话 \`${session.slice(0, 8)}\` 共 ${events.length} 个事件：**`,
      '',
    ]
    for (const e of events) {
      const rec = e as Record<string, unknown>
      const ts = new Date(String(rec.ts ?? '')).toLocaleTimeString()
      switch (rec.kind) {
        case 'user_message':
          lines.push(`[${ts}] 👤 ${String(rec.text ?? '')}`)
          break
        case 'llm_request':
          lines.push(
            `[${ts}] 🧠 LLM 请求（${rec.messages_count} 条上下文 / ${rec.tools_count} 个工具）`,
          )
          break
        case 'llm_response':
          lines.push(
            `[${ts}] 💬 LLM 响应（${rec.duration_ms}ms，${rec.tool_calls_count} 个 tool call）`,
          )
          break
        case 'tool_call':
          lines.push(`[${ts}] 🔧 调用 \`${rec.tool}\` ${rec.args ?? ''}`)
          break
        case 'tool_result':
          lines.push(
            `[${ts}] ${rec.success ? '✓' : '✗'} \`${rec.tool}\` ${rec.duration_ms}ms${rec.error ? ' · ' + rec.error : ''}`,
          )
          break
        case 'session_end':
          lines.push(`[${ts}] 🏁 结束（${rec.reason}，总耗时 ${rec.duration_ms}ms）`)
          break
      }
    }
    return lines.join('\n')
  }

  const commands: SlashCommand[] = [
    {
      value: 'clear',
      label: '/clear',
      description: '清空当前对话记录',
      run: () => {
        deps.clearHistory()
        deps.appendLocalMessage('对话已清空。')
      },
    },
    {
      value: 'retry',
      label: '/retry',
      description: '重试上一条用户消息',
      run: () => deps.retryLastUserMessage(),
    },
    {
      value: 'undo',
      label: '/undo',
      description: '撤销上一轮对话对 slides.md 的修改',
      run: async () => {
        try {
          const data = await callApi<RestoreSlidesResponse>('/api/restore-slides', {
            method: 'POST',
          })
          deps.appendLocalMessage(data.success ? `✅ ${data.message}` : `❌ ${data.error}`)
        } catch (err) {
          deps.appendLocalMessage(`❌ 恢复失败：${(err as Error).message}`)
        }
      },
    },
    {
      value: 'redo',
      label: '/redo',
      description: '前进到下一个历史版本（/undo 的反操作）',
      run: async () => {
        try {
          const data = await callApi<RedoSlidesResponse>('/api/redo-slides', { method: 'POST' })
          deps.appendLocalMessage(data.success ? `✅ ${data.message}` : `❌ ${data.error}`)
        } catch (err) {
          deps.appendLocalMessage(`❌ 重做失败：${(err as Error).message}`)
        }
      },
    },
    {
      value: 'log',
      label: '/log',
      description: '查看最近一次会话的日志摘要',
      run: async () => {
        try {
          const data = await callApi<LogLatestResponse>('/api/log/latest')
          if (!data.success) {
            deps.appendLocalMessage(`❌ ${data.error}`)
            return
          }
          deps.appendLocalMessage(formatLogEvents(data.events ?? [], data.session ?? ''))
        } catch (err) {
          deps.appendLocalMessage(`❌ 读取日志失败：${(err as Error).message}`)
        }
      },
    },
    {
      value: 'help',
      label: '/help',
      description: '列出所有可用指令',
      run: () => {
        const lines = ['**可用斜杠指令：**', '']
        for (const c of commands) lines.push(`- \`${c.label}\` — ${c.description}`)
        deps.appendLocalMessage(lines.join('\n'))
      },
    },
  ]

  function slashItems(info?: { query?: string }): SlashSuggestionItem[] {
    const q = (info?.query ?? '').toLowerCase()
    return commands
      .filter((c) => c.value.startsWith(q))
      .map((c) => ({
        value: c.value,
        label: h(
          'div',
          {
            style: 'display: flex; gap: 12px; align-items: center; font-family: var(--font-sans);',
          },
          [
            h('span', { style: 'color: var(--color-accent); font-weight: 600;' }, c.label),
            h(
              'span',
              { style: 'color: var(--color-fg-muted); font-size: var(--fs-sm);' },
              c.description,
            ),
          ],
        ),
      }))
  }

  function handleSlashSelect(value: string): void {
    const cmd = commands.find((c) => c.value === value)
    if (cmd) void cmd.run()
  }

  function handleSenderChange(
    value: string,
    onTrigger: (info: false | { query: string }) => void,
  ): void {
    if (value === '') {
      onTrigger(false)
      return
    }
    if (value.startsWith('/')) {
      onTrigger({ query: value.slice(1).toLowerCase() })
    } else {
      onTrigger(false)
    }
  }

  function handleSlashSubmit(message: string): boolean {
    const trimmed = message.trim()
    if (!trimmed.startsWith('/')) return false
    const name = trimmed.slice(1).split(/\s+/)[0] ?? ''
    const cmd = commands.find((c) => c.value === name)
    if (cmd) {
      void cmd.run()
      return true
    }
    deps.appendLocalMessage(`未知指令 \`${trimmed}\`。输入 \`/help\` 查看全部指令。`)
    return true
  }

  return { commands, slashItems, handleSlashSelect, handleSenderChange, handleSlashSubmit }
}
