import { currencyOfFacts } from './classify'
import { formatMinor, formatNzTime } from './format'
import type { LiveDelivering } from './live-delivering'
import type { AccountData, PassingStep } from './shared'
import type { Basis } from './types'

export interface LiveAdjustment {
  /** extra delivering budget (minor units) found by the live read beyond the snapshot, per selected account, >= 0 */
  bumpByAccount: Record<string, number>
  /** sum of bumpByAccount; each distinct account counted once */
  totalBump: number
  /** one Basis per selected account */
  basisByAccount: Record<string, Basis>
  /** true when the live read succeeded and was used for that account (so the "snapshot only" fixed sentence is dropped) */
  liveUsedByAccount: Record<string, boolean>
}

/** Snapshot time label for an account; falls back to a fixed phrase when captureAt is missing. */
function snapshotTime(acct: AccountData): string {
  return acct.captureAt !== null ? formatNzTime(acct.captureAt) : '最近一次快照'
}

/** Build the "others still on snapshot" disclosure, or '' when there are no other accounts. */
function othersDisclosure(allAccounts: AccountData[], accountId: string, readAtIso: string): string {
  const others = allAccounts.filter((a) => a.id !== accountId)
  if (others.length === 0) return ''

  let oldestMs = Number.POSITIVE_INFINITY
  let oldestIso: string | null = null
  let anyMissing = false
  for (const other of others) {
    if (other.captureAt === null) {
      anyMissing = true
      continue
    }
    const ms = Date.parse(other.captureAt)
    if (Number.isNaN(ms)) {
      anyMissing = true
      continue
    }
    if (ms < oldestMs) {
      oldestMs = ms
      oldestIso = other.captureAt
    }
  }

  const readAt = formatNzTime(readAtIso)
  if (anyMissing || oldestIso === null) {
    return `。这个账户的在投是刚读的（${readAt}），客户余量里其它账户仍按最近一次快照算`
  }
  return `。这个账户的在投是刚读的（${readAt}），客户余量里其它账户仍按 ${formatNzTime(oldestIso)} 的快照算`
}

/** Case A: live read unavailable. */
function basisUnavailable(acct: AccountData): Basis {
  const value =
    acct.captureAt !== null
      ? `实时在投没读到，这个数按 ${snapshotTime(acct)} 的快照算`
      : '实时在投没读到，这个数按最近一次快照算'
  return { label: '在投合计（实时）', value, source: '广告快照', as_of: acct.captureAt }
}

/** Case B: live currency mismatches the account currency. */
function basisCurrencyMismatch(acct: AccountData): Basis {
  const value =
    acct.captureAt !== null
      ? `实时读到的币种和账户不一致，这个数按 ${snapshotTime(acct)} 的快照算`
      : '实时读到的币种和账户不一致，这个数按最近一次快照算'
  return { label: '在投合计（实时）', value, source: '广告快照', as_of: acct.captureAt }
}

/** Case C: live read usable; returns the basis plus the bump amount. */
function basisLive(
  acct: AccountData,
  lv: LiveDelivering,
  factsCur: string,
  allAccounts: AccountData[],
): { basis: Basis; bump: number } {
  const snap = acct.facts?.account_delivering_minor ?? 0
  const bump = Math.max(0, lv.minor - snap)
  const chosen = Math.max(snap, lv.minor)
  const F = (m: number): string => formatMinor(m, factsCur)
  const snapTimeForC = acct.captureAt !== null ? formatNzTime(acct.captureAt) : '抓取时间读不到'

  let value = `快照 ${F(snap)}（抓取 ${snapTimeForC}），实时 ${F(lv.minor)}（读数 ${formatNzTime(lv.readAtIso)}），这次用 ${F(chosen)}`
  if (lv.minor < snap) value += '（实时比快照小，仍取快照数）'
  if (lv.incomplete) value += '。实时读到的不含系列级预算，只是下限'
  value += othersDisclosure(allAccounts, acct.id, lv.readAtIso)

  return {
    basis: { label: '在投合计（实时）', value, source: '实时读 Meta（只读）', as_of: lv.readAtIso },
    bump,
  }
}

/** Resolve one account into its basis, bump and live-used flag. */
function adjustAccount(
  acct: AccountData,
  lv: LiveDelivering | null,
  allAccounts: AccountData[],
): { basis: Basis; bump: number; used: boolean } {
  if (lv === null) {
    return { basis: basisUnavailable(acct), bump: 0, used: false }
  }
  const factsCur = currencyOfFacts(acct.facts)
  if (lv.currency === null || factsCur === null || lv.currency.trim().toUpperCase() !== factsCur.toUpperCase()) {
    return { basis: basisCurrencyMismatch(acct), bump: 0, used: false }
  }
  const { basis, bump } = basisLive(acct, lv, factsCur, allAccounts)
  return { basis, bump, used: true }
}

export function computeLiveAdjustment(
  passing: PassingStep[],
  allAccounts: AccountData[],
  live: Map<string, LiveDelivering | null>,
): LiveAdjustment {
  const bumpByAccount: Record<string, number> = {}
  const basisByAccount: Record<string, Basis> = {}
  const liveUsedByAccount: Record<string, boolean> = {}
  const handled = new Set<string>()
  let totalBump = 0

  for (const p of passing) {
    const accountId = p.accountId
    if (handled.has(accountId)) continue
    handled.add(accountId)

    const lv = live.get(accountId) ?? null
    const { basis, bump, used } = adjustAccount(p.account, lv, allAccounts)

    bumpByAccount[accountId] = bump
    basisByAccount[accountId] = basis
    liveUsedByAccount[accountId] = used
    totalBump += bump
  }

  return { bumpByAccount, totalBump, basisByAccount, liveUsedByAccount }
}
