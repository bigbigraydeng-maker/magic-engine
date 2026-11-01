/**
 * Checks for a pause card. Confirm stays closed unless every check is green.
 * This card can only pause. It never treats a missing metric as a default.
 */

import type { HardCheck } from '@/lib/confirmation-card/facts'
import { confirmBlockReason } from '@/lib/confirmation-card/facts'
import type { LiveAd, PauseOrder } from './order'

export interface LiveObject {
  readonly campaignId: string
  readonly accountId: string
  readonly adsetId: string | null
}

export interface LiveFacts {
  readonly registeredAccountIds: readonly string[] | null
  readonly object: LiveObject | null
  readonly campaignAds: readonly LiveAd[] | null
  /** null when this order does not replace anything, or when the new ad could not be read. */
  readonly successorEffectiveStatus: string | null
  readonly successorReadable: boolean
}

export interface GuardResult {
  readonly checks: readonly HardCheck[]
  readonly block: string | null
  readonly needsEmptyAck: boolean
}

export function guardPause(order: PauseOrder, live: LiveFacts, emptyAckConfirmed: boolean): GuardResult {
  const checks = [
    pauseOnlyCheck(),
    ownershipCheck(order, live),
    emptyCheck(order, live, emptyAckConfirmed),
    basisCheck(order),
    metricCheck(order),
    ...successorChecks(order, live),
  ]
  const empty = checks.find((check) => check.label === '系列会空')
  const needsEmptyAck = empty?.state === 'red'
  return { checks, block: confirmBlockReason(checks), needsEmptyAck }
}

function pauseOnlyCheck(): HardCheck {
  return { label: '只暂停', state: 'green', reason: '不会开启，也不会改预算' }
}

function ownershipCheck(order: PauseOrder, live: LiveFacts): HardCheck {
  if (!live.registeredAccountIds || !live.object) {
    return { label: '归属', state: 'unread', reason: '账户或这条广告读不到' }
  }
  const knownOrder = listed(live.registeredAccountIds, order.adAccountId)
  const knownObject = listed(live.registeredAccountIds, live.object.accountId)
  const sameAccount = sameAcct(live.object.accountId, order.adAccountId)
  const sameCampaign = live.object.campaignId === order.campaignId
  const sameSet = !order.adsetId || live.object.adsetId === order.adsetId
  if (!knownOrder || !knownObject || !sameAccount || !sameCampaign || !sameSet) {
    return { label: '归属', state: 'red', reason: '不属于这个客户的已知账户和系列' }
  }
  return { label: '归属', state: 'green', reason: '' }
}

function emptyCheck(order: PauseOrder, live: LiveFacts, acked: boolean): HardCheck {
  const remaining = remainingActive(order, live.campaignAds)
  if (remaining === null) return { label: '系列会空', state: 'unread', reason: '系列里还有哪些在投广告，现在读不到' }
  if (remaining > 0) return { label: '系列会空', state: 'green', reason: '暂停后系列里还有在投广告' }
  if (acked) return { label: '系列会空', state: 'green', reason: '已单独确认：暂停后这个系列没有在投广告' }
  return { label: '系列会空', state: 'red', reason: '暂停后这个系列没有在投广告，要单独确认' }
}

function basisCheck(order: PauseOrder): HardCheck {
  return { label: '改动依据', state: 'green', reason: clip(order.basis) }
}

function metricCheck(order: PauseOrder): HardCheck {
  return { label: '预期指标', state: 'green', reason: order.expectedMetric }
}

function successorChecks(order: PauseOrder, live: LiveFacts): HardCheck[] {
  if (!order.successorAdId) return []
  if (!live.successorReadable || !live.successorEffectiveStatus) {
    return [{ label: '新广告在投', state: 'unread', reason: '新广告的状态读不到，先不能停旧的' }]
  }
  if (live.successorEffectiveStatus !== 'ACTIVE') {
    return [{ label: '新广告在投', state: 'red', reason: '新广告还没回读到在投，先不能停旧的' }]
  }
  return [{ label: '新广告在投', state: 'green', reason: '新广告已回读为在投' }]
}

/** Active ads that would still be running. null = could not tell. */
export function remainingActive(order: PauseOrder, ads: readonly LiveAd[] | null): number | null {
  if (!ads) return null
  let stay = 0
  for (const ad of ads) {
    if (!ad.effectiveStatus) return null
    if (ad.effectiveStatus !== 'ACTIVE') continue
    if (order.level === 'ad' && ad.id === order.adId) continue
    if (order.level === 'ad_set' && ad.adsetId === order.adsetId) continue
    stay += 1
  }
  return stay
}

function listed(ids: readonly string[], accountId: string): boolean {
  return ids.some((id) => sameAcct(id, accountId))
}

function sameAcct(left: string, right: string): boolean {
  return strip(left) === strip(right)
}

function strip(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

function clip(value: string): string {
  return value.trim().slice(0, 80)
}
