/**
 * Lumideck MySQL schema (Drizzle)
 *
 * Phase 5A 只建 users + sessions 两张表；
 * decks / deck_versions / deck_chats / slidev_lock 留给 5B。
 */
import { sql } from 'drizzle-orm'
import {
  mysqlTable,
  int,
  bigint,
  boolean,
  varchar,
  text,
  mediumtext,
  datetime,
  timestamp,
  mysqlEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core'

// Aliyun RDS 的 MySQL 5.7 不支持 `DEFAULT (now())` 括号表达式，统一用 raw CURRENT_TIMESTAMP
const NOW = sql`CURRENT_TIMESTAMP`
const NOW_ON_UPDATE = sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`

export const users = mysqlTable('users', {
  id: int('id').autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 60 }).notNull(), // bcrypt hash 固定 60
  /** AES-256-GCM ciphertext (JSON: {provider, apiKey, baseUrl, model})，master key 存环境变量 */
  llmSettings: text('llm_settings'),
  /**
   * Phase 11.5：生图模型独立配置（与主 LLM 完全解耦）。
   * AES-256-GCM ciphertext (JSON: {provider, apiKey, baseUrl?, model?})。
   * NULL 表示未配置 → generate_slide_image 工具显式拒绝。
   */
  imageLlmSettings: text('image_llm_settings'),
  createdAt: timestamp('created_at').default(NOW).notNull(),
  updatedAt: timestamp('updated_at').default(NOW_ON_UPDATE).notNull(),
})

export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 32 }).primaryKey(), // crypto.randomBytes(16).hex
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 当前激活的 deck id */
    activeDeckId: int('active_deck_id'),
    /** 客户端每 30s 刷新；超时用于单实例锁的释放判定 */
    lastHeartbeatAt: datetime('last_heartbeat_at'),
    expiresAt: datetime('expires_at').notNull(),
    createdAt: timestamp('created_at').default(NOW).notNull(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
)

export const decks = mysqlTable(
  'decks',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    /** 与模板体系解耦的"视觉主题变体"占位字段，目前不使用，留给未来（深色/浅色/色板微调） */
    themeId: varchar('theme_id', { length: 64 }).default('default').notNull(),
    /** 模板 id，对应 templates/<template_id>/manifest.json；新建 deck 时 starter.md 来源 */
    templateId: varchar('template_id', { length: 64 })
      .default('beitou-standard')
      .notNull(),
    /** 指向当前激活的 version；删除 version 时置 NULL（循环 FK，建表时必须可空） */
    currentVersionId: int('current_version_id'),
    status: mysqlEnum('status', ['active', 'archived', 'deleted']).default('active').notNull(),
    createdAt: timestamp('created_at').default(NOW).notNull(),
    updatedAt: timestamp('updated_at').default(NOW_ON_UPDATE).notNull(),
  },
  (t) => ({
    userStatusIdx: index('decks_user_status_idx').on(t.userId, t.status),
    userTemplateIdx: index('decks_user_template_idx').on(t.userId, t.templateId),
  }),
)

export const deckVersions = mysqlTable(
  'deck_versions',
  {
    id: int('id').autoincrement().primaryKey(),
    deckId: int('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    /** 完整 slides.md 内容；append-only，restore 不新增记录只移动 current_version_id */
    content: mediumtext('content').notNull(),
    /** 可选版本说明；未来允许用户写 commit-like message */
    message: varchar('message', { length: 255 }),
    /** 同一 turn 多次写标记为同组，UI 可折叠显示 */
    turnId: varchar('turn_id', { length: 64 }),
    /**
     * Phase 7D：写入此 version 时所属的模板 id（snapshot 用 from / 新版本用 to）。
     * restore 时 fallback 同步 decks.template_id 实现切模板可逆；NULL 视为旧数据保持原行为。
     */
    templateId: varchar('template_id', { length: 64 }),
    authorId: int('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').default(NOW).notNull(),
  },
  (t) => ({
    deckCreatedIdx: index('deck_versions_deck_created_idx').on(t.deckId, t.createdAt),
  }),
)

export const deckChats = mysqlTable(
  'deck_chats',
  {
    id: bigint('id', { mode: 'number' }).autoincrement().primaryKey(),
    deckId: int('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    role: mysqlEnum('role', ['system', 'user', 'assistant', 'tool']).notNull(),
    content: mediumtext('content').notNull(),
    toolCallId: varchar('tool_call_id', { length: 128 }),
    createdAt: timestamp('created_at').default(NOW).notNull(),
  },
  (t) => ({
    deckCreatedIdx: index('deck_chats_deck_created_idx').on(t.deckId, t.createdAt),
  }),
)

// 单实例占用锁已改为 agent 进程内存（见 src/slidev-lock.ts），不落 DB。

/**
 * Phase 9-F：MCP server per-user 入库（A01 修复）。
 * 之前是全局 data/mcp.json 共享，所有用户操作同一份 → 跨用户凭据共享漏洞。
 *
 * - headers 字段是 AES-256-GCM 加密后的 JSON（key 明文 / value 密文）；落库前 encrypt，读时 decrypt
 * - preset 标记预置 server（4 个智谱 MCP）；首次 list(userId) 时自动 seed，preset 不可删
 * - (userId, serverId) 组合唯一，防同 user 创建重复 id
 */
export const userMcpServers = mysqlTable(
  'user_mcp_servers',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serverId: varchar('server_id', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    url: varchar('url', { length: 1024 }).notNull(),
    /** AES-256-GCM 加密后的 JSON: {[headerKey]: 'v1:...'}；空对象用 '{}' 表示 */
    headers: text('headers').notNull(),
    enabled: boolean('enabled').default(false).notNull(),
    preset: boolean('preset').default(false).notNull(),
    badge: varchar('badge', { length: 64 }),
    createdAt: timestamp('created_at').default(NOW).notNull(),
    updatedAt: timestamp('updated_at').default(NOW_ON_UPDATE).notNull(),
  },
  (t) => ({
    userServerIdx: uniqueIndex('user_mcp_servers_user_server_uniq').on(t.userId, t.serverId),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Deck = typeof decks.$inferSelect
export type NewDeck = typeof decks.$inferInsert
export type DeckVersion = typeof deckVersions.$inferSelect
export type NewDeckVersion = typeof deckVersions.$inferInsert
export type DeckChat = typeof deckChats.$inferSelect
export type NewDeckChat = typeof deckChats.$inferInsert
export type UserMcpServer = typeof userMcpServers.$inferSelect
export type NewUserMcpServer = typeof userMcpServers.$inferInsert
