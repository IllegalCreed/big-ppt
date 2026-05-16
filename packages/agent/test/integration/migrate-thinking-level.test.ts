/**
 * Phase 12.7 Task E:users.llm_settings.advanced.<scope>.thinkingEnabled →
 * thinkingLevel migration 集成测,走真 lumideck_test DB。
 *
 * 类比 migrate-llm-settings.test.ts:直接 import src 的 migrateThinkingLevel,
 * 不通过 spawn script(.mjs)走 dist —— 不依赖 build 产物。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import { useTestDb } from '../_setup/test-db.js'
import { createTestUser } from '../_setup/factories.js'
import { getDb, users } from '../../src/db/index.js'
import { eq } from 'drizzle-orm'
import { __setMasterKeyGetterForTesting, encryptApiKey, decryptApiKey } from '../../src/crypto/apikey.js'
import { migrateThinkingLevel } from '../../src/llm/migrations.js'

const FIXED_KEY = Buffer.alloc(32, 0xee)

useTestDb()

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

async function newConn(): Promise<mysql.Connection> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set; dotenv -e .env.test.local missing?')
  return mysql.createConnection(url)
}

async function setSettings(userId: number, plain: string | null): Promise<void> {
  await getDb()
    .update(users)
    .set({ llmSettings: plain ? encryptApiKey(plain) : null })
    .where(eq(users.id, userId))
}

async function readSettings(userId: number): Promise<unknown | null> {
  const [u] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.llmSettings) return null
  return JSON.parse(decryptApiKey(u.llmSettings))
}

describe('migrateThinkingLevel(集成,真 lumideck_test DB)', () => {
  it('thinkingEnabled=true → thinkingLevel="medium",字段被 drop', async () => {
    const { user } = await createTestUser('think-true@a.com')
    await setSettings(
      user.id,
      JSON.stringify({
        activeProvider: 'anthropic',
        providers: { anthropic: { apiKey: 'sk-ant' } },
        advanced: { anthropic: { thinkingEnabled: true, thinkingBudgetTokens: 5000 } },
      }),
    )

    const conn = await newConn()
    try {
      const stats = await migrateThinkingLevel(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(1)
      expect(stats.skipped).toBe(0)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    const after = (await readSettings(user.id)) as {
      advanced: { anthropic: { thinkingLevel?: string; thinkingEnabled?: boolean; thinkingBudgetTokens?: number } }
    }
    expect(after.advanced.anthropic.thinkingLevel).toBe('medium')
    expect(after.advanced.anthropic.thinkingEnabled).toBeUndefined()
    expect(after.advanced.anthropic.thinkingBudgetTokens).toBe(5000)
  })

  it('thinkingEnabled=false → thinkingLevel="off"', async () => {
    const { user } = await createTestUser('think-false@a.com')
    await setSettings(
      user.id,
      JSON.stringify({
        activeProvider: 'anthropic',
        providers: { anthropic: { apiKey: 'sk-ant' } },
        advanced: { anthropic: { thinkingEnabled: false } },
      }),
    )

    const conn = await newConn()
    try {
      const stats = await migrateThinkingLevel(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(1)
    } finally {
      await conn.end()
    }

    const after = (await readSettings(user.id)) as {
      advanced: { anthropic: { thinkingLevel?: string; thinkingEnabled?: boolean } }
    }
    expect(after.advanced.anthropic.thinkingLevel).toBe('off')
    expect(after.advanced.anthropic.thinkingEnabled).toBeUndefined()
  })

  it('已迁移(只有 thinkingLevel 无 thinkingEnabled)→ skip,DB 内容不变', async () => {
    const { user } = await createTestUser('think-already@a.com')
    const newShape = JSON.stringify({
      activeProvider: 'anthropic',
      providers: { anthropic: { apiKey: 'sk' } },
      advanced: { anthropic: { thinkingLevel: 'high' } },
    })
    await setSettings(user.id, newShape)
    const before = await readSettings(user.id)

    const conn = await newConn()
    try {
      const stats = await migrateThinkingLevel(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(0)
      expect(stats.skipped).toBe(1)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    const after = await readSettings(user.id)
    expect(after).toEqual(before)
  })

  it('row 无 thinkingEnabled 字段(从未配过)→ skip,不报错', async () => {
    const { user } = await createTestUser('think-none@a.com')
    const settings = JSON.stringify({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-o' } },
      advanced: { common: { temperature: 0.7 } },
    })
    await setSettings(user.id, settings)

    const conn = await newConn()
    try {
      const stats = await migrateThinkingLevel(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(0)
      expect(stats.skipped).toBe(1)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }
  })

  it('idempotent:同一 row 跑两次,第二次全 skip', async () => {
    const { user } = await createTestUser('think-idempotent@a.com')
    await setSettings(
      user.id,
      JSON.stringify({
        activeProvider: 'anthropic',
        providers: { anthropic: { apiKey: 'sk' } },
        advanced: { anthropic: { thinkingEnabled: true } },
      }),
    )

    const conn1 = await newConn()
    try {
      const stats1 = await migrateThinkingLevel(conn1, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats1.migrated).toBe(1)
    } finally {
      await conn1.end()
    }

    const conn2 = await newConn()
    try {
      const stats2 = await migrateThinkingLevel(conn2, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      // 第二次:已迁移 → skip(thinkingLevel 已存在,无 thinkingEnabled)
      expect(stats2.migrated).toBe(0)
      expect(stats2.skipped).toBe(1)
      expect(stats2.failed).toHaveLength(0)
    } finally {
      await conn2.end()
    }
  })
})
