/**
 * Magic Bridge 报告第三部分的数据来源：只读取每日巡检已经判好的广告级结论（D2/D10），
 * 用跟 PM 今日待办同一套门槛（连续 ≥2 次、数据齐、够新），并确认这个广告账户真的被检查过
 * ——「没检查」绝不说成「没发现」。只读，不判断。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  ADS_RULE_MIN_STREAK,
  findingKey,
  isUsableNewest,
  ruleHits,
  streakFor,
  type GrowthStateRow,
  type RuleFinding,
} from '@/lib/ads-strategy/rules/patrol-findings'
import {
  toClientFinding,
  type ClientRuleFinding,
  type RuleSectionInput,
} from '@/lib/ads-strategy/rules/client-copy'

export const RULE_FINDINGS_LOOKBACK_DAYS = 14

export interface RuleFindingArgs {
  adAccountId: string // e.g. 'act_123'
  now: Date
  currency: string | null
  /** ad ids that had spend in this report's window (from the ad-level rows Magic Bridge already reads); null = unknown → don't filter */
  deliveringAdIds: ReadonlySet<string> | null
  campaignFrequency: (campaignId: string | null) => number | null
}

export interface RuleFindingsResult {
  section: RuleSectionInput
  findings: ClientRuleFinding[]
}

type NoneReason = Extract<RuleSectionInput, { source: 'none' }>['reason']

const COVERAGE_REASONS: ReadonlySet<string> = new Set([
  'shared_account',
  'client_page_unknown',
  'not_loaded',
])

function norm(id: string): string {
  return id.replace(/^act_/, '')
}

function none(reason: NoneReason): RuleFindingsResult {
  return { section: { source: 'none', reason }, findings: [] }
}

function sortByDateDesc(rows: readonly GrowthStateRow[]): GrowthStateRow[] {
  return [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function coverageReason(reason: string): NoneReason {
  return COVERAGE_REASONS.has(reason) ? (reason as NoneReason) : 'not_loaded'
}

function adUnitOf(f: RuleFinding): { id: string; adAccountId?: string } | null {
  const ad = f.units?.find((u) => u.level === 'ad')
  return ad ? { id: ad.id, adAccountId: ad.adAccountId } : null
}

function isEligibleHit(
  f: RuleFinding,
  args: RuleFindingArgs,
  sortedRows: readonly GrowthStateRow[],
): boolean {
  if (f.clientVisible !== true) return false
  const ad = adUnitOf(f)
  if (ad === null) return false
  if (ad.adAccountId === undefined || norm(ad.adAccountId) !== norm(args.adAccountId)) return false
  const key = findingKey(f)
  if (key === null || streakFor(key, sortedRows) < ADS_RULE_MIN_STREAK) return false
  return args.deliveringAdIds === null || args.deliveringAdIds.has(ad.id)
}

/** Pure. */
export function selectRuleFindings(
  rows: readonly GrowthStateRow[],
  args: RuleFindingArgs,
): RuleFindingsResult {
  if (rows.length === 0) return none('not_connected')
  const sortedRows = sortByDateDesc(rows)
  const newest = sortedRows[0]
  if (newest.payload?.dataCompleteness === 'partial') return none('partial')
  if (!isUsableNewest(newest, args.now)) return none('stale')

  if (newest.payload?.adLevelCoverage === undefined) return none('preparing')

  const coverage = newest.payload?.adLevelCoverage?.find(
    (c) => norm(c.adAccountId) === norm(args.adAccountId),
  )
  if (!coverage) return none('not_connected')
  if (!coverage.ran) return none(coverageReason(coverage.reason))
  if (coverage.adsChecked === 0) return none('no_delivering_ads')

  const hits = ruleHits(newest).filter((f) => isEligibleHit(f, args, sortedRows))
  const findings = hits
    .map((f) =>
      toClientFinding(f, {
        currency: args.currency,
        dataDate: newest.date,
        campaignFrequency: args.campaignFrequency,
      }),
    )
    .filter((x): x is ClientRuleFinding => x !== null)

  if (hits.length > 0 && findings.length === 0) return none('incomplete_findings')

  return {
    section: {
      source: 'patrol',
      dataDate: newest.date,
      adsChecked: coverage.adsChecked,
      findings,
    },
    findings,
  }
}

function lookbackStart(now: Date): string {
  const t = now.getTime() - RULE_FINDINGS_LOOKBACK_DAYS * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

export async function loadRuleFindings(
  clientId: string,
  args: RuleFindingArgs,
): Promise<RuleFindingsResult> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ads_growth_states')
      .select('client_id, date, payload')
      .eq('client_id', clientId)
      .gte('date', lookbackStart(args.now))
      .order('date', { ascending: false })
    if (error) {
      console.warn('[meta-ads-ai] rule findings unavailable', { reason: error.message })
      return none('not_loaded')
    }
    return selectRuleFindings((data ?? []) as GrowthStateRow[], args)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[meta-ads-ai] rule findings unavailable', { reason })
    return none('not_loaded')
  }
}
