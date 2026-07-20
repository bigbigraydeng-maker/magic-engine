/**
 * P21.K.2 — Per-client ad-health evaluation and narrative persistence.
 *
 * Reads the daily series in `ad_daily_insights` (written by P21.K.1), runs each
 * campaign through the relative-baseline fatigue engine, and writes one
 * `ad_health_narratives` row for the day. The dashboard (P3) and email (P4)
 * both read that row's payload — computed once here, never recomputed.
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  judgeCampaign,
  DailyPoint,
  CampaignVerdict,
  Verdict,
  BaselineConfig,
  DEFAULT_BASELINE_CONFIG,
} from './baseline'

/** How many days of history to load for the baseline (needs ≥ 2 windows). */
const HISTORY_DAYS = 30

interface InsightRow {
  entity_id: string
  entity_name: string | null
  insight_date: string
  ctr: number | null
  cost_per_result: number | null
  results: number | null
  spend: number | null
  impressions: number | null
  frequency_7d: number | null
}

export interface CampaignNarrative {
  campaign_id: string
  campaign_name: string
  verdict: Verdict
  headline: string
  metrics: CampaignVerdict['metrics']
  /** Last up-to-7 raw daily CTRs, oldest→newest, for the "see it yourself" strip. */
  ctr_series: Array<{ date: string; ctr: number | null }>
  latest_spend_7d: number
  latest_results_7d: number
  frequency_7d: number | null
}

export interface NarrativePayload {
  overall_verdict: Verdict
  headline: string
  campaigns: CampaignNarrative[]
  /** Total campaigns evaluated (each carries its own verdict, incl. insufficient_history). */
  evaluated: number
  generated_for: string   // insight_date
}

export interface EvaluateResult {
  success: boolean
  insight_date?: string
  overall_verdict?: Verdict
  campaigns_evaluated?: number
  error?: string
}

const VERDICT_RANK: Record<Verdict, number> = {
  alert: 3, watch: 2, healthy: 1, insufficient_history: 0,
}

function worstVerdict(verdicts: Verdict[]): Verdict {
  const real = verdicts.filter(v => v !== 'insufficient_history')
  if (real.length === 0) return 'insufficient_history'
  return real.reduce((worst, v) => (VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst), 'healthy')
}

/** Group flat insight rows by campaign into DailyPoint series. */
function groupByCampaign(rows: InsightRow[]): Map<string, InsightRow[]> {
  const out = new Map<string, InsightRow[]>()
  for (const r of rows) {
    const list = out.get(r.entity_id) ?? []
    list.push(r)
    out.set(r.entity_id, list)
  }
  return out
}

function toDailyPoints(rows: InsightRow[]): DailyPoint[] {
  return rows.map(r => ({
    insight_date: r.insight_date,
    ctr: r.ctr,
    cost_per_result: r.cost_per_result,
    results: r.results ?? 0,
    spend: r.spend ?? 0,
    impressions: r.impressions ?? 0,
  }))
}

function buildCampaignNarrative(rows: InsightRow[], cfg: BaselineConfig): CampaignNarrative {
  const sorted = [...rows].sort((a, b) => (a.insight_date < b.insight_date ? -1 : 1))
  const points = toDailyPoints(sorted)
  const judged = judgeCampaign(points, cfg)

  const last7 = sorted.slice(-7)
  const latestSpend7d   = last7.reduce((s, r) => s + (r.spend ?? 0), 0)
  const latestResults7d = last7.reduce((s, r) => s + (r.results ?? 0), 0)
  // frequency_7d is sparse (only the newest day carries it); take the latest non-null.
  const freq7d = [...sorted].reverse().find(r => r.frequency_7d != null)?.frequency_7d ?? null

  return {
    campaign_id:   sorted[0].entity_id,
    campaign_name: sorted[sorted.length - 1].entity_name ?? sorted[0].entity_id,
    verdict:       judged.verdict,
    headline:      judged.headline,
    metrics:       judged.metrics,
    ctr_series:    last7.map(r => ({ date: r.insight_date, ctr: r.ctr })),
    latest_spend_7d:   Math.round(latestSpend7d * 100) / 100,
    latest_results_7d: latestResults7d,
    frequency_7d:      freq7d,
  }
}

function buildOverallHeadline(verdict: Verdict, campaigns: CampaignNarrative[]): string {
  if (verdict === 'insufficient_history') return '广告数据仍在积累,暂无健康判定'
  const alerts = campaigns.filter(c => c.verdict === 'alert')
  const watches = campaigns.filter(c => c.verdict === 'watch')
  if (alerts.length > 0) return `${alerts.length} 条广告该动手了,${watches.length} 条要留意`
  if (watches.length > 0) return `${watches.length} 条广告开始走弱,建议留意`
  return `${campaigns.length} 条广告全部健康,无需动手`
}

/**
 * Assemble the day's narrative payload from already-loaded campaign series.
 * Pure — no I/O — so the payload shape is unit-testable on its own.
 */
export function buildNarrativePayload(
  rowsByCampaign: Map<string, InsightRow[]>,
  insightDate: string,
  cfg: BaselineConfig = DEFAULT_BASELINE_CONFIG,
): NarrativePayload {
  const campaigns = Array.from(rowsByCampaign.values())
    .filter(rows => rows.length > 0)
    .map(rows => buildCampaignNarrative(rows, cfg))
    // Worst first so the dashboard and email lead with what needs action.
    .sort((a, b) => VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict])

  const overall = worstVerdict(campaigns.map(c => c.verdict))

  return {
    overall_verdict: overall,
    headline: buildOverallHeadline(overall, campaigns),
    campaigns,
    evaluated: campaigns.length,
    generated_for: insightDate,
  }
}

/**
 * Evaluate one client's ad health for `insightDate` and upsert the narrative.
 * Degrades to {success:false} rather than throwing, matching the cron's
 * per-client isolation convention.
 */
export async function evaluateClientAdHealth(
  clientId: string,
  insightDate: string,
  cfg: BaselineConfig = DEFAULT_BASELINE_CONFIG,
): Promise<EvaluateResult> {
  try {
    const since = new Date(`${insightDate}T00:00:00Z`)
    since.setUTCDate(since.getUTCDate() - (HISTORY_DAYS - 1))
    const sinceStr = since.toISOString().slice(0, 10)

    const { data, error } = await supabaseAdmin
      .from('ad_daily_insights')
      .select('entity_id, entity_name, insight_date, ctr, cost_per_result, results, spend, impressions, frequency_7d')
      .eq('client_id', clientId)
      .eq('level', 'campaign')
      .gte('insight_date', sinceStr)
      .lte('insight_date', insightDate)
      .order('insight_date', { ascending: true })

    if (error) return { success: false, error: error.message }

    const rows = (data ?? []) as InsightRow[]
    if (rows.length === 0) {
      return { success: true, insight_date: insightDate, overall_verdict: 'insufficient_history', campaigns_evaluated: 0 }
    }

    const payload = buildNarrativePayload(groupByCampaign(rows), insightDate, cfg)

    const { error: upsertError } = await supabaseAdmin
      .from('ad_health_narratives')
      .upsert(
        {
          client_id:       clientId,
          insight_date:    insightDate,
          overall_verdict: payload.overall_verdict,
          headline:        payload.headline,
          payload,
          updated_at:      new Date().toISOString(),
        },
        { onConflict: 'client_id,insight_date' },
      )

    if (upsertError) return { success: false, error: upsertError.message }

    return {
      success: true,
      insight_date: insightDate,
      overall_verdict: payload.overall_verdict,
      campaigns_evaluated: payload.evaluated,
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
