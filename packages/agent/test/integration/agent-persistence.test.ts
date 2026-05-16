/**
 * Phase 12.7 Task C：persistTurnToDeckChats 集成测（3 测,真 lumideck_test DB）。
 *
 * 覆盖：
 * 1. 全量插入：3 条 canonical message 全入库,role / canonicalContent 字段对齐
 * 2. 空数组 noop（不命中 DB transaction）
 * 3. transaction 回滚：插入失败（role 不在 enum）整批不残留
 *
 * 2026-05-16 dogfood 修正:Task C 原版按「allMessages + existingCount slice」假设,
 * 实际 pi-agent-core agent_end.messages 已是本轮 delta(agent-loop.js 内 newMessages),
 * 不需要 slice。去掉 existingCount 参数,简化函数为「直接 batch insert」。
 *
 * 位置说明:sibling __tests__/ 受 tsconfig rootDir=./src 约束,不能 import test/_setup,
 * 因此跟 migrate-deck-chats / migrate-llm-settings 同走 test/integration/ 路径。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { useTestDb } from '../_setup/test-db.js'
import { createTestUser, createDeckDirect } from '../_setup/factories.js'
import { getDb, deckChats } from '../../src/db/index.js'
import { persistTurnToDeckChats } from '../../src/llm/agent/persistence.js'
import type { CanonicalMessage } from '../../src/llm/types.js'

useTestDb()

describe('persistTurnToDeckChats（集成，真 lumideck_test DB）', () => {
  let deckId: number

  beforeEach(async () => {
    const { user } = await createTestUser('persistence-c@a.com')
    const { deck } = await createDeckDirect(user.id)
    deckId = deck.id
  })

  it('把本轮 newMessages 全部入库（user + assistant tool_use + tool 三条）', async () => {
    const newMessages: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 't1',
            content: [{ type: 'text', text: 'result' }],
            isError: false,
          },
        ],
      },
    ]

    await persistTurnToDeckChats(deckId, newMessages)

    const db = getDb()
    const rows = await db
      .select()
      .from(deckChats)
      .where(eq(deckChats.deckId, deckId))
      .orderBy(deckChats.createdAt)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.role).toBe('user')
    expect(rows[1]?.role).toBe('assistant')
    expect(rows[2]?.role).toBe('tool')
    expect(rows[1]?.canonicalContent).toContain('tool_use')
    expect(rows[2]?.canonicalContent).toContain('tool_result')
    expect(rows[1]?.toolCallId).toBe('t1')
    expect(rows[2]?.toolCallId).toBe('t1')
  })

  it('空数组 noop（不触发 DB transaction）', async () => {
    await persistTurnToDeckChats(deckId, [])

    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(0)
  })

  it('insert 失败时 transaction 回滚（role 不在 enum 触发 DB constraint）', async () => {
    const newMessages: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'ok' }] },
      { role: 'invalid' as never, content: [{ type: 'text', text: 'bad' }] },
    ]
    await expect(persistTurnToDeckChats(deckId, newMessages)).rejects.toThrow()

    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(0)
  })
})
