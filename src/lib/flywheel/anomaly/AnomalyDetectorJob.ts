/**
 * AnomalyDetectorJob — P22.D.1
 *
 * Pure rules engine (no AI). Reads flywheel_metrics and fires anomaly
 * signals when pre-defined thresholds are breached. Writes detected
 * signals to the anomaly_signals table.
 *
 * Architecture:
 *   AnomalyDetectorJob.run(clientId)
 *     → executes 5 MVP rules
 *     → each rule queries flywheel_metrics with supabaseAdmin
 *     → fires an AnomalySignal when threshold breached
 *     → batch-inserts all signals to anomaly_signals
 *     → returns fired signals (empty array = no anomalies)
 *
 * Second-layer AI (P22.D.2) polls anomaly_signals WHERE status='new'
 * and generates Zhugeliang advisory messages.
 *
 * Called by: POST /api/cron/anomaly-detector (P22.D.3)
 * Reference: ROADMAP.md P22.D.1
 */

import { supabaseAdmin } from '../../supabase'
import { SEO_METRIC_KEY, ADS_METRIC_KEY, SOCIAL_METRIC_KEY, GEO_METRIC_KEY } from '../vocabulary'
import type { AnomalySignal, DetectionRule } from './types'

// ─── MVP Detection Rules ──────────────────────────────────────────────────────

/**
 * Rule 1 — SEO: avg ranking position drops > 5 on 3 consecutive days
 *
 * Logic: fetch last 3 rows for seo.gsc.avg_position ordered by measured_at.
 * If each reading is > 5 positions worse than the oldest reading, fire.
 * Higher position number = worse ranking.
 */
const ruleSeoPosDropConsecutive: DetectionRule = {
  ruleId:    'seo.avg_position.drop_5_3days',
  flywheel:  'seo',
  metricKey: SEO_METRIC_KEY.GSC_AVG_POSITION,
  severity:  'high',

  async detect(clientId: string): Promise<AnomalySignal | null> {
    const { data } = await supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_value, measured_at')
      .eq('client_id', clientId)
      .eq('metric_key', SEO_METRIC_KEY.GSC_AVG_POSITION)
      .order('measured_at', { ascending: false })
      .limit(3)

    if (!data || data.length < 3) return null

    // data[0] = latest, data[2] = oldest
    const latest   = data[0].metric_value as number
    const baseline = data[2].metric_value as number
    const delta    = latest - baseline  // positive = worse ranking

    if (delta <= 5) return null

    const pctChange = baseline !== 0 ? ((delta / baseline) * 100) : null

    return buildSignal({
      clientId,
      rule: ruleSeoPosDropConsecutive,
      currentValue:  latest,
      baselineValue: baseline,
      pctChange,
    })
  },
}

/**
 * Rule 2 — SEO: GSC clicks drop > 20% week-over-week
 *
 * Logic: fetch last 2 rows for seo.gsc.clicks.
 * Compare current vs prior. Fire if drop exceeds 20%.
 */
const ruleSeoClicksDropWoW: DetectionRule = {
  ruleId:    'seo.gsc_clicks.drop_20pct_wow',
  flywheel:  'seo',
  metricKey: SEO_METRIC_KEY.GSC_CLICKS,
  severity:  'medium',

  async detect(clientId: string): Promise<AnomalySignal | null> {
    const { data } = await supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_value, measured_at')
      .eq('client_id', clientId)
      .eq('metric_key', SEO_METRIC_KEY.GSC_CLICKS)
      .order('measured_at', { ascending: false })
      .limit(2)

    if (!data || data.length < 2) return null

    const current  = data[0].metric_value as number
    const prior    = data[1].metric_value as number

    if (prior === 0) return null

    const pctChange = ((current - prior) / prior) * 100  // negative = drop

    if (pctChange > -20) return null

    return buildSignal({
      clientId,
      rule: ruleSeoClicksDropWoW,
      currentValue:  current,
      baselineValue: prior,
      pctChange,
    })
  },
}

/**
 * Rule 3 — GEO: AI mention rate drops > 15%
 *
 * Logic: fetch last 2 rows for geo.query.mention_rate.
 * Fire if the drop exceeds 15% relative.
 */
const ruleGeoMentionRateDrop: DetectionRule = {
  ruleId:    'geo.mention_rate.drop_15pct',
  flywheel:  'geo',
  metricKey: GEO_METRIC_KEY.QUERY_MENTION_RATE,
  severity:  'high',

  async detect(clientId: string): Promise<AnomalySignal | null> {
    const { data } = await supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_value, measured_at')
      .eq('client_id', clientId)
      .eq('metric_key', GEO_METRIC_KEY.QUERY_MENTION_RATE)
      .order('measured_at', { ascending: false })
      .limit(2)

    if (!data || data.length < 2) return null

    const current  = data[0].metric_value as number
    const prior    = data[1].metric_value as number

    if (prior === 0) return null

    const pctChange = ((current - prior) / prior) * 100  // negative = drop

    if (pctChange > -15) return null

    return buildSignal({
      clientId,
      rule: ruleGeoMentionRateDrop,
      currentValue:  current,
      baselineValue: prior,
      pctChange,
    })
  },
}

/**
 * Rule 4 — Ads: CPA (spend / conversions) surges > 30% month-over-month
 *
 * Logic: fetch last 2 rows for ads.account.spend and ads.account.conversions
 * independently, compute CPA for each period, compare.
 *
 * Uses separate queries for spend and conversions, matched by recency.
 */
