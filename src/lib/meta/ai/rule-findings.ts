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

/**
 * 现场算（live-rules.ts）只给「自助注册、且巡检从没跑过」的客户：clients.source = 'self_serve'，并且 ads_growth_states
 * 里一条记录都没有（自助转代管后，以第一条巡检记录为切换点）。
 * - 不按「没登记广告账户」判：巡检名单是主账户列 + client_meta_ad_accounts 两处合起来的（子牙 2026-09-27）；
 * - 不只按「没有巡检记录」判：广告引擎开关关着的代管客户也永远没有记录，会拿到自助口吻（魏征 2026-09-27）。
 * 巡检跑过但现在过期 / 拒判的客户照旧显示原因，不现场覆盖。
 * 读库失败 → 不现场算，第三部分写「没拿到数据」；读得到来源就按来源定口吻，来源都读不到按代管口吻
 * （对付费代管客户说「我们不会动你的广告」是假话，比自助客户看到「和团队商量」更糟）。
 */
export type LiveRulesDecision =
  | { kind: 'live' }
  | { kind: 'patrol' }
  | { kind: 'unavailable'; voice: 'managed' | 'self_serve' }

export async function liveRulesDecision(clientId: string): Promise<LiveRulesDecision> {
  try {
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .select('source')
      .eq('id', clientId)
      .maybeSingle()
    if (error || !client) return { kind: 'unavailable', voice: 'managed' }
    if (client.source !== 'self_serve') return { kind: 'patrol' }
    const { count, error: countError } = await supabaseAdmin
      .from('ads_growth_states')
      .select('client_id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if (countError || count === null) return { kind: 'unavailable', voice: 'self_serve' }
    return count === 0 ? { kind: 'live' } : { kind: 'patrol' }
  } catch {
    return { kind: 'unavailable', voice: 'managed' }
  }
}
