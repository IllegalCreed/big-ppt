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
  longtext,
  datetime,
  timestamp,
  mysqlEnum,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/mysql-core'

/**
 * MySQL MEDIUMBLOB(上限 16MB)。drizzle-orm 0.45 无内置 mediumBlob,用 customType 包一层。
 * mysql2 driver 读出 Buffer,写入接受 Buffer/string,这里都按 Buffer 处理。
 * Phase 11.5 用于 deck_assets.data(单图通常 1-3MB,远低于 16MB 上限)。
 */
const mediumBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'mediumblob'
  },
})

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
    /**
     * Phase 11.8: 选定的视觉锚图 asset id,生图时自动注入 baseImage 跨 slide 对齐风格。
     * - nullable: 未配 image LLM / 用户跳过选样 / 切模板清空时为 NULL
     * - 循环 FK 不显式声明（沿用 currentVersionId 套路）；application-level 保证一致性
     * - asset 被显式删除时由 routes/deck-assets 显式 set NULL，避免循环 FK 引入 drizzle-kit push 失败
     */
    anchorAssetId: varchar('anchor_asset_id', { length: 36 }),
    /**
     * Phase 11.8: 用户对锚图选样的"已决策"标记。语义:
     * - false (default): 还没问过 / 用户没显式跳过 → generate_slide_image 工具入口要阻塞等
     * - true: 用户显式跳过 → 允许无 anchor 生图(走 Phase 11.6 老路径)
     * 选定 anchor 后也置为 true(已决策);切模板时连同 anchor 一并 reset 为 false。
     * 老 deck 没配 image LLM 时此字段对工具无影响(工具内只检测"用户配 image LLM"的 case)。
     */
    anchorSkipped: boolean('anchor_skipped').default(false),
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
    /**
     * Phase 11.8: 写入此 version 时所属的 anchor asset id（snapshot 用 from / 新版本用 to）。
     * restore 时 fallback 同步 decks.anchor_asset_id 实现切模板可逆 anchor 恢复;NULL 视为旧数据保持原行为。
     * 跟 templateId 同源套路。
     */
    anchorAssetId: varchar('anchor_asset_id', { length: 36 }),
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
    /** 老字段(Phase 5–11):assistant OpenAI shape JSON / tool text / user text。canonical 双写期保留供老 row 读 + provider mock 输出兜底 */
    content: mediumtext('content').notNull(),
    /** 老字段:tool message 的 tool_call_id;canonical Block[] 把它包进 ToolResultBlock.toolUseId */
    toolCallId: varchar('tool_call_id', { length: 128 }),
    /**
     * Phase 12 Task F 新增:CanonicalMessage.content(`Block[]`)的 JSON 序列化。
     *
     * 双写期:新插入 row 同时填 content + canonicalContent;老 row 的 canonicalContent
     * 为 NULL,读路径 fallback 解析 content + toolCallId 重组 Block[](见 chat-row.ts)。
     *
     * 用 longtext(4GB 上限)预留 thinking blocks / 多模态 image base64 dataURL 等
     * 大体积场景;chat row 一般 1-10KB 用不完 mediumtext 16MB,但 thinking 模式 +
     * 长 tool result 字符串(generate_slide_image 返 base64)会撑到 mediumtext 上限。
     */
    canonicalContent: longtext('canonical_content'),
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

/**
 * Phase 11.5：deck 维度的图片资源(主要是 generate_slide_image 工具产物)。
 *
 * - 图片字节直接存 DB MEDIUMBLOB(单图 1-3MB,16MB 上限够用)
 * - 通过 GET /api/assets/:id 鉴权后返字节,Slidev 不碰资源
 * - onDelete cascade 让 deck/user 删除时 BLOB 自动清,无文件孤儿
 * - 无 slideIndex 字段:asset 与 slide 是松耦合,关联仅靠 slides.md 的 imageSrc 反向引用
 *   这样 deck_versions restore 回旧版本时 asset 仍可用
 * - bytesSize 冗余存储,后续做配额统计无需 OCTET_LENGTH 全表扫
 */
export const deckAssets = mysqlTable(
  'deck_assets',
  {
    id: varchar('id', { length: 36 }).primaryKey(), // crypto.randomUUID()
    deckId: int('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mimeType: varchar('mime_type', { length: 50 }).notNull(),
    bytesSize: int('bytes_size').notNull(),
    data: mediumBlob('data').notNull(),
    /** 出图 prompt 留档(可选,纯审计/分析用) */
    prompt: text('prompt'),
    /** 出图模型,如 'gpt-5.5' / 'gpt-image-2',用于成本核算 */
    model: varchar('model', { length: 50 }),
    /**
     * Phase 11.8: asset 用途分类。
     * - null: 默认/历史/普通 generate_slide_image 产物(slide imageSrc 指向用)
     * - 'anchor': 当前选定锚图(被 decks.anchor_asset_id 引用)
     * - 'mood-board-candidate': 候选未选中(用户可能挑选 / 换批)
     * - 'mood-board-discarded': 历史"换一批"丢弃 / 未中选(留待 Phase 17+ GC 清)
     */
    purpose: varchar('purpose', { length: 32 }),
    createdAt: timestamp('created_at').default(NOW).notNull(),
  },
  (t) => ({
    deckIdx: index('deck_assets_deck_idx').on(t.deckId),
    userIdx: index('deck_assets_user_idx').on(t.userId),
  }),
)

/**
 * Phase 13：用户级别上传素材池(PDF/DOCX/XLSX/Image/MD/TXT 等)。
 *
 * - 字节落本地 fs `${LUMIDECK_ASSETS_DIR}/<userId>/<assetId>`,本表只存元数据
 * - per-user / per-file quota 在 `src/uploads/quota.ts` 实现(默认 100MB / 10MB)
 * - sha256 仅 dedup hint,不强制 unique(同 user 同文件可多次上传保留多份元数据)
 * - extractedText 由 worker 异步填充,extractStatus 跟踪进度
 * - onDelete cascade:user 删除时 metadata 自动清,fs 字节由 user-delete 钩子清(后续 Task)
 */
export const userAssets = mysqlTable(
  'user_assets',
  {
    id: varchar('id', { length: 36 }).primaryKey(), // crypto.randomUUID()
    userId: int('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    /** 相对 LUMIDECK_ASSETS_DIR 的路径,典型为 `${userId}/${assetId}` */
    storagePath: varchar('storage_path', { length: 500 }).notNull(),
    extractedText: text('extracted_text'),
    extractStatus: mysqlEnum('extract_status', ['pending', 'running', 'done', 'failed', 'skipped'])
      .default('pending')
      .notNull(),
    extractErrorMsg: text('extract_error_msg'),
    uploadedAt: timestamp('uploaded_at').default(NOW).notNull(),
  },
  (t) => ({
    byUser: index('idx_user_assets_user_id').on(t.userId),
    byUserSha: index('idx_user_assets_user_sha').on(t.userId, t.sha256),
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
export type DeckAsset = typeof deckAssets.$inferSelect
export type NewDeckAsset = typeof deckAssets.$inferInsert
export type UserAsset = typeof userAssets.$inferSelect
export type NewUserAsset = typeof userAssets.$inferInsert
