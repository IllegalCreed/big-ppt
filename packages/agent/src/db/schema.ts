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
  varchar,
  text,
  mediumtext,
  datetime,
  timestamp,
  mysqlEnum,
  index,
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
      .default('company-standard')
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
