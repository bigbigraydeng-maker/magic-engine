/**
 * Plain-language facts for the one pause card.
 * The what-line is also the click router, so it must stay exact.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import { PAUSE_AD_SET_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import type { PauseAdSetOrder } from './order'

export { PAUSE_AD_SET_WHAT }

export function pauseSubject(order: PauseAdSetOrder): string {
  return `pause-set:${canonicalHashOfInput({
    prescriptionId: order.prescriptionId,
    version: order.version,
    adsetId: order.adsetId,
    metric: order.metric,
    observationDays: order.observationDays,
  }).slice(0, 12)}`
}

export function pauseFacts(order: PauseAdSetOrder, checks: readonly HardCheck[]): CardFacts {
  return {
    subjectKey: pauseSubject(order),
    what: PAUSE_AD_SET_WHAT,
    account: '已登记的广告账户',
    amount: '不改预算',
    date: `确认之后才暂停，之后观察 ${order.observationDays} 天`,
    scope: '只暂停这一个广告组，不开启，不改预算',
    hardChecks: checks,
  }
}
