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
import { prescribe, Prescription } from './prescription'

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
  /** DAPE P: the one concrete remedy for this card, null when nothing to act on. */
  prescription: Prescription | null
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
  alert: 3, watch: 2, healthy: 1, insufficient_history: 0, paused: -1,
}

function worstVerdict(verdicts: Verdict[]): Verdict {
  // Paused campaigns don't participate in account health — a stopped ad can't
  // be sick. Insufficient-history ones don't either, unless nothing else exists.
  const real = verdicts.filter(v => v !== 'insufficient_history' && v !== 'paused')
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

/**
 * A campaign counts as stopped when it hasn't spent anything in this many
 * calendar days up to the evaluation date. Meta writes a row only for days
 * with delivery, so "no recent rows" = "not delivering". 3 days (not 1)
 * absorbs reporting lag and brief pauses without flapping.
 */
const PAUSED_AFTER_DAYS = 3

function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function buildCampaignNarrative(
  rows: InsightRow[],
  insightDate: string,
  cfg: BaselineConfig,
  industry: string | null,
): CampaignNarrative {
  const sorted = [...rows].sort((a, b) => (a.insight_date < b.insight_date ? -1 : 1))

  // "近 7 天" must mean the REAL last 7 calendar days ending on insightDate —
  // not the last 7 rows that have data. A stopped campaign's last rows are
  // weeks old; labelling those "近 7 天" showed stale spend as current (real
  // incident: 5 stopped Oztop campaigns displayed their pre-stop week as
  // "recent" spend. PM 2026-07-23).
  const windowStart = shiftDateStr(insightDate, -6)
  const last7 = sorted.filter(r => r.insight_date >= windowStart && r.insight_date <= insightDate)
  const latestSpend7d   = last7.reduce((s, r) => s + (r.spend ?? 0), 0)
  const latestResults7d = last7.reduce((s, r) => s + (r.results ?? 0), 0)

  const lastDataDate = sorted[sorted.length - 1].insight_date
  const isPaused = lastDataDate < shiftDateStr(insightDate, -(PAUSED_AFTER_DAYS - 1))

  if (isPaused) {
    return {
      campaign_id:   sorted[0].entity_id,
      campaign_name: sorted[sorted.length - 1].entity_name ?? sorted[0].entity_id,
      verdict:       'paused',
      headline:      `已停投(最后花钱是 ${lastDataDate})`,
      metrics:       [],
      ctr_series:    [],
      latest_spend_7d:   Math.round(latestSpend7d * 100) / 100, // 0 unless stopped mid-window
      latest_results_7d: latestResults7d,
      frequency_7d:      null,
      prescription:      null,
    }
  }

  const points = toDailyPoints(sorted)
  const judged = judgeCampaign(points, cfg, industry)
  // frequency_7d is sparse (only the newest day carries it); take the latest
  // non-null — but only from inside the current window, never a stale value.
  const freq7d = [...last7].reverse().find(r => r.frequency_7d != null)?.frequency_7d ?? null

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
    prescription: prescribe({ verdict: judged.verdict, metrics: judged.metrics, frequency_7d: freq7d, industry }),
  }
}

function buildOverallHeadline(verdict: Verdict, campaigns: CampaignNarrative[]): string {
  // All stopped is not "still gathering data" — the data is plentiful, the ads
  // just aren't running. Saying "积累中" here reads as a broken system (魏征).
  if (campaigns.length > 0 && campaigns.every(c => c.verdict === 'paused')) {
    return `所有 ${campaigns.length} 条广告都已停投,无在投广告可体检`
  }
  if (verdict === 'insufficient_history') return '广告数据仍在积累,暂无健康判定'
  const alerts  = campaigns.filter(c => c.verdict === 'alert')
  const watches = campaigns.filter(c => c.verdict === 'watch')
  const paused  = campaigns.filter(c => c.verdict === 'paused')
  const active  = campaigns.length - paused.length
  const pausedNote = paused.length > 0 ? `(另 ${paused.length} 条已停投)` : ''
  if (alerts.length > 0) return `${alerts.length} 条广告该动手了,${watches.length} 条要留意${pausedNote}`
  if (watches.length > 0) return `${watches.length} 条广告开始走弱,建议留意${pausedNote}`
  return `在投的 ${active} 条广告全部健康,无需动手${pausedNote}`
}

/**
 * Assemble the day's narrative payload from already-loaded campaign series.
 * Pure — no I/O — so the payload shape is unit-testable on its own.
 */
export function buildNarrativePayload(
  rowsByCampaign: Map<string, InsightRow[]>,
  insightDate: string,
  cfg: BaselineConfig = DEFAULT_BASELINE_CONFIG,
  industry: string | null = null,
): NarrativePayload {
  const campaigns = Array.from(rowsByCampaign.values())
    .filter(rows => rows.length > 0)
    .map(rows => buildCampaignNarrative(rows, insightDate, cfg, industry))
    // Worst first; paused sinks to the bottom (rank -1).
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

    // Industry only picks the result noun in the copy (ads playbook, G11). A failed
    // read falls back to the neutral default words — never guessed from client name/ID.
    const { data: clientRow, error: industryError } = await supabaseAdmin
      .from('clients')
      .select('industry')
      .eq('id', clientId)
      .maybeSingle()
    if (industryError) {
      console.warn('[ads-strategy/evaluate] 读客户行业失败，文案改用中性词', { clientId, error: industryError.message })
    }
    const industry = (clientRow as { industry?: string | null } | null)?.industry ?? null

    const payload = buildNarrativePayload(groupByCampaign(rows), insightDate, cfg, industry)

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
