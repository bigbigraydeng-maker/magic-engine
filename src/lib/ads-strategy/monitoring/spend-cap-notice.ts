/**
 * 真实花费 vs 客户日预算上限 —— 只读提醒判据（不触发熔断、不改广告）。
 * 合计口径与 circuit-detectors 一致；门槛是「严格大于上限」，不是熔断用的 1.2 倍。
 */

import type { ClientCapFacts } from '@/lib/ads-strategy/circuit-cap-facts'
import type { AccountSpendFact } from '@/lib/ads-strategy/circuit-detectors'

export type SpendCapNoticeVerdict =
  | { alert: false }
  | {
      alert: true
      referenceDate: string
      capMajor: number
      spendMajor: number
      currency: string
    }
  | { alert: false; skipReason: 'no_cap' | 'unreadable' | 'mixed_currency' | 'no_spend_data' }

type Contribution =
  | { ok: true; cents: number }
  | { ok: false }

/** 与 circuit-detectors `accountContribution` 相同语义（只读副本，避免改 A 级判据文件）。 */
function accountContribution(
  account: AccountSpendFact,
  clientReferenceDate: string,
): Contribution {
  const { lastCompleteDate, spendCents, hasDeliveringEntity } = account
  if (lastCompleteDate !== null && lastCompleteDate > clientReferenceDate) {
    return { ok: false }
  }
  if (lastCompleteDate === clientReferenceDate) {
    return { ok: true, cents: spendCents ?? 0 }
  }
  if (hasDeliveringEntity === false) {
    return { ok: true, cents: 0 }
  }
  return { ok: false }
}

export function evaluateDailySpendOverCapNotice(facts: ClientCapFacts): SpendCapNoticeVerdict {
  if (facts.configSource === 'fallback' || facts.configSource === 'default') {
    return { alert: false, skipReason: 'unreadable' }
  }
  if (facts.capCents === null || facts.capCents <= 0) {
    return { alert: false, skipReason: 'no_cap' }
  }
  if (facts.accounts.length === 0) {
    return { alert: false, skipReason: 'no_spend_data' }
  }

  let totalCents = 0
  const currencies = new Set<string>()
  for (const account of facts.accounts) {
    const c = accountContribution(account, facts.clientReferenceDate)
    if (!c.ok) return { alert: false, skipReason: 'no_spend_data' }
    totalCents += c.cents
    if (c.cents > 0 && account.currency !== null) currencies.add(account.currency)
  }
  if (currencies.size > 1) {
    return { alert: false, skipReason: 'mixed_currency' }
  }
  const currency = currencies.size === 1 ? [...currencies][0] : null
  if (currency === null && totalCents > 0) {
    return { alert: false, skipReason: 'no_spend_data' }
  }

  if (totalCents <= facts.capCents) {
    return { alert: false }
  }

  return {
    alert: true,
    referenceDate: facts.clientReferenceDate,
    capMajor: facts.capCents / 100,
    spendMajor: totalCents / 100,
    currency: currency ?? '—',
  }
}

export function spendCapNoticeWhat(
  clientName: string,
  v: Extract<SpendCapNoticeVerdict, { alert: true }>,
): string {
  return (
    `${clientName} 在 ${v.referenceDate} 这一天的广告花费合计 ${v.spendMajor.toFixed(2)} ${v.currency}，` +
    `高于设定的日预算上限 ${v.capMajor.toFixed(2)} ${v.currency}。` +
    '这条只是提醒，系统没有自动暂停或改预算。'
  )
}
