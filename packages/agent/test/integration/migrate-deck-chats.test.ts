/**
 * Phase 12 Task F:deck_chats canonical_content 回填 migration 集成测。
 *
 * 走真 lumideck_test DB:插混合形态老 row(role=tool / assistant-with-tool /
 * assistant-text / user / system)→ 跑 migrateDeckChats → SELECT 回读验证
 * canonical_content 填了正确 JSON Block[];rowToCanonical 应能 parse 出原 shape。
 *
 * 注意:vitest.config fileParallelism: false 保证不撞 TRUNCATE。
 */
import { describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import { sql } from 'drizzle-orm'
import { useTestDb } from '../_setup/test-db.js'
import { createTestUser, createDeckDirect } from '../_setup/factories.js'
import { getDb, deckChats } from '../../src/db/index.js'
import { eq } from 'drizzle-orm'
import { migrateDeckChats } from '../../src/llm/migrations.js'
import { rowToCanonical } from '../../src/llm/chat-row.js'

useTestDb()

async function newConn(): Promise<mysql.Connection> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set; dotenv -e .env.test.local missing?')
  return mysql.createConnection(url)
}

/** 插一行老 row(canonical_content NULL),返回 id */
async function insertLegacyRow(
  deckId: number,
  role: 'system' | 'user' | 'assistant' | 'tool',
  content: string,
  toolCallId: string | null = null,
): Promise<number> {
  // 用 raw SQL 绕过 drizzle 强类型校验(模拟 Phase 5 老 row 没 canonical_content 列存在前的入库)
  const db = getDb()
  await db.execute(
    sql`INSERT INTO deck_chats (deck_id, role, content, tool_call_id) VALUES (${deckId}, ${role}, ${content}, ${toolCallId})`,
  )
  const [r] = await db
    .select({ id: deckChats.id })
    .from(deckChats)
    .where(eq(deckChats.deckId, deckId))
    .orderBy(sql`id DESC`)
    .limit(1)
  if (!r) throw new Error('insertLegacyRow: 回查失败')
  return r.id
}

