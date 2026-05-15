import type { CanonicalMessage } from '../types.js'

export function agentMessageToCanonical(_m: unknown): CanonicalMessage {
  throw new Error('Task B 实施(配合 tool-bridge)')
}

export function canonicalToAgentMessage(_m: CanonicalMessage): unknown {
  throw new Error('Task B 实施')
}
