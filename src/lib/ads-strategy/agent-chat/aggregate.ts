/**
 * Pure aggregation over synced daily insight rows.
 */

import { countAction } from '@/lib/ads-strategy/link-clicks'
import { countOutcome, type OutcomeConfig, type OutcomeStep } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import type { EntityLevel } from './refs'

export interface InsightSlice {
  level: EntityLevel
  entity_id: string
  entity_name: string | null
  insight_date: string
  spend: number
  impressions: number
  clicks: number
  leads: number
  messaging_conversations: number
  reach: number | null
  video_thruplays: number | null
  video_3s_views: number | null
  frequency: number | null
  frequency_7d: number | null
  actions: ReadonlyArray<{ action_type: string; value: string }> | null
}

export interface AggregatedMetrics {
  spend: number
  impressions: number
  clicks: number
  link_clicks: number | null
  ctr: number | null
  cpm: number | null
  leads: number
  messaging_conversations: number
  primary_results: number | null
  cost_per_primary: number | null
  primary_label: string | null
  frequency_7d_latest: number | null
  frequency_daily_avg: number | null
  video_3s_views: number | null
  video_thruplays: number | null
  days_with_data: number
  primary_unknown_reasons: string[]
}

const PRIMARY_LABEL: Partial<Record<OutcomeStep, string>> = {
  lead: '留资',
  messaging_started: '私信开聊',
  messaging_depth_3: '私信第3句',
  video_complete: '完播',
  reach: '触达',
}

export function aggregateInsightRows(
  rows: readonly InsightSlice[],
  primary: OutcomeStep | null,
): AggregatedMetrics {
  let spend = 0
  let impressions = 0
  let clicks = 0
  let leads = 0
  let messaging = 0
  let linkClicks: number | null = 0
  let linkUnknown = false
  let primarySum = 0
  let primaryKnown = primary !== null
  const unknownReasons = new Set<string>()
  let video3s: number | null = 0
  let video3sUnknown = false
  let thru: number | null = 0
  let thruUnknown = false
  let freq7: number | null = null
  let freq7Date = ''
  const freqDaily: number[] = []

  for (const r of rows) {
    spend += r.spend
    impressions += r.impressions
    clicks += r.clicks
    leads += r.leads
    messaging += r.messaging_conversations

    const lc = countAction(r.actions, 'link_click')
    if (lc === null) {
      linkUnknown = true
    } else {
      linkClicks = (linkClicks ?? 0) + lc
    }

    if (r.video_3s_views === null || r.video_3s_views === undefined) {
      video3sUnknown = true
    } else {
      video3s = (video3s ?? 0) + r.video_3s_views
    }

    if (r.video_thruplays === null || r.video_thruplays === undefined) {
      thruUnknown = true
    } else {
      thru = (thru ?? 0) + r.video_thruplays
    }

    if (r.frequency != null && Number.isFinite(r.frequency)) {
      freqDaily.push(r.frequency)
    }

    if (r.frequency_7d != null && r.insight_date >= freq7Date) {
      freq7Date = r.insight_date
      freq7 = r.frequency_7d
    }

    if (primary === 'lead') {
      primarySum += r.leads
    } else if (primary === 'messaging_started') {
      primarySum += r.messaging_conversations
    } else if (primary) {
      const c = countOutcome(primary, r, { messagingReferralAvailable: false })
      if (c.value === null) {
        primaryKnown = false
        if (c.note) unknownReasons.add(c.note)
      } else {
        primarySum += c.value
      }
    }
  }

  const ctr = impressions > 0 ? clicks / impressions : null
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : null
  const costPerPrimary = primaryKnown && primarySum > 0 ? spend / primarySum : null

  return {
    spend: round2(spend),
    impressions,
    clicks,
    link_clicks: linkUnknown ? null : linkClicks,
    ctr: ctr === null ? null : round4(ctr),
    cpm: cpm === null ? null : round2(cpm),
    leads,
    messaging_conversations: messaging,
    primary_results: primaryKnown ? primarySum : null,
    cost_per_primary: costPerPrimary === null ? null : round2(costPerPrimary),
    primary_label: primary ? (PRIMARY_LABEL[primary] ?? primary) : null,
    frequency_7d_latest: freq7,
    frequency_daily_avg: freqDaily.length > 0
      ? round3(freqDaily.reduce((a, b) => a + b, 0) / freqDaily.length)
      : null,
    video_3s_views: video3sUnknown ? null : video3s,
    video_thruplays: thruUnknown ? null : thru,
    days_with_data: new Set(rows.map(r => r.insight_date)).size,
    primary_unknown_reasons: Array.from(unknownReasons),
  }
}

export function deltaMetrics(a: AggregatedMetrics, b: AggregatedMetrics): Record<string, number | null> {
  const d = (x: number | null, y: number | null) => (x === null || y === null ? null : round2(x - y))
  const dPct = (x: number | null, y: number | null) => {
    if (x === null || y === null || y === 0) return null
    return round2(((x - y) / Math.abs(y)) * 100)
  }
  return {
    spend_delta: d(a.spend, b.spend),
    spend_delta_pct: dPct(a.spend, b.spend),
    impressions_delta: d(a.impressions, b.impressions),
    clicks_delta: d(a.clicks, b.clicks),
    ctr_delta: d(a.ctr, b.ctr),
    cpm_delta: d(a.cpm, b.cpm),
    primary_results_delta: d(a.primary_results, b.primary_results),
    cost_per_primary_delta: d(a.cost_per_primary, b.cost_per_primary),
    cost_per_primary_delta_pct: dPct(a.cost_per_primary, b.cost_per_primary),
  }
}

export function primaryFromOutcomeConfig(config: OutcomeConfig): OutcomeStep | null {
  return config.primary ?? config.leading ?? null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}
