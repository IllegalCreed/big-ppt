/**
 * Phase 12.7 Task C：persistTurnToDeckChats 集成测（4 测,真 lumideck_test DB）。
 *
 * 覆盖：
 * 1. 全量插入(existingCount=0)：3 条 canonical message 全入库,role / canonicalContent 字段对齐
 * 2. allMessages.length <= existingCount 时 noop（empty 入参 / 没有新消息）
 * 3. existingCount > 0 时 slice 出增量,只写后续 N 条
 * 4. transaction 回滚：插入失败（role 不在 enum）整批不残留
 *
 * 位置说明:sibling __tests__/ 受 tsconfig rootDir=./src 约束,不能 import test/_setup,
 * 因此跟 migrate-deck-chats / migrate-llm-settings 同走 test/integration/ 路径
 * (已被 vitest include 覆盖)。
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

  it('existingCount=0 时把全部 message 入库（user + assistant tool_use + tool 三条）', async () => {
    const all: CanonicalMessage[] = [
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

    await persistTurnToDeckChats(deckId, all, 0)

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
    // canonical_content 必须含 Block[] JSON,tool_use 块 type 名 grep 得到
    expect(rows[1]?.canonicalContent).toContain('tool_use')
    expect(rows[2]?.canonicalContent).toContain('tool_result')
    // tool_call_id 在 assistant tool_use 块 + tool result 块都填 't1'
    expect(rows[1]?.toolCallId).toBe('t1')
    expect(rows[2]?.toolCallId).toBe('t1')
  })

  it('allMessages.length <= existingCount 时 noop（empty 数组 + 全是历史 两种情况）', async () => {
    await persistTurnToDeckChats(deckId, [], 0)

    const all: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'history-only' }] },
    ]
    await persistTurnToDeckChats(deckId, all, 1) // existingCount=length → noop

    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(0)
  })

  it('existingCount > 0 时 slice 出增量,只写后续 message', async () => {
    const all: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'first turn user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'first turn ai' }] },
      { role: 'user', content: [{ type: 'text', text: 'second turn user' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'second turn ai' }] },
    ]
    await persistTurnToDeckChats(deckId, all, 2)

    const db = getDb()
    const rows = await db
      .select()
      .from(deckChats)
      .where(eq(deckChats.deckId, deckId))
      .orderBy(deckChats.createdAt)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.content).toContain('second turn user')
    expect(rows[1]?.content).toContain('second turn ai')
  })

  it('insert 失败时 transaction 回滚（role 不在 enum 触发 DB constraint）', async () => {
    const all: CanonicalMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'ok' }] },
      { role: 'invalid' as never, content: [{ type: 'text', text: 'bad' }] },
    ]
    await expect(persistTurnToDeckChats(deckId, all, 0)).rejects.toThrow()

    // 第一条不应残留（回滚）
    const db = getDb()
    const rows = await db.select().from(deckChats).where(eq(deckChats.deckId, deckId))
    expect(rows).toHaveLength(0)
  })
})
