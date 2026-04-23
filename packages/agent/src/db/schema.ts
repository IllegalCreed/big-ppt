/**
 * Lumideck MySQL schema (Drizzle)
 *
 * Phase 5A 只建 users + sessions 两张表；
 * decks / deck_versions / deck_chats / slidev_lock 留给 5B。
 */
import { sql } from 'drizzle-orm'
import { mysqlTable, int, varchar, text, datetime, timestamp, index } from 'drizzle-orm/mysql-core'

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
    /** 当前激活的 deck id，5B 之后才会被写入；5A 先留空 */
    activeDeckId: int('active_deck_id'),
    /** 客户端每 30s 刷新；超时用于单实例锁的释放判定（5B 启用） */
    lastHeartbeatAt: datetime('last_heartbeat_at'),
    expiresAt: datetime('expires_at').notNull(),
    createdAt: timestamp('created_at').default(NOW).notNull(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
