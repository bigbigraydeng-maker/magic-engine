/** Display-only labels from an existing hold row after confirm. */

import type { CreativeHold } from './ledger'

export interface AddCreativeOutcome {
  readonly statusChip: string
  readonly statusLine: string
}

export function addCreativeOutcomeFromHold(hold: CreativeHold): AddCreativeOutcome | null {
  const line = hold.resultLine?.trim() ?? ''
  if (hold.status === 'executed') {
    return { statusChip: '已做完', statusLine: line || '新广告已经建好。' }
  }
  if (hold.status === 'failed') {
    return { statusChip: '没做成', statusLine: line || '加图没有做成。' }
  }
  return null
}