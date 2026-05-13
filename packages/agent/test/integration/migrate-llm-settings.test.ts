/**
 * Phase 12 Task F:users.llm_settings migration 集成测。
 *
 * 走真 lumideck_test DB:插入混合形态 user(老 shape / 新 shape / 损坏 cipher)→ 跑
 * migrateLlmSettings → SELECT 回读验证 shape 已转换 / failed 列表准确。
 *
 * 不通过 spawn script(.mjs)走 dist —— 直接 import src 的 migrateLlmSettings,
 * conn 用 mysql2 直连 DATABASE_URL(dotenv 已注入)。这样测试不依赖 build 产物。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import mysql from 'mysql2/promise'
import { useTestDb } from '../_setup/test-db.js'
import { createTestUser } from '../_setup/factories.js'
import { getDb, users } from '../../src/db/index.js'
import { eq } from 'drizzle-orm'
import { __setMasterKeyGetterForTesting, encryptApiKey, decryptApiKey } from '../../src/crypto/apikey.js'
import { migrateLlmSettings } from '../../src/llm/migrations.js'
import { parseLlmSettings } from '../../src/llm/settings.js'

const FIXED_KEY = Buffer.alloc(32, 0xcd)

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

describe('migrateLlmSettings(集成,真 lumideck_test DB)', () => {
  it('老 shape → 新 shape:provider/apiKey/baseUrl/model 全字段保留', async () => {
    const { user } = await createTestUser('legacy-full@a.com')
    await setSettings(
      user.id,
      JSON.stringify({
        provider: 'zhipu',
        apiKey: 'sk-zhi',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'GLM-5.1',
      }),
    )

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(1)
      expect(stats.skipped).toBe(0)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    const after = await readSettings(user.id)
    expect(after).toEqual({
      activeProvider: 'zhipu',
      providers: {
        zhipu: {
          apiKey: 'sk-zhi',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'GLM-5.1',
        },
      },
    })
    // 验证转完能过 zod
    expect(() => parseLlmSettings(after)).not.toThrow()
  })

  it('老 shape 只有 provider + apiKey(无 baseUrl/model)→ 转换后 provider 子对象也无这些字段', async () => {
    const { user } = await createTestUser('legacy-minimal@a.com')
    await setSettings(user.id, JSON.stringify({ provider: 'openai', apiKey: 'sk-min' }))

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(1)
    } finally {
      await conn.end()
    }

    const after = (await readSettings(user.id)) as { providers: Record<string, unknown> }
    expect(after).toEqual({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-min' } },
    })
  })

  it('已是新 shape → skip(不动 DB)', async () => {
    const { user } = await createTestUser('already-new@a.com')
    const newShape = JSON.stringify({
      activeProvider: 'openai',
      providers: { openai: { apiKey: 'sk-already' } },
    })
    await setSettings(user.id, newShape)
    const before = await readSettings(user.id)

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(0)
      expect(stats.skipped).toBe(1)
      expect(stats.failed).toHaveLength(0)
    } finally {
      await conn.end()
    }

    // DB 内容应一字不变
    const after = await readSettings(user.id)
    expect(after).toEqual(before)
  })

  it('已是新 shape 但 schema 校验失败 → failed(记录 reason)', async () => {
    const { user } = await createTestUser('bad-new-shape@a.com')
    // 表面是新 shape 但 providers 是数组
    await setSettings(
      user.id,
      JSON.stringify({ activeProvider: 'openai', providers: [] }),
    )

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(0)
      expect(stats.skipped).toBe(0)
      expect(stats.failed).toHaveLength(1)
      expect(stats.failed[0]).toMatchObject({ id: user.id })
      expect(stats.failed[0]!.reason).toMatch(/已是新 shape 但 zod 校验失败/)
    } finally {
      await conn.end()
    }
  })

  it('老 shape 但缺 apiKey → failed', async () => {
    const { user } = await createTestUser('legacy-no-key@a.com')
    await setSettings(user.id, JSON.stringify({ provider: 'zhipu' }))

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.failed).toHaveLength(1)
      expect(stats.failed[0]!.reason).toMatch(/老 shape 缺 provider 或 apiKey/)
    } finally {
      await conn.end()
    }
  })

  it('老 shape 但 provider 不在白名单 → migrate 后 zod failed', async () => {
    const { user } = await createTestUser('bad-provider@a.com')
    await setSettings(
      user.id,
      JSON.stringify({ provider: 'cohere', apiKey: 'sk-c' }),
    )

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.failed).toHaveLength(1)
      expect(stats.failed[0]!.reason).toMatch(/迁移后 zod 校验失败/)
    } finally {
      await conn.end()
    }
  })

  it('密文损坏(decrypt 抛错) → failed', async () => {
    const { user } = await createTestUser('bad-cipher@a.com')
    // 绕过 encryptApiKey,直接写非法密文
    await getDb()
      .update(users)
      .set({ llmSettings: 'v1:not-base64:not-base64:not-base64' })
      .where(eq(users.id, user.id))

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.failed).toHaveLength(1)
      expect(stats.failed[0]).toMatchObject({ id: user.id })
    } finally {
      await conn.end()
    }
  })

  it('llm_settings 是 NULL 的 user → 不被 SELECT 取出(WHERE IS NOT NULL),不计入任何 bucket', async () => {
    const { user: u1 } = await createTestUser('null-settings@a.com')
    const { user: u2 } = await createTestUser('legacy-mixed@a.com')
    await setSettings(u1.id, null)
    await setSettings(u2.id, JSON.stringify({ provider: 'openai', apiKey: 'sk' }))

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated + stats.skipped + stats.failed.length).toBe(1) // 只算 u2
      expect(stats.migrated).toBe(1)
    } finally {
      await conn.end()
    }
  })

  it('混合批:多 user 同时跑(老 + 新 + bad)→ 统计准确', async () => {
    const { user: legacy1 } = await createTestUser('mix-legacy-1@a.com')
    const { user: legacy2 } = await createTestUser('mix-legacy-2@a.com')
    const { user: already } = await createTestUser('mix-already-new@a.com')
    const { user: bad } = await createTestUser('mix-bad@a.com')

    await setSettings(legacy1.id, JSON.stringify({ provider: 'zhipu', apiKey: 'k1' }))
    await setSettings(legacy2.id, JSON.stringify({ provider: 'openai', apiKey: 'k2' }))
    await setSettings(
      already.id,
      JSON.stringify({ activeProvider: 'openai', providers: { openai: { apiKey: 'k-already' } } }),
    )
    await setSettings(bad.id, JSON.stringify({ activeProvider: 'openai', providers: [] }))

    const conn = await newConn()
    try {
      const stats = await migrateLlmSettings(conn, {
        encrypt: encryptApiKey,
        decrypt: decryptApiKey,
      })
      expect(stats.migrated).toBe(2)
      expect(stats.skipped).toBe(1)
      expect(stats.failed).toHaveLength(1)
      expect(stats.failed[0]).toMatchObject({ id: bad.id })
    } finally {
      await conn.end()
    }

    // legacy1 应已转换
    const a1 = await readSettings(legacy1.id)
    expect(a1).toMatchObject({ activeProvider: 'zhipu' })
    // already 不动
    const a3 = await readSettings(already.id)
    expect(a3).toMatchObject({ activeProvider: 'openai' })
  })
})
