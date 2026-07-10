export * as schema from './schema.js'
export {
  users,
  sessions,
  decks,
  shareLinks,
  deckVersions,
  deckChats,
  userMcpServers,
  deckAssets,
  userAssets,
} from './schema.js'
export type {
  User,
  NewUser,
  Session,
  NewSession,
  Deck,
  NewDeck,
  ShareLink,
  NewShareLink,
  DeckVersion,
  NewDeckVersion,
  DeckChat,
  NewDeckChat,
  UserMcpServer,
  NewUserMcpServer,
  DeckAsset,
  NewDeckAsset,
  UserAsset,
  NewUserAsset,
} from './schema.js'
export { getDb, closeDb } from './client.js'
