/**
 * 巡察成本灯：按广告组看「滚动 3 天单次主结果成本」是否连续两天高于客户目标。
 * 只读库内日行，不调 Meta；数据快照过时时不报花费问题。
 */

import { DEFAULT_STALE_HOURS } from '@/lib/ads-strategy/circuit-breaker/settings'
import {
  buildAccountContext,
  isDelivering,
  shiftDate,
} from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { countOutcome } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import type { AccountInput, DailyRow, DiagnosisInput } from '@/lib/ads-strategy/portfolio/diagnostics/types'

/** 单次成本高于目标 15% 才亮灯（115/100，整数比，与 scale-fallback 同风格）。 */
export const PATROL_COST_OVER_NUM = 115
export const PATROL_COST_OVER_DEN = 100
const HOUR_MS = 3_600_000

export interface PatrolCostFlag {
  readonly adsetId: string
  readonly adsetName: string | null
  readonly adAccountId: string
  readonly currency: string | null
  /** 评估日当天滚动 3 天的单次主结果成本（账户币种主单位） */
  readonly rollingCpl: number
  readonly targetCpl: number
  readonly windowEnd: string
}

export type PatrolCostStaleReason = 'snapshots_incomplete' | 'capture_too_old'

export interface PatrolCostVerdict {
  readonly status: 'ok' | 'stale' | 'no_target' | 'no_flags'
  readonly staleReason: PatrolCostStaleReason | null
  readonly flags: readonly PatrolCostFlag[]
  /** 写进 payload / 人话结论用 */
  readonly summaryLines: readonly string[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function primaryCount(input: DiagnosisInput, row: DailyRow, optimizationGoal: string | null): number | null {
  const primary = input.outcome.primary
  if (primary === null) return null
  const c = countOutcome(primary, row, {
    messagingReferralAvailable: input.messagingReferralAvailable,
    optimizationGoal,
  })
  return c.value
}

function rollingOverTarget(
  spend: number,
  results: number,
  targetMajor: number,
): boolean {
  if (results <= 0 || spend <= 0 || targetMajor <= 0) return false
  const targetCents = Math.round(targetMajor * 100)
  const spendCents = Math.round(spend * 100)
  if (!Number.isSafeInteger(spendCents) || !Number.isSafeInteger(targetCents)) return false
  const left = spendCents * PATROL_COST_OVER_DEN
  const right = targetCents * PATROL_COST_OVER_NUM * results
  return left > right
}

function rollingCpl(spend: number, results: number): number | null {
  if (results <= 0 || spend <= 0) return null
  return round2(spend / results)
}

function windowDays(anchor: string): string[] {
  return [shiftDate(anchor, -2), shiftDate(anchor, -1), anchor]
}

function totalsForAdset(
  input: DiagnosisInput,
  adsetId: string,
  optimizationGoal: string | null,
  days: string[],
  accountDaily: DailyRow[],
): { spend: number; results: number } | null {
  const ids = new Set([adsetId])
  const rows = accountDaily.filter(
    (r) => r.level === 'adset' && ids.has(r.entity_id) && days.includes(r.insight_date),
  )
  if (rows.length === 0) return { spend: 0, results: 0 }
  let spend = 0
  let results = 0
  for (const r of rows) {
    spend += r.spend
    const c = primaryCount(input, r, optimizationGoal)
    if (c === null) return null
    results += c
  }
  return { spend: round2(spend), results }
}

/** 从 ad_snapshot_captures 派生行判断：不全或超过 stale 小时 → 不判花费。 */
export function patrolCostSnapshotsFresh(
  accounts: readonly AccountInput[],
  evaluatedAt: string,
  staleHours: number = DEFAULT_STALE_HOURS,
): { fresh: boolean; reason: PatrolCostStaleReason | null } {
  const now = Date.parse(evaluatedAt)
  if (!Number.isFinite(now)) return { fresh: false, reason: 'capture_too_old' }
  for (const acc of accounts) {
    if (acc.shared) continue
    const caps = acc.latestCaptures
    if (caps.length === 0) return { fresh: false, reason: 'snapshots_incomplete' }
    for (const cap of caps) {
      if (cap.skipped_shared) continue
      if (!cap.complete) return { fresh: false, reason: 'snapshots_incomplete' }
      const age = (now - Date.parse(cap.captured_at)) / HOUR_MS
      if (!Number.isFinite(age) || age < 0 || age >= staleHours) {
        return { fresh: false, reason: 'capture_too_old' }
      }
    }
  }
  return { fresh: true, reason: null }
}

function fmtMoney(currency: string | null, n: number): string {
  return currency ? `${currency} ${n}` : String(n)
}

function summaryLinePlain(flag: PatrolCostFlag): string {
  const name = flag.adsetName ? `「${flag.adsetName}」` : '有广告组'
  return `${name}近 3 天单次成本约 ${fmtMoney(flag.currency, flag.rollingCpl)}，高于目标 ${flag.targetCpl}`
}

/**
 * 判一个客户当天要不要在巡察结论里报「单次成本连续偏高」。
 * `targetMajor` 缺省 = 不判；调用方用 resolveTargetCplCents / 策略配置解析后传入。
 */
export function judgePatrolCost(
  input: DiagnosisInput,
  targetMajor: number | null,
  evaluatedAt: string,
): PatrolCostVerdict {
  if (targetMajor === null || targetMajor <= 0) {
    return { status: 'no_target', staleReason: null, flags: [], summaryLines: [] }
  }
  const fresh = patrolCostSnapshotsFresh(input.accounts, evaluatedAt)
  if (!fresh.fresh) {
    return {
      status: 'stale',
      staleReason: fresh.reason,
      flags: [],
      summaryLines: ['广告快照或花费数据偏旧，今天不按单次成本报问题'],
    }
  }
  if (!input.outcomeConfigured || input.outcome.primary === null) {
    return { status: 'no_flags', staleReason: null, flags: [], summaryLines: [] }
  }

  const date = input.date
  const prev = shiftDate(date, -1)
  const flagged: PatrolCostFlag[] = []
  const seen = new Set<string>()

  for (const account of input.accounts) {
    if (account.shared) continue
    const ctx = buildAccountContext(account, date)
    for (const adset of ctx.adsets.values()) {
      if (ctx.experimentIds.has(adset.entity_id)) continue
      if (adset.effective_status !== null && !isDelivering(adset)) continue
      const key = adset.entity_id
      if (seen.has(key)) continue

      const todayTotals = totalsForAdset(input, key, adset.optimization_goal, windowDays(date), account.daily)
      const prevTotals = totalsForAdset(input, key, adset.optimization_goal, windowDays(prev), account.daily)
      if (!todayTotals || !prevTotals) continue
      const overToday = rollingOverTarget(todayTotals.spend, todayTotals.results, targetMajor)
      const overPrev = rollingOverTarget(prevTotals.spend, prevTotals.results, targetMajor)
      if (!overToday || !overPrev) continue

      const cpl = rollingCpl(todayTotals.spend, todayTotals.results)
      if (cpl === null) continue
      seen.add(key)
      flagged.push({
        adsetId: key,
        adsetName: adset.entity_name,
        adAccountId: account.adAccountId,
        currency: account.currency,
        rollingCpl: cpl,
        targetCpl: round2(targetMajor),
        windowEnd: date,
      })
    }
  }

  if (flagged.length === 0) {
    return { status: 'no_flags', staleReason: null, flags: [], summaryLines: [] }
  }
  return {
    status: 'ok',
    staleReason: null,
    flags: flagged,
    summaryLines: flagged.map(summaryLinePlain),
  }
}