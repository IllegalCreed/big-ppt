/**
 * Phase 11.5 Task 0：image-llm-settings DB helper 加密往返 + 缺省语义。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useTestDb } from './_setup/test-db.js'
import { createTestUser } from './_setup/factories.js'
import { __setMasterKeyGetterForTesting } from '../src/crypto/apikey.js'
import {
  getImageLlmSettings,
  setImageLlmSettings,
  clearImageLlmSettings,
} from '../src/db/image-llm-settings.js'

const FIXED_KEY = Buffer.alloc(32, 0xcd)

useTestDb()

beforeAll(() => {
  __setMasterKeyGetterForTesting(() => FIXED_KEY)
})

afterAll(() => {
  __setMasterKeyGetterForTesting(null)
})

describe('db/image-llm-settings', () => {
  it('未配置用户：getImageLlmSettings 返回 null', async () => {
    const { user } = await createTestUser('a@a.com')
    const got = await getImageLlmSettings(user.id)
    expect(got).toBeNull()
  })

  it('set → get：完整字段加密往返一致', async () => {
    const { user } = await createTestUser('b@b.com')
    await setImageLlmSettings(user.id, {
      provider: 'openai',
      apiKey: 'sk-test-image-key-001',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-image-2',
    })
    const got = await getImageLlmSettings(user.id)
    expect(got).toEqual({
      provider: 'openai',
      apiKey: 'sk-test-image-key-001',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-image-2',
    })
  })

  it('set 仅必填字段 + 可选字段为 undefined：往返保留 undefined', async () => {
    const { user } = await createTestUser('c@c.com')
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-min' })
    const got = await getImageLlmSettings(user.id)
    expect(got).toEqual({ provider: 'openai', apiKey: 'sk-min' })
  })

  it('clearImageLlmSettings：清空后再读返回 null', async () => {
    const { user } = await createTestUser('d@d.com')
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-x' })
    await clearImageLlmSettings(user.id)
    const got = await getImageLlmSettings(user.id)
    expect(got).toBeNull()
  })

  it('两次 set 后 get：返回最后一次的值', async () => {
    const { user } = await createTestUser('e@e.com')
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-1', model: 'gpt-5.5' })
    await setImageLlmSettings(user.id, { provider: 'openai', apiKey: 'sk-2', model: 'gpt-image-2' })
    const got = await getImageLlmSettings(user.id)
    expect(got?.apiKey).toBe('sk-2')
    expect(got?.model).toBe('gpt-image-2')
  })

  it('跨用户隔离：A 的设置 B 读不到', async () => {
    const { user: a } = await createTestUser('iso-a@a.com')
    const { user: b } = await createTestUser('iso-b@b.com')
    await setImageLlmSettings(a.id, { provider: 'openai', apiKey: 'sk-only-a' })
    expect(await getImageLlmSettings(b.id)).toBeNull()
    expect((await getImageLlmSettings(a.id))?.apiKey).toBe('sk-only-a')
  })
})
