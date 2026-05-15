import type { CanonicalEvent } from '../types.js'

export interface CreateAgentOpts {
  userId: number
  deckId: number
  encryptedSettings: string
  signal: AbortSignal
}

export async function createAgent(_opts: CreateAgentOpts): Promise<never> {
  throw new Error('Task C 实施 pi-agent-core Agent 构造')
}

/** Task D translate-events 实施 */
export async function* runAgentTurn(
  _agent: unknown,
  _prompt: string,
): AsyncGenerator<CanonicalEvent> {
  throw new Error('Task D 实施')
  yield* [] as never[]
}
