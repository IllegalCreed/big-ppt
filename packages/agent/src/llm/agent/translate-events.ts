import type { CanonicalEvent } from '../types.js'

export async function* translateAgentStream(
  _agent: unknown,
  _prompt: string,
): AsyncGenerator<CanonicalEvent> {
  throw new Error('Task D 实施')
  yield* [] as never[]
}
