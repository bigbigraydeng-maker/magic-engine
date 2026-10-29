import type {
  BreakdownKey,
  BreakdownStatRow,
  SpendReconciliation,
} from './types'

/** Relative spend tolerance (1%). */
export const SPEND_TOLERANCE_RELATIVE = 0.01
/** Absolute spend tolerance (0.05 in account currency). */
export const SPEND_TOLERANCE_ABSOLUTE = 0.05

/** Round to 2 decimals (spend precision). */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Sum spend of rows matching one date + key, rounded to 2 decimals. */
function sumSpend(
  rows: readonly BreakdownStatRow[],
  date: string,
  key: BreakdownKey,
): number {
  let total = 0
  for (const row of rows) {
    if (row.stat_date === date && row.breakdown_key === key) total += row.spend
  }
  return round2(total)
}

/** Relative gap per spec: both 0 → 0; account 0 but breakdown > 0 → null. */
function relativeGap(breakdown: number, account: number): number | null {
  if (account === 0) return breakdown === 0 ? 0 : null
  return Math.abs(breakdown - account) / account
}

/** Within tolerance when absolute OR relative gap passes. */
function withinTolerance(breakdown: number, account: number, gap: number | null): boolean {
  if (Math.abs(breakdown - account) <= SPEND_TOLERANCE_ABSOLUTE) return true
  return gap !== null && gap <= SPEND_TOLERANCE_RELATIVE
}

/** Collect every date present in accountDaily or in rows. */
function collectDates(
  rows: readonly BreakdownStatRow[],
  accountDaily: ReadonlyArray<{ date: string; spend: number }>,
): string[] {
  const dates = new Set<string>()
  for (const entry of accountDaily) dates.add(entry.date)
  for (const row of rows) dates.add(row.stat_date)
  return Array.from(dates)
}

/** Account spend for a date; 0 when absent. */
function accountSpendFor(
  accountDaily: ReadonlyArray<{ date: string; spend: number }>,
  date: string,
): number {
  const hit = accountDaily.find((entry) => entry.date === date)
  return hit ? hit.spend : 0
}

/**
 * Reconcile breakdown spend against account-level daily spend.
 * One result per (date, key) across every date seen and every expected key.
 */
export function reconcileSpend(
  rows: readonly BreakdownStatRow[],
  accountDaily: ReadonlyArray<{ date: string; spend: number }>,
  expectedKeys: readonly BreakdownKey[],
): SpendReconciliation[] {
  const dates = collectDates(rows, accountDaily)
  const results: SpendReconciliation[] = []

  for (const date of dates) {
    const account = accountSpendFor(accountDaily, date)
    for (const key of expectedKeys) {
      const breakdown = sumSpend(rows, date, key)
      const gap = relativeGap(breakdown, account)
      results.push({
        stat_date: date,
        breakdown_key: key,
        breakdown_spend: breakdown,
        account_spend: account,
        relative_gap: gap,
        ok: withinTolerance(breakdown, account, gap),
      })
    }
  }

  results.sort((a, b) => {
    if (a.stat_date !== b.stat_date) return a.stat_date < b.stat_date ? -1 : 1
    if (a.breakdown_key !== b.breakdown_key) {
      return a.breakdown_key < b.breakdown_key ? -1 : 1
    }
    return 0
  })
  return results
}