describe('migrateDeckChats(集成,真 lumideck_test DB)', () => {
  it('老 user/text row → canonical_content 填 [{type:text}]', async () => {
    const { user } = await createTestUser('chat-user-1@a.com')
    const { deck } = await createDeckDirect(user.id)
    const id = await insertLegacyRow(deck.id, 'user', '帮我加张图')

    const conn = await newConn()
    try {
      const stats = await migrateDeckChats(conn)
      expect(stats.migrated).toBe(1)
      expect(stats.skipped).toBe(0)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    const [row] = await getDb().select().from(deckChats).where(eq(deckChats.id, id)).limit(1)
    expect(row!.canonicalContent).not.toBeNull()
    const parsed = JSON.parse(row!.canonicalContent!)
    expect(parsed).toEqual([{ type: 'text', text: '帮我加张图' }])
  })

  it('老 assistant + OpenAI tool_calls JSON → text + tool_use blocks', async () => {
    const { user } = await createTestUser('chat-asst-tool@a.com')
    const { deck } = await createDeckDirect(user.id)
    const content = JSON.stringify({
      content: '我来调用工具',
      tool_calls: [{ id: 'tc-1', function: { name: 'edit_slide', arguments: '{"index":1}' } }],
    })
    const id = await insertLegacyRow(deck.id, 'assistant', content, null)

    const conn = await newConn()
    try {
      const stats = await migrateDeckChats(conn)
      expect(stats.migrated).toBe(1)
    } finally {
      await conn.end()
    }

    const [row] = await getDb().select().from(deckChats).where(eq(deckChats.id, id)).limit(1)
    const parsed = JSON.parse(row!.canonicalContent!)
    expect(parsed).toEqual([
      { type: 'text', text: '我来调用工具' },
      { type: 'tool_use', id: 'tc-1', name: 'edit_slide', input: { index: 1 } },
    ])
  })

  it('老 tool row(content=tool result + toolCallId)→ ToolResultBlock', async () => {
    const { user } = await createTestUser('chat-tool@a.com')
    const { deck } = await createDeckDirect(user.id)
    const id = await insertLegacyRow(deck.id, 'tool', '{"ok":true}', 'tc-result-1')

    const conn = await newConn()
    try {
      await migrateDeckChats(conn)
    } finally {
      await conn.end()
    }

    const [row] = await getDb().select().from(deckChats).where(eq(deckChats.id, id)).limit(1)
    const parsed = JSON.parse(row!.canonicalContent!)
    expect(parsed).toEqual([
      { type: 'tool_result', toolUseId: 'tc-result-1', content: '{"ok":true}' },
    ])
  })

  it('rowToCanonical 读出的形态跟老 row 重组一致', async () => {
    const { user } = await createTestUser('chat-roundtrip@a.com')
    const { deck } = await createDeckDirect(user.id)
    const id = await insertLegacyRow(deck.id, 'system', 'You are a helpful assistant.')

    const conn = await newConn()
    try {
      await migrateDeckChats(conn)
    } finally {
      await conn.end()
    }

    const [row] = await getDb().select().from(deckChats).where(eq(deckChats.id, id)).limit(1)
    const canonical = rowToCanonical({
      role: row!.role,
      content: row!.content,
      toolCallId: row!.toolCallId,
      canonicalContent: row!.canonicalContent,
    })
    expect(canonical).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'You are a helpful assistant.' }],
    })
  })

  it('canonical_content 已存在 → SELECT WHERE NULL 不捞,migrated=0', async () => {
    const { user } = await createTestUser('chat-already-done@a.com')
    const { deck } = await createDeckDirect(user.id)
    const id = await insertLegacyRow(deck.id, 'user', 'old text')
    // 手工先填一份 canonical_content,模拟之前跑过 migration
    await getDb()
      .update(deckChats)
      .set({ canonicalContent: JSON.stringify([{ type: 'text', text: 'pre-filled' }]) })
      .where(eq(deckChats.id, id))

    const conn = await newConn()
    try {
      const stats = await migrateDeckChats(conn)
      expect(stats.migrated).toBe(0)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    // 不应覆盖已填的值
    const [row] = await getDb().select().from(deckChats).where(eq(deckChats.id, id)).limit(1)
    expect(JSON.parse(row!.canonicalContent!)).toEqual([{ type: 'text', text: 'pre-filled' }])
  })

  it('batch 处理:超过 batchSize 也能完整跑完(用 batchSize=2 + 5 条 row 模拟)', async () => {
    const { user } = await createTestUser('chat-batch@a.com')
    const { deck } = await createDeckDirect(user.id)
    for (let i = 0; i < 5; i++) {
      await insertLegacyRow(deck.id, 'user', `msg-${i}`)
    }

    const conn = await newConn()
    try {
      const stats = await migrateDeckChats(conn, { batchSize: 2 })
      expect(stats.migrated).toBe(5)
    } finally {
      await conn.end()
    }

    const rows = await getDb().select().from(deckChats).where(eq(deckChats.deckId, deck.id))
    expect(rows).toHaveLength(5)
    for (const r of rows) {
      expect(r.canonicalContent).not.toBeNull()
    }
  })

  it('混合 4 类形态一次跑完', async () => {
    const { user } = await createTestUser('chat-mix@a.com')
    const { deck } = await createDeckDirect(user.id)
    await insertLegacyRow(deck.id, 'system', 'sys prompt')
    await insertLegacyRow(deck.id, 'user', 'do X')
    await insertLegacyRow(
      deck.id,
      'assistant',
      JSON.stringify({ content: null, tool_calls: [{ id: 'tc-1', function: { name: 'foo', arguments: '{}' } }] }),
    )
    await insertLegacyRow(deck.id, 'tool', 'result', 'tc-1')

    const conn = await newConn()
    try {
      const stats = await migrateDeckChats(conn)
      expect(stats.migrated).toBe(4)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    const rows = await getDb()
      .select()
      .from(deckChats)
      .where(eq(deckChats.deckId, deck.id))
      .orderBy(deckChats.id)

    expect(rows).toHaveLength(4)
    expect(JSON.parse(rows[0]!.canonicalContent!)).toEqual([{ type: 'text', text: 'sys prompt' }])
    expect(JSON.parse(rows[1]!.canonicalContent!)).toEqual([{ type: 'text', text: 'do X' }])
    expect(JSON.parse(rows[2]!.canonicalContent!)).toEqual([
      { type: 'tool_use', id: 'tc-1', name: 'foo', input: {} },
    ])
    expect(JSON.parse(rows[3]!.canonicalContent!)).toEqual([
      { type: 'tool_result', toolUseId: 'tc-1', content: 'result' },
    ])
  })
})