const ruleAdsCpaSurge: DetectionRule = {
  ruleId:    'ads.cpa.surge_30pct_mom',
  flywheel:  'ads',
  metricKey: ADS_METRIC_KEY.SPEND,   // primary key; conversions checked internally
  severity:  'high',

  async detect(clientId: string): Promise<AnomalySignal | null> {
    const [spendRes, convRes] = await Promise.all([
      supabaseAdmin
        .from('flywheel_metrics')
        .select('metric_value, measured_at')
        .eq('client_id', clientId)
        .eq('metric_key', ADS_METRIC_KEY.SPEND)
        .order('measured_at', { ascending: false })
        .limit(2),
      supabaseAdmin
        .from('flywheel_metrics')
        .select('metric_value, measured_at')
        .eq('client_id', clientId)
        .eq('metric_key', ADS_METRIC_KEY.CONVERSIONS)
        .order('measured_at', { ascending: false })
        .limit(2),
    ])

    const spendRows = spendRes.data
    const convRows  = convRes.data

    if (!spendRows || spendRows.length < 2) return null
    if (!convRows  || convRows.length  < 2) return null

    const spendNow   = spendRows[0].metric_value  as number
    const spendPrior = spendRows[1].metric_value  as number
    const convNow    = convRows[0].metric_value   as number
    const convPrior  = convRows[1].metric_value   as number

    // Avoid division by zero; if no conversions at all, can't compute CPA
    if (convNow === 0 || convPrior === 0) return null

    const cpaNow   = spendNow   / convNow
    const cpaPrior = spendPrior / convPrior
    const pctChange = ((cpaNow - cpaPrior) / cpaPrior) * 100  // positive = CPA worsened

    if (pctChange <= 30) return null

    return buildSignal({
      clientId,
      rule: ruleAdsCpaSurge,
      currentValue:  cpaNow,
      baselineValue: cpaPrior,
      pctChange,
      sourceRef: {
        spend_current:  spendNow,
        conv_current:   convNow,
        spend_prior:    spendPrior,
        conv_prior:     convPrior,
      },
    })
  },
}

/**
 * Rule 5 — Social: engagement rate drops > 40% month-over-month
 *
 * Proxy metric: use PUBLISHED_COUNT as a signal for pipeline health.
 * If published posts drop > 40% vs prior period, flag as medium.
 *
 * Note: true per-post engagement metrics (likes/comments/shares) require
 * Publer pullback to be running. Until that data is available, post count
 * is the best available social health proxy.
 */
const ruleSocialEngagementDrop: DetectionRule = {
  ruleId:    'social.published_count.drop_40pct_mom',
  flywheel:  'social',
  metricKey: SOCIAL_METRIC_KEY.PUBLISHED_COUNT,
  severity:  'medium',

  async detect(clientId: string): Promise<AnomalySignal | null> {
    const { data } = await supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_value, measured_at')
      .eq('client_id', clientId)
      .eq('metric_key', SOCIAL_METRIC_KEY.PUBLISHED_COUNT)
      .order('measured_at', { ascending: false })
      .limit(2)

    if (!data || data.length < 2) return null

    const current  = data[0].metric_value as number
    const prior    = data[1].metric_value as number

    if (prior === 0) return null

    const pctChange = ((current - prior) / prior) * 100  // negative = drop

    if (pctChange > -40) return null

    return buildSignal({
      clientId,
      rule: ruleSocialEngagementDrop,
      currentValue:  current,
      baselineValue: prior,
      pctChange,
    })
  },
}

// ─── Rules registry ───────────────────────────────────────────────────────────

const RULES: DetectionRule[] = [
  ruleSeoPosDropConsecutive,
  ruleSeoClicksDropWoW,
  ruleGeoMentionRateDrop,
  ruleAdsCpaSurge,
  ruleSocialEngagementDrop,
]

// ─── AnomalyDetectorJob ───────────────────────────────────────────────────────

export class AnomalyDetectorJob {
  /**
   * Run all MVP detection rules for one client.
   *
   * - Executes rules in parallel (Promise.allSettled — one failure never blocks others)
   * - Batch-inserts all fired signals to anomaly_signals
   * - Returns the array of AnomalySignal that were fired (empty = all clear)
   *
   * @param clientId  UUID of the client row in clients table
   */
  async run(clientId: string): Promise<AnomalySignal[]> {
    const settled = await Promise.allSettled(
      RULES.map(rule => rule.detect(clientId)),
    )

    const fired: AnomalySignal[] = []

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value !== null) {
        fired.push(result.value)
      } else if (result.status === 'rejected') {
        console.error('[AnomalyDetectorJob] rule error:', (result.reason as Error).message)
      }
    }

    if (fired.length === 0) return []

    const toInsert = fired.map(s => ({
      client_id:      s.clientId,
      flywheel:       s.flywheel,
      metric_key:     s.metricKey,
      rule_id:        s.ruleId,
      severity:       s.severity,
      current_value:  s.currentValue,
      baseline_value: s.baselineValue,
      pct_change:     s.pctChange,
      source_ref:     s.sourceRef,
      status:         'new',
      detected_at:    s.detectedAt,
    }))

    const { error } = await supabaseAdmin.from('anomaly_signals').insert(toInsert)
    if (error) {
      console.error('[AnomalyDetectorJob] insert error:', error.message)
    }

    return fired
  }
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function buildSignal({
  clientId,
  rule,
  currentValue,
  baselineValue,
  pctChange,
  sourceRef = {},
}: {
  clientId:      string
  rule:          DetectionRule
  currentValue:  number | null
  baselineValue: number | null
  pctChange:     number | null
  sourceRef?:    Record<string, unknown>
}): AnomalySignal {
  return {
    clientId,
    flywheel:      rule.flywheel,
    metricKey:     rule.metricKey,
    ruleId:        rule.ruleId,
    severity:      rule.severity,
    currentValue,
    baselineValue,
    pctChange,
    sourceRef,
    status:        'new',
    detectedAt:    new Date().toISOString(),
  }
}
