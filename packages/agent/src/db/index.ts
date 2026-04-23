export * as schema from './schema.js'
export { users, sessions, decks, deckVersions, deckChats, slidevLock } from './schema.js'
export type {
  User,
  NewUser,
  Session,
  NewSession,
  Deck,
  NewDeck,
  DeckVersion,
  NewDeckVersion,
  DeckChat,
  NewDeckChat,
  SlidevLock,
} from './schema.js'
export { getDb, closeDb } from './client.js'
