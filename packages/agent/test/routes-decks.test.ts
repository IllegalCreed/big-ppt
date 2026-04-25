import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { decksRoute } from '../src/routes/decks.js'
import { authOptional, type AuthVars } from '../src/middleware/auth.js'
import { requestContextMiddleware } from '../src/middleware/request-context.js'
import { useTestDb } from './_setup/test-db.js'
import { createLoggedInUser, createDeckDirect } from './_setup/factories.js'
import { getDb, decks, deckChats, deckVersions } from '../src/db/index.js'
import { and, eq } from 'drizzle-orm'

useTestDb()

function makeApp() {
  const app = new Hono<{ Variables: AuthVars }>()
  app.use('*', authOptional)
  app.use('*', requestContextMiddleware)
  app.route('/api', decksRoute)
  return app
}

async function postJson(app: Hono, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}

describe('routes/decks', () => {
  it('未登录 → list/create/get/put/delete 全部 401', async () => {
    const app = makeApp()
    const checks = [
      app.request('/api/decks'),
      postJson(app, '/api/decks', { title: 'x' }),
      app.request('/api/decks/1'),
      app.request('/api/decks/1', { method: 'PUT', body: '{}', headers: { 'content-type': 'application/json' } }),
      app.request('/api/decks/1', { method: 'DELETE' }),
      app.request('/api/decks/1/versions'),
      postJson(app, '/api/decks/1/restore/1', {}),
      app.request('/api/decks/1/chats'),
      postJson(app, '/api/decks/1/chats', { role: 'user', content: 'x' }),
    ]
    const results = await Promise.all(checks)
    for (const r of results) expect(r.status).toBe(401)
  })

  it('POST /decks: 返回 deck + currentVersionId 指向 initial version', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    const res = await postJson(app, '/api/decks', { title: '我的新 Deck' }, cookie)
    expect(res.status).toBe(201)
    const { deck } = await res.json()
    expect(deck.title).toBe('我的新 Deck')
    expect(deck.currentVersionId).not.toBeNull()
    expect(deck.templateId).toBe('beitou-standard')

    // 验证 DB 有对应 version，message 来自模板初始化
    const db = getDb()
    const [v] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, deck.currentVersionId))
      .limit(1)
    expect(v?.deckId).toBe(deck.id)
    expect(v?.message).toBe('从模板 beitou-standard 初始化')
  })

  it('POST /decks: initialContent 自定义能落库', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    const custom = '---\ntheme: default\n---\n\n# Hello\n'
    const res = await postJson(app, '/api/decks', { title: 'T', initialContent: custom }, cookie)
    const { deck } = await res.json()
    const db = getDb()
    const [v] = await db.select().from(deckVersions).where(eq(deckVersions.id, deck.currentVersionId!)).limit(1)
    expect(v?.content).toBe(custom)
  })

  it('POST /decks: 未传 initialContent → 默认用 beitou-standard 的 starter.md（3 页骨架）', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    const res = await postJson(app, '/api/decks', { title: 'StarterCheck' }, cookie)
    expect(res.status).toBe(201)
    const { deck } = await res.json()
    expect(deck.templateId).toBe('beitou-standard')
    const db = getDb()
    const [v] = await db
      .select()
      .from(deckVersions)
      .where(eq(deckVersions.id, deck.currentVersionId!))
      .limit(1)
    // starter.md 至少包含三页分隔符 + 3 个 layout 标记
    expect(v?.content).toContain('layout: cover')
    expect(v?.content).toContain('layout: content')
    expect(v?.content).toContain('layout: back-cover')
    expect(v?.content).toContain('请填写标题')
  })

  it('POST /decks: 非法 templateId → 400，不落库', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const res = await postJson(
      app,
      '/api/decks',
      { title: 'X', templateId: 'does-not-exist' },
      cookie,
    )
    expect(res.status).toBe(400)
    const db = getDb()
    const rows = await db.select().from(decks).where(eq(decks.userId, user.id))
    expect(rows).toEqual([])
  })

  it('POST /decks: 显式传 templateId=beitou-standard 能写入对应字段', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    const res = await postJson(
      app,
      '/api/decks',
      { title: 'Y', templateId: 'beitou-standard' },
      cookie,
    )
    expect(res.status).toBe(201)
    const { deck } = await res.json()
    expect(deck.templateId).toBe('beitou-standard')
  })

  it('GET /decks: 列表结果携带 templateId 字段', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    await postJson(app, '/api/decks', { title: 'WithTemplateId' }, cookie)
    const res = await app.request('/api/decks', { headers: { Cookie: cookie } })
    const { decks: list } = await res.json()
    expect(list[0].templateId).toBe('beitou-standard')
  })

  it('GET /decks: 只返回 active/archived，不返回 deleted', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck: a } = await createDeckDirect(user.id, 'Active')
    const { deck: arch } = await createDeckDirect(user.id, 'Archived')
    const { deck: del } = await createDeckDirect(user.id, 'Deleted')
    const db = getDb()
    await db.update(decks).set({ status: 'archived' }).where(eq(decks.id, arch.id))
    await db.update(decks).set({ status: 'deleted' }).where(eq(decks.id, del.id))

    const res = await app.request('/api/decks', { headers: { Cookie: cookie } })
    const { decks: list } = await res.json()
    const titles = list.map((d: { title: string }) => d.title).sort()
    expect(titles).toEqual(['Active', 'Archived'])
    expect(list.find((d: { id: number }) => d.id === a.id).status).toBe('active')
    expect(list.find((d: { id: number }) => d.id === arch.id).status).toBe('archived')
  })

  it('GET /decks/:id: 跨用户访问 → 403', async () => {
    const app = makeApp()
    const a = await createLoggedInUser('a@a.com')
    const b = await createLoggedInUser('b@a.com')
    const { deck } = await createDeckDirect(a.user.id, 'A owned')

    const res = await app.request(`/api/decks/${deck.id}`, { headers: { Cookie: b.cookie } })
    expect(res.status).toBe(403)
  })

  it('GET /decks/:id: 不存在 → 404', async () => {
    const app = makeApp()
    const { cookie } = await createLoggedInUser()
    const res = await app.request('/api/decks/999999', { headers: { Cookie: cookie } })
    expect(res.status).toBe(404)
  })

  it('GET /decks/:id: 响应体含 templateId 字段', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'withTid')
    const res = await app.request(`/api/decks/${deck.id}`, { headers: { Cookie: cookie } })
    const { deck: d } = await res.json()
    expect(d.templateId).toBe('beitou-standard')
  })

  it('decks.template_id 在未显式传值时取 DB DEFAULT=beitou-standard', async () => {
    const { user } = await createLoggedInUser()
    const db = getDb()
    await db.insert(decks).values({ userId: user.id, title: 'NoTemplate' })
    const [row] = await db
      .select()
      .from(decks)
      .where(and(eq(decks.userId, user.id), eq(decks.title, 'NoTemplate')))
      .limit(1)
    expect(row?.templateId).toBe('beitou-standard')
  })

  it('GET /decks/:id: 返回 deck + currentVersion + versions[] 按时间倒序', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(user.id, 'With versions')
    // 再加两个 version（注意 createdAt 分辨率是秒级，要间隔 > 1s 才能看出倒序）
    const db = getDb()
    await db.insert(deckVersions).values({ deckId: deck.id, content: 'v2', message: 'edit', authorId: user.id })
    await new Promise((r) => setTimeout(r, 1100))
    await db.insert(deckVersions).values({ deckId: deck.id, content: 'v3', message: 'edit', authorId: user.id })

    const res = await app.request(`/api/decks/${deck.id}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const { deck: d, currentVersion, versions } = await res.json()
    expect(d.id).toBe(deck.id)
    expect(currentVersion.id).toBe(initialVersionId)
    expect(versions.length).toBeGreaterThanOrEqual(3)
    // 倒序：最近的 v3 在前（其创建时间 > 前面的）
    const times = versions.map((v: { createdAt: string }) => new Date(v.createdAt).getTime())
    for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i])
  })

  it('PUT /decks/:id: 改 title 成功，空 title → 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'Old Title')

    const ok = await app.request(`/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'New Title' }),
    })
    expect(ok.status).toBe(200)
    expect((await ok.json()).deck.title).toBe('New Title')

    const empty = await app.request(`/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: '   ' }),
    })
    expect(empty.status).toBe(400)
  })

  it('PUT /decks/:id: status 合法切换，非法值 → 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'X')

    const arch = await app.request(`/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'archived' }),
    })
    expect(arch.status).toBe(200)
    expect((await arch.json()).deck.status).toBe('archived')

    const bad = await app.request(`/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'deleted' }),
    })
    expect(bad.status).toBe(400) // 只允许 active/archived，deleted 走 DELETE
  })

  it('PUT /decks/:id: 空 body → 400 "没有可更新字段"', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)
    const res = await app.request(`/api/decks/${deck.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /decks/:id: 软删后 list 看不到', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id, 'To Delete')

    const res = await app.request(`/api/decks/${deck.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
    expect(res.status).toBe(200)

    const list = await app.request('/api/decks', { headers: { Cookie: cookie } })
    const { decks: rows } = await list.json()
    expect(rows.find((d: { id: number }) => d.id === deck.id)).toBeUndefined()
  })

  it('POST /decks/:id/restore/:vid: 前移 current_version_id；错 vid → 404', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck, initialVersionId } = await createDeckDirect(user.id, 'Restore')

    // 加一个新版本
    const db = getDb()
    await db.insert(deckVersions).values({ deckId: deck.id, content: 'v2', message: 'edit' })
    const [v2] = await db
      .select({ id: deckVersions.id })
      .from(deckVersions)
      .where(and(eq(deckVersions.deckId, deck.id), eq(deckVersions.content, 'v2')))
      .limit(1)
    await db.update(decks).set({ currentVersionId: v2!.id }).where(eq(decks.id, deck.id))

    // 回滚到 initial
    const res = await postJson(app, `/api/decks/${deck.id}/restore/${initialVersionId}`, {}, cookie)
    expect(res.status).toBe(200)
    const [updated] = await db.select().from(decks).where(eq(decks.id, deck.id)).limit(1)
    expect(updated!.currentVersionId).toBe(initialVersionId)

    // 非法 vid → 404
    const bad = await postJson(app, `/api/decks/${deck.id}/restore/999999`, {}, cookie)
    expect(bad.status).toBe(404)
  })

  it('Chats: 空列表开始；POST role 非法 → 400，content 缺失 → 400', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    const empty = await app.request(`/api/decks/${deck.id}/chats`, { headers: { Cookie: cookie } })
    expect(empty.status).toBe(200)
    expect((await empty.json()).chats).toEqual([])

    const badRole = await postJson(app, `/api/decks/${deck.id}/chats`, { role: 'stranger', content: 'x' }, cookie)
    expect(badRole.status).toBe(400)

    const noContent = await postJson(app, `/api/decks/${deck.id}/chats`, { role: 'user' }, cookie)
    expect(noContent.status).toBe(400)
  })

  it('Chats: POST 成功 + GET 按 createdAt 正序返回', async () => {
    const app = makeApp()
    const { user, cookie } = await createLoggedInUser()
    const { deck } = await createDeckDirect(user.id)

    await postJson(app, `/api/decks/${deck.id}/chats`, { role: 'user', content: 'hello' }, cookie)
    await new Promise((r) => setTimeout(r, 1100))
    await postJson(app, `/api/decks/${deck.id}/chats`, { role: 'assistant', content: 'hi' }, cookie)
    await new Promise((r) => setTimeout(r, 1100))
    await postJson(
      app,
      `/api/decks/${deck.id}/chats`,
      { role: 'tool', content: '{"ok":true}', toolCallId: 'tc-1' },
      cookie,
    )

    const res = await app.request(`/api/decks/${deck.id}/chats`, { headers: { Cookie: cookie } })
    const { chats } = await res.json()
    expect(chats.length).toBe(3)
    expect(chats.map((c: { role: string }) => c.role)).toEqual(['user', 'assistant', 'tool'])
    expect(chats[2].toolCallId).toBe('tc-1')

    // 跨用户访问同 deck chats → 403
    const other = await createLoggedInUser('other-chats@a.com')
    const forbid = await app.request(`/api/decks/${deck.id}/chats`, { headers: { Cookie: other.cookie } })
    expect(forbid.status).toBe(403)
  })
})
