/**
 * Plain-language facts for the pause card and the separate empty-campaign card.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import type { PauseOrder } from './order'

export function pauseSubject(order: PauseOrder): string {
  const prefix = order.level === 'ad' ? 'pause-ad:' : 'pause-set:'
  return `${prefix}${stamp(order)}`
}

export function emptyAckSubject(order: PauseOrder): string {
  return `pause-empty:${stamp(order)}`
}

export function pauseFacts(order: PauseOrder, checks: readonly HardCheck[]): CardFacts {
  return {
    subjectKey: pauseSubject(order),
    what: whatLine(order),
    account: '已登记的广告账户',
    amount: '不改预算',
    date: '确认之后才暂停',
    scope: order.successorAdId ? '一张卡两步：先回读新广告在投，再只暂停旧的' : '只暂停，不开启，不改预算',
    hardChecks: checks,
  }
}

export function emptyAckFacts(order: PauseOrder): CardFacts {
  return {
    subjectKey: emptyAckSubject(order),
    what: '单独确认：暂停后这个系列没有在投广告',
    account: '已登记的广告账户',
    amount: '不改预算',
    date: '只确认这句警告',
    scope: order.level === 'ad' ? '不暂停广告，只确认系列会空' : '不暂停广告组，只确认系列会空',
    hardChecks: [{ label: '只确认警告', state: 'green', reason: '确认本身不会改广告' }],
  }
}

function whatLine(order: PauseOrder): string {
  if (order.successorAdId) return '新广告在投之后，暂停被换下的旧广告'
  return order.level === 'ad' ? '暂停这条广告' : '暂停这个广告组'
}

function stamp(order: PauseOrder): string {
  return canonicalHashOfInput({
    sourceKind: order.sourceKind,
    sourceId: order.sourceId,
    stepId: order.stepId,
    level: order.level,
    campaignId: order.campaignId,
    adsetId: order.adsetId,
    adId: order.adId,
    successorAdId: order.successorAdId,
  }).slice(0, 12)
}
