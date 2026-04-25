/**
 * Phase 7D / P3-10：从 msw + fake timers 迁到 in-process agent + lumideck_test 集成测。
 *
 * 真后端下 switch job 几十毫秒就走完整个状态机，所以 fake-timer 节奏验证不再适用
 * （节奏 / abort / progress ratio 等纯 UI 行为留给 E2E + DeckEditorCanvas / TemplatePickerModal 单测覆盖）。
 *
 * 这里专测 useSwitchTemplateJob ↔ /api/decks/:id/switch-template ↔ /api/switch-template-jobs/:id 的端到端契约：
 *   - 注入 fake RewriteFn → POST → 轮询 → success；返回字段 newVersionId 真实存在
 *   - DB 真实落地：decks.template_id 改 + 新 version 带 templateId
 *   - rewriteFn 抛错 → state=failed → composable error 字段抛出 throw
 *   - 同模板切换 400（前置 validate 拦截，不创建 job）
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  setupIntegration,
  __setRewriteFnForTesting,
  getDb,
  decks,
  deckVersions,
  type RewriteFn,
} from './_setup/integration'
import { useSwitchTemplateJob } from '../src/composables/useSwitchTemplateJob'
import { useDecks } from '../src/composables/useDecks'

setupIntegration()

afterEach(() => {
  // 清测试注入，下条 test 走默认 prod RewriteFn（除非自己再注入）
  __setRewriteFnForTesting(null)
})

async function registerAndCreateBeitouDeck(email: string, title = 'X') {
  const reg = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw123456' }),
  })
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`)
  return useDecks().createDeck({ title })
}

describe('useSwitchTemplateJob (integration)', () => {
  it('成功路径：fake RewriteFn → POST → polling → success；DB.decks.template_id 同步更新', async () => {
    __setRewriteFnForTesting((async () => '---\nlayout: cover\nmainTitle: jingyeda 切后\n---\n') as RewriteFn)

    const deck = await registerAndCreateBeitouDeck('switch-ok@a.com', 'WillSwitch')
    const job = useSwitchTemplateJob()
    const result = await job.start({ deckId: deck.id, targetTemplateId: 'jingyeda-standard' })

    expect(job.stage.value).toBe('success')
    expect(result.newVersionId).toBeTypeOf('number')
    expect(result.snapshotVersionId).toBeTypeOf('number')

    // DB：decks.template_id 改成 jingyeda-standard；新 version 带 templateId='jingyeda-standard'；snapshot 带 'beitou-standard'
    const db = getDb()
    const [updated] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updated?.templateId).toBe('jingyeda-standard')
    expect(updated?.currentVersionId).toBe(result.newVersionId)

    const [newVer] = await db.select().from(deckVersions).where(eq(deckVersions.id, result.newVersionId!)).limit(1)
    expect(newVer?.templateId).toBe('jingyeda-standard')

    const [snapVer] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, result.snapshotVersionId!))
      .limit(1)
    expect(snapVer?.templateId).toBe('beitou-standard')
  })

  it('失败路径：RewriteFn 抛错 → composable 抛 + state=failed', async () => {
    __setRewriteFnForTesting((async () => {
      throw new Error('LLM mock 故意挂')
    }) as RewriteFn)

    const deck = await registerAndCreateBeitouDeck('switch-err@a.com', 'WillFail')
    const job = useSwitchTemplateJob()
    await expect(job.start({ deckId: deck.id, targetTemplateId: 'jingyeda-standard' })).rejects.toThrow(/LLM mock 故意挂/)
    expect(job.stage.value).toBe('failed')

    // DB：template_id 未改（保留 beitou-standard）；snapshot 仍写入（带 fromTemplateId='beitou-standard'）
    const db = getDb()
    const [updated] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updated?.templateId).toBe('beitou-standard')
  })

  it('同模板切换 400（前置 validate 拦截）→ composable error 字段非空', async () => {
    const deck = await registerAndCreateBeitouDeck('same-tpl@a.com', 'Same')
    const job = useSwitchTemplateJob()
    await expect(
      job.start({ deckId: deck.id, targetTemplateId: 'beitou-standard' }),
    ).rejects.toThrow()
    expect(job.error.value).toMatch(/目标模板与当前模板一致|400/)
  })

  it('未知目标模板 → 404；composable error 字段非空', async () => {
    const deck = await registerAndCreateBeitouDeck('bad-tpl@a.com', 'Bad')
    const job = useSwitchTemplateJob()
    await expect(
      job.start({ deckId: deck.id, targetTemplateId: 'no-such-template' }),
    ).rejects.toThrow()
    expect(job.error.value).toMatch(/不存在|404/)
  })
})

// 上面 4 条覆盖契约 + 端到端，下面留个轻量 reset hook（下次跑前注入回 null）
beforeEach(() => {
  __setRewriteFnForTesting(null)
})
