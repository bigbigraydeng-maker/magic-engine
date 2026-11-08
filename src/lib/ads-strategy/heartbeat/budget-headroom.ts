/**
 * 在投每天预算合计 vs 客户总上限（纯函数，无 I/O）。
 * 数据用「今日实时」那份官方账户读数（live-view），不用定期快照：快照最多晚 6 小时，
 * 刚开的系列会漏算，「还剩多少」就会说大了。
 *
 * 🔴 读不到的部分（预算在系列层、账户没读到）一律计数并写出来，不当成 0 加进合计。
 */

import type { LiveAccountView } from './live-view'

export type HeadroomLevel = 'ample' | 'tight' | 'full' | 'over' | 'no_cap'

export interface BudgetHeadroom {
  /** 'unavailable' = 在投的账户用了不止一种币种，合计没有意义 */
  state: 'ok' | 'unavailable'
  /** 在投广告组日预算之和（账户币种，主单位，2 位小数）；只含读到预算的组 */
  totalDaily: number
  currency: string | null
  /** 在投但读不到日预算的广告组数（比如预算设在系列层）；不在 totalDaily 里 */
  unreadableCount: number
  /** 整个账户没读到的个数；有则 totalDaily 只是下限 */
  unreadableAccounts: number
  cap: number | null
  headroom: number | null
  level: HeadroomLevel
}

interface Tally {
  totalCents: number
  unreadableCount: number
  unreadableAccounts: number
  currencies: Set<string>
}

function tallyAccount(t: Tally, acc: LiveAccountView): void {
  if (acc.readState === 'unreadable') {
    t.unreadableAccounts += 1
    return
  }
  for (const a of acc.active) {
    if (a.budgetLevel !== 'adset' || a.dailyBudget === null) {
      t.unreadableCount += 1
      continue
    }
    t.totalCents += Math.round(a.dailyBudget * 100)
    if (acc.currency !== null) t.currencies.add(acc.currency)
  }
}

function levelOf(totalCents: number, capCents: number | null): HeadroomLevel {
  if (capCents === null) return 'no_cap'
  if (totalCents > capCents) return 'over'
  const headroomCents = capCents - totalCents
  if (headroomCents < 100) return 'full'
  if (headroomCents * 10 <= capCents) return 'tight'
  return 'ample'
}

export function computeBudgetHeadroom(accounts: readonly LiveAccountView[], capCents: number | null): BudgetHeadroom {
  const t: Tally = { totalCents: 0, unreadableCount: 0, unreadableAccounts: 0, currencies: new Set<string>() }
  for (const acc of accounts) tallyAccount(t, acc)

  const mixed = t.currencies.size > 1
  return {
    state: mixed ? 'unavailable' : 'ok',
    totalDaily: t.totalCents / 100,
    currency: t.currencies.size === 1 ? [...t.currencies][0] : null,
    unreadableCount: t.unreadableCount,
    unreadableAccounts: t.unreadableAccounts,
    cap: capCents === null ? null : capCents / 100,
    headroom: capCents === null ? null : (capCents - t.totalCents) / 100,
    level: mixed ? 'no_cap' : levelOf(t.totalCents, capCents),
  }
}
