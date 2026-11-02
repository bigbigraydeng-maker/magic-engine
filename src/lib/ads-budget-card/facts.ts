/** Card words for one ad set. The current amount is the one just read back. */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import { amountLine, budgetWhat, clipName } from './copy'
import type { BudgetOrder, BudgetSnapshot } from './types'

export function budgetSubject(order: BudgetOrder): string {
  const stamp = canonicalHashOfInput({
    adsetId: order.adsetId,
    adAccountId: order.adAccountId,
  }).slice(0, 12)
  return `budget-set:${stamp}`
}

export function budgetOrderKey(order: BudgetOrder): string {
  return canonicalHashOfInput({
    adsetId: order.adsetId,
    adAccountId: order.adAccountId,
    newDailyBudgetCents: order.newDailyBudgetCents,
  })
}

export function budgetFacts(
  order: BudgetOrder,
  live: BudgetSnapshot,
  checks: readonly HardCheck[],
): CardFacts {
  const before = live.currentCents as number
  const name = clipName(live.name ?? order.name)
  return {
    subjectKey: budgetSubject(order),
    what: budgetWhat(name, before, order.newDailyBudgetCents),
    account: '已登记的广告账户',
    amount: amountLine(before, order.newDailyBudgetCents),
    date: '确认之后才改',
    scope: '只改这一个广告组的日预算，不会自动改',
    hardChecks: checks,
  }
}
