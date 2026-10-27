import {
  CHAIN_STATE_LABEL,
  CHAIN_STEP_LABEL,
  type ChainStep,
  type ChainStepId,
  type ChainStepState,
} from './types'

export function chainStep(id: ChainStepId, state: ChainStepState, detail: string): ChainStep {
  return {
    id,
    label: CHAIN_STEP_LABEL[id],
    state,
    stateLabel: CHAIN_STATE_LABEL[state],
    detail: state === 'unread' ? '读不到' : detail,
  }
}

export function unreadStep(id: ChainStepId): ChainStep {
  return chainStep(id, 'unread', '读不到')
}

export function waitingStep(id: ChainStepId): ChainStep {
  return chainStep(id, 'waiting', '')
}

/** Hide database and secret-shaped failures. A blank failure stays a blank failure. */
export function plainFailure(message: string | null, fallback: string): string {
  if (!message) return fallback
  const one = message.replace(/\s+/g, ' ').trim()
  if (one.length === 0) return fallback
  if (/select |insert |update |delete |password|token|secret|api[_-]?key|relation "|stack/i.test(one)) {
    return fallback
  }
  return one.length > 80 ? `${one.slice(0, 80)}…` : one
}
