/**
 * The card asks to put the daily budget back. It does not pause, raise, or
 * change a budget by itself.
 */

import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import type { ScaleFallbackProposal } from './rules'

const WHAT = '提议把日预算收回放量之前。只出确认卡，不暂停，不加预算，点确认也不会改预算。'

export function fallbackFacts(proposal: ScaleFallbackProposal): CardFacts {
  return {
    subjectKey: proposal.subjectKey,
    what: WHAT,
    account: '这位客户的广告账户',
    amount: amountLine(proposal),
    date: `${proposal.dayBefore} 到 ${proposal.yesterday}`,
    scope: scopeLine(proposal),
    hardChecks: checks(),
  }
}

function amountLine(proposal: ScaleFallbackProposal): string {
  const from = money(proposal.currentCents)
  const back = money(proposal.restoreCents)
  const currency = proposal.currency ? ` ${proposal.currency}` : ''
  const known = proposal.currency ? '' : '币种读不到。'
  return `每天从 ${from}${currency} 收回 ${back}${currency}。${known}不暂停，也不加预算。`
}

function scopeLine(proposal: ScaleFallbackProposal): string {
  const cpl = proposal.reasons.includes('cpl')
    ? '连续两个已结束的账户日，单次留资成本都高于目标的 1.3 倍。'
    : ''
  const empty = proposal.reasons.includes('zero_leads')
    ? '刚刚结束的那一天，花费达到日预算的一半，留资是 0。'
    : ''
  return `${cpl}${empty}不改计划上的阶段，也不改正在跑的预算。`
}

function checks(): readonly HardCheck[] {
  return [
    { label: '快照', state: 'green', reason: '最近一次抓全的广告快照还在有效期内。' },
    { label: '计划上限', state: 'green', reason: '收回后的金额不超过已批准计划的每天上限。' },
    { label: '不暂停', state: 'green', reason: '这张卡不暂停广告。' },
    { label: '不加预算', state: 'green', reason: '收回的金额低于现在的日预算。' },
  ]
}

function money(cents: number): string {
  const whole = Math.floor(cents / 100)
  const frac = String(cents % 100).padStart(2, '0')
  return `${whole}.${frac}`
}
