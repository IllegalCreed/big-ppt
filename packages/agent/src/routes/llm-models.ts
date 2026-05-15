/**
 * Phase 12.5 Task D：`GET /api/llm/models?provider=<id>` 端点。
 *
 * 调 pi-ai 的 `getModels(piProvider)`（同步函数，返 Model 数组）拿可用 model
 * 列表，给 Settings UI 的 model dropdown 用。
 *
 * 设计要点：
 * - 鉴权：`requireAuth` 风格（authOptional 已在 app 顶层挂；本路由仅 `c.get('user')` 判 401）。
 *   未登录返 401 而非空列表，避免泄漏 pi-ai 支持的 model 元信息给匿名用户。
 * - provider id 翻译：复用 `toPiAiProviderId`（Task B 已 export），不重复维护 map。
 * - cache：module-level `Map<piProviderId, ModelInfo[]>`，进程 lifetime 内不刷。
 *   pi-ai 的 MODELS 表是静态常量编译进 SDK，单进程内永不变；缓存只是省 array.map 开销。
 * - 错误降级：pi-ai 内部抛错时（e.g. provider key 不在 MODELS）返默认 model 单选项保底，
 *   让 UI 不至于完全空白；用户可手填任意 model id（前端 combobox 允许自由输入）。
 */
import { Hono } from 'hono'
import { getModels, type KnownProvider } from '@earendil-works/pi-ai'
import type { AuthVars } from '../middleware/auth.js'
import { ActiveProviderIdSchema } from '../llm/settings.js'
import { getProviderEntry, type ProviderId } from '@big-ppt/shared'
import { toPiAiProviderId } from '../llm/adapters/pi-ai-adapter.js'
import { logServerEvent } from '../logger/server-log.js'

export type ModelInfo = { id: string; name: string }

/**
 * 进程级 cache。key 是 pi-ai 内部 provider id（翻译后），value 是该 provider
 * 的 model 列表。pi-ai 0.74.0 内置 MODELS 表是 const，单进程内不会变。
 *
 * @internal 仅测试可重置（暂未暴露 reset hook —— 当前测试用例不依赖 cache 隔离）。
 */
const cache = new Map<string, ModelInfo[]>()

export const llmModels = new Hono<{ Variables: AuthVars }>()

llmModels.get('/', (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { message: 'unauthorized' } }, 401)

  const providerParam = c.req.query('provider')
  const parsed = ActiveProviderIdSchema.safeParse(providerParam)
  if (!parsed.success) {
    return c.json({ error: { message: `unknown provider: ${providerParam}` } }, 400)
  }
  const ourProvider = parsed.data
  const piProvider = toPiAiProviderId(ourProvider)

  const cached = cache.get(piProvider)
  if (cached) {
    return c.json({ models: cached })
  }

  try {
    // pi-ai 0.74.0 getModels 是同步函数（返 Model[] 常量数组），不是 Promise
    const piModels = getModels(piProvider as KnownProvider)
    const list: ModelInfo[] = piModels.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
    }))
    cache.set(piProvider, list)
    return c.json({ models: list })
  } catch (e) {
    logServerEvent({
      category: 'llm-models',
      event: 'list-failed',
      userId: user.id,
      provider: ourProvider,
      piProvider,
      errorMsg: (e as Error).message,
    })
    // 降级：返默认 model 单选项让 UI 不至于空白；用户也可在 combobox 自由输入。
    const defaultModel = getProviderEntry(ourProvider as ProviderId)?.defaultModel ?? ''
    const fallback: ModelInfo[] = defaultModel ? [{ id: defaultModel, name: defaultModel }] : []
    return c.json({ models: fallback })
  }
})
