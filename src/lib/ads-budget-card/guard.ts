/**
 * Fail-closed checks for one ad set daily budget card.
 * A non-green check keeps confirm closed. Nothing here calls Meta.
 */

import type { HardCheck } from '@/lib/confirmation-card/facts'
import { confirmBlockReason } from '@/lib/confirmation-card/facts'
import { checkBudgetWithinSafeRange } from '@/lib/meta/guardrails'
import { limitText, money, pctText } from './copy'
import type { BudgetOrder, BudgetSnapshot } from './types'

export interface GuardResult {
  readonly checks: readonly HardCheck[]
  readonly block: string | null
}

export function guardBudget(
  order: BudgetOrder,
  live: BudgetSnapshot,
  shownCents: number | null,
): GuardResult {
  const checks = [
    stepCheck(order, live),
    accountCapCheck(order, live),
    clientCapCheck(order, live),
    ownershipCheck(order, live),
    statusCheck(live),
    freshCheck(live, shownCents),
  ]
  return { checks, block: confirmBlockReason(checks) }
}

function stepCheck(order: BudgetOrder, live: BudgetSnapshot): HardCheck {
  if (live.stepRatio === 'unreadable') return unread('调整幅度', '允许的调整幅度读不到')
  if (live.stepRatio === 'off') return red('调整幅度', '这个客户关掉了调整日预算的确认卡。')
  if (live.stepRatio === 'invalid') return red('调整幅度', '这个客户允许的调整幅度设置无效，没有改。')
  if (!Number.isSafeInteger(live.currentCents) || (live.currentCents ?? 0) <= 0) {
    return unread('调整幅度', '现日预算读不到')
  }
  const problem = stepProblem(live.currentCents as number, order.newDailyBudgetCents, live.stepRatio)
  return problem ? red('调整幅度', problem) : green('调整幅度', '在允许的幅度里')
}

export function stepProblem(before: number, after: number, ratio: number): string | null {
  if (!Number.isSafeInteger(before) || before <= 0) return '现日预算读不到，没有改。'
  if (!Number.isSafeInteger(after) || after <= 0) return '新的日预算不是有效金额，没有改。'
  if (after === before) return '新日预算和现在一样，没有改。'
  if (checkBudgetWithinSafeRange(before, after, ratio).ok) return null
  const jump = `从 ${money(before)} 调到 ${money(after)}（${pctText(before, after)}）`
  return `一次最多上下调 ${limitText(ratio)}，这次${jump}超过了，没有改。`
}

function accountCapCheck(order: BudgetOrder, live: BudgetSnapshot): HardCheck {
  return capCheck('账户每日上限', order, live, 'account')
}

function clientCapCheck(order: BudgetOrder, live: BudgetSnapshot): HardCheck {
  return capCheck('客户每日总上限', order, live, 'client')
}

function capCheck(
  label: string,
  order: BudgetOrder,
  live: BudgetSnapshot,
  which: 'account' | 'client',
): HardCheck {
  if (live.lifetimeBlocks) return red(label, '有广告在用总预算，算不出每日合计，没有改。')
  const projected = projectAccount(order, live)
  if (!projected) return unread(label, '现在的每日预算合计读不到')
  if (which === 'account') return accountVerdict(label, projected, live.accountCapCents)
  return clientVerdict(label, projected, live)
}

function accountVerdict(label: string, projected: Projected, cap: number | null): HardCheck {
  if (!Number.isSafeInteger(cap) || (cap ?? 0) <= 0) return unread(label, '这个广告账户的每日上限读不到')
  if (projected.after > (cap as number) && projected.after > projected.before) {
    return red(label, '改完会超过这个广告账户的每日上限，没有改。')
  }
  return green(label, '没有超过这个广告账户的每日上限')
}

function clientVerdict(label: string, projected: Projected, live: BudgetSnapshot): HardCheck {
  if (!Number.isSafeInteger(live.otherAccountsLiveCents) || (live.otherAccountsLiveCents ?? -1) < 0) {
    return unread(label, '其它广告账户现在的日预算读不到')
  }
  const other = live.otherAccountsLiveCents as number
  const before = projected.before + other
  const after = projected.after + other
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) {
    return unread(label, '所有账户加在一起的日预算算不出来')
  }
  if (!Number.isSafeInteger(live.clientCapCents) || (live.clientCapCents ?? 0) <= 0) {
    if (after <= before) return green(label, '这次没有上调，不对照每天总上限')
    return red(label, '已批准的计划里还没有每天广告总上限，没有改。')
  }
  if (after > (live.clientCapCents as number) && after > before) {
    return red(label, '改完会超过这位客户所有广告账户加在一起的每日上限，没有改。')
  }
  return green(label, '没有超过所有广告账户加在一起的每日上限')
}

interface Projected {
  readonly before: number
  readonly after: number
}

function projectAccount(order: BudgetOrder, live: BudgetSnapshot): Projected | null {
  const current = live.accountLiveCents
  if (!Number.isSafeInteger(current) || (current ?? -1) < 0) return null
  if (live.countedInLive === null) return null
  if (!Number.isSafeInteger(live.currentCents) || !Number.isSafeInteger(order.newDailyBudgetCents)) return null
  const liveCents = current as number
  const beforeSet = live.currentCents as number
  if (live.countedInLive) {
    if (beforeSet > liveCents) return null
    const after = liveCents - beforeSet + order.newDailyBudgetCents
    if (!Number.isSafeInteger(after) || after < 0) return null
    return { before: liveCents, after }
  }
  if (order.newDailyBudgetCents > beforeSet) {
    const after = liveCents + order.newDailyBudgetCents
    return Number.isSafeInteger(after) ? { before: liveCents, after } : null
  }
  return { before: liveCents, after: liveCents }
}

function ownershipCheck(order: BudgetOrder, live: BudgetSnapshot): HardCheck {
  if (!live.registeredAccountIds || !live.accountId || !live.adsetId) {
    return unread('归属', '账户或这个广告组读不到')
  }
  if (live.adsetId !== order.adsetId) return red('归属', '读到的不是这一个广告组，没有改。')
  const setKnown = listed(live.registeredAccountIds, live.accountId)
  const orderKnown = listed(live.registeredAccountIds, order.adAccountId)
  if (!setKnown || !orderKnown || !sameAcct(live.accountId, order.adAccountId)) {
    return red('归属', '这个广告组不在这位客户已登记的广告账户里，没有改。')
  }
  return green('归属', '在已登记的广告账户里')
}

function statusCheck(live: BudgetSnapshot): HardCheck {
  if (!live.status) return unread('状态', '这个广告组的状态读不到')
  if (live.status !== 'ACTIVE' && live.status !== 'PAUSED') {
    return red('状态', '这个广告组现在不是在投或暂停，没有改。')
  }
  return green('状态', live.status === 'ACTIVE' ? '现在是在投' : '现在是暂停')
}

function freshCheck(live: BudgetSnapshot, shownCents: number | null): HardCheck {
  if (shownCents === null) return green('现预算', '刚从广告后台读到的')
  if (!Number.isSafeInteger(live.currentCents)) return unread('现预算', '现日预算读不到')
  if (live.currentCents !== shownCents) {
    return red('现预算', '这张卡上的现预算和广告后台现在的不一样，已经作废，没有改。')
  }
  return green('现预算', '和卡上的一样')
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

function green(label: string, reason: string): HardCheck {
  return { label, state: 'green', reason }
}

function red(label: string, reason: string): HardCheck {
  return { label, state: 'red', reason }
}

function unread(label: string, reason: string): HardCheck {
  return { label, state: 'unread', reason }
}
