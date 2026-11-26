/**
 * Confirm stays closed unless every check is green.
 * Pausing the last active ad set in the campaign is a refusal, not a second card.
 */

import type { HardCheck } from '@/lib/confirmation-card/facts'
import { confirmBlockReason } from '@/lib/confirmation-card/facts'
import type { PauseAdSetOrder } from './order'

export interface LiveAdSet {
  readonly id: string
  readonly status: string | null
  readonly accountId: string | null
}

export interface LiveFacts {
  readonly registeredAccountIds: readonly string[] | null
  readonly target: LiveAdSet | null
  readonly campaignAdSets: readonly LiveAdSet[] | null
}

export interface GuardResult {
  readonly checks: readonly HardCheck[]
  readonly block: string | null
}

export function guardPause(order: PauseAdSetOrder, live: LiveFacts, sourceReason: string | null): GuardResult {
  const checks = [
    { label: '只暂停', state: 'green' as const, reason: '不会开启，也不会改预算' },
    sourceCheck(sourceReason),
    ownershipCheck(order, live),
    activeCheck(live),
    emptyCheck(order, live),
  ]
  return { checks, block: confirmBlockReason(checks) }
}

function sourceCheck(reason: string | null): HardCheck {
  if (reason) return { label: '来源仍批准', state: 'red', reason }
  return { label: '来源仍批准', state: 'green', reason: '处方、目标和计划都还是当时那一版' }
}

function ownershipCheck(order: PauseAdSetOrder, live: LiveFacts): HardCheck {
  if (!live.registeredAccountIds || !live.target) {
    return { label: '仍属于这个客户', state: 'unread', reason: '账户或广告组读不到' }
  }
  const known = listed(live.registeredAccountIds, order.adAccountId)
    && listed(live.registeredAccountIds, live.target.accountId ?? '')
    && sameAcct(live.target.accountId ?? '', order.adAccountId)
  if (!known) return { label: '仍属于这个客户', state: 'red', reason: '广告组不在这个客户的账户里' }
  return { label: '仍属于这个客户', state: 'green', reason: '' }
}

function activeCheck(live: LiveFacts): HardCheck {
  if (!live.target) return { label: '广告组仍在投', state: 'unread', reason: '广告组状态读不到' }
  if (live.target.status !== 'ACTIVE') {
    return { label: '广告组仍在投', state: 'red', reason: '广告组已经不是在投，没有去暂停' }
  }
  return { label: '广告组仍在投', state: 'green', reason: '' }
}

function emptyCheck(order: PauseAdSetOrder, live: LiveFacts): HardCheck {
  const remaining = remainingActive(order.adsetId, live.campaignAdSets)
  if (remaining === null) return { label: '系列不会空', state: 'unread', reason: '系列里还有哪些在投广告组，现在读不到' }
  if (remaining === 'missing') return { label: '系列不会空', state: 'red', reason: '这个广告组不在该系列里' }
  if (remaining < 1) return { label: '系列不会空', state: 'red', reason: '暂停后这个系列就没有在投广告组了' }
  return { label: '系列不会空', state: 'green', reason: '暂停后系列里还有在投广告组' }
}

function remainingActive(adsetId: string, rows: readonly LiveAdSet[] | null): number | 'missing' | null {
  if (!rows) return null
  if (!rows.some((row) => row.id === adsetId)) return 'missing'
  if (rows.some((row) => !row.status)) return null
  const active = rows.filter((row) => row.status === 'ACTIVE')
  const includesTarget = active.some((row) => row.id === adsetId)
  return includesTarget ? active.length - 1 : active.length
}

function listed(ids: readonly string[], accountId: string): boolean {
  return accountId.length > 0 && ids.some((id) => sameAcct(id, accountId))
}

function sameAcct(left: string, right: string): boolean {
  return strip(left) === strip(right) && strip(left).length > 0
}

function strip(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}
