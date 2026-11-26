/** Plain-language facts. The what-line is also the click router. */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { ADD_CREATIVE_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import type { CreativeOrder } from './order'

export function creativeSubject(order: CreativeOrder): string {
  const stamp = canonicalHashOfInput({ adSetId: order.adSetId, adAccountId: order.adAccountId }).slice(0, 12)
  return `add-set:${stamp}`
}

export function creativeFacts(order: CreativeOrder, checks: readonly HardCheck[]): CardFacts {
  const paused = order.status === 'PAUSED'
  const name = order.adName.slice(0, 40)
  return {
    subjectKey: creativeSubject(order),
    what: ADD_CREATIVE_WHAT,
    account: '已登记的广告账户',
    amount: '不改预算',
    date: paused ? '确认之后才建，新广告先暂停' : '确认之后才建，新广告直接在投',
    scope: paused
      ? `只往这一组加一条图片广告「${name}」，先暂停，不改预算`
      : `只往这一组加一条图片广告「${name}」，按卡上的选择直接在投，不改预算`,
    hardChecks: checks,
  }
}
