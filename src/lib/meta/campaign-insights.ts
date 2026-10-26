/**
 * Campaign-level Meta ads insights — rolling aggregate, daily time series, and
 * window frequency.
 *
 * Split out of client.ts. `parseDailyMetrics` is the shared daily-row parser;
 * the adset- and ad-level modules import it so the never-sum / never-fake-zero
 * rules are stated once.
 */

import {
  LEAD_ACTION_PRIORITY,
  MESSAGING_ACTION_PRIORITY,
  pickAction,
  type MetaActionStat,
} from './objective-metrics'
import {
  GRAPH_BASE,
  MAX_INSIGHT_PAGES,
  fetchInsightPages,
  type InsightPageWalk,
} from './graph-base'
import { parseInsights, type GraphInsightsData } from './account-insights'
import { clickThroughRate } from './ctr'

export interface MetaCampaignInsight {
  campaign_id:   string
  campaign_name: string
  spend:         number
  impressions:   number
  clicks:        number
  roas:          number | null
  ctr:           number | null
  cpc:           number | null
}

export interface GraphCampaignRow extends GraphInsightsData {
  campaign_id?:   string
  campaign_name?: string
}

/**
 * Fetch campaign-level ad insights from Meta Graph API.
 * Returns up to `limit` campaigns sorted by spend descending.
 *
 * @param adAccountId  e.g. "act_123456789"
 * @param accessToken  Meta system user access token
 * @param since        ISO date string e.g. "2026-04-01"
 * @param until        ISO date string e.g. "2026-04-30"
 * @param limit        Max campaigns to return (default 10)
 */
export async function getAdCampaignInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
  limit: number = 10,
): Promise<MetaCampaignInsight[]> {
  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'clicks',
    'purchase_roas',
  ].join(',')

  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'campaign',
    sort:  'spend_descending',
    limit: String(limit),
  })

  const url = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error('[meta/client] campaign fetch error:', err)
    return []
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/client] campaign HTTP ${res.status}:`, body.slice(0, 300))
    return []
  }

  const json = await res.json() as { data?: GraphCampaignRow[] }
  return (json.data ?? []).map(parseCampaignRow).filter(Boolean) as MetaCampaignInsight[]
}

function parseCampaignRow(row: GraphCampaignRow): MetaCampaignInsight | null {
  if (!row.campaign_id) return null

  const base = parseInsights(row)
  // Same ratio as the account total and the daily series. outbound_clicks_ctr
  // is a different, much smaller percent and must not be stored here.
  return {
    campaign_id:   row.campaign_id,
    campaign_name: row.campaign_name ?? row.campaign_id,
    spend:         base.spend,
    impressions:   base.impressions,
    clicks:        base.clicks,
    roas:          base.roas,
    ctr:           clickThroughRate(base.clicks, base.impressions),
    cpc:           base.cpc,
  }
}

// ── Campaign daily time series (P21.K.1 — Ad Strategy Engine data spine) ──────

/**
 * One campaign's metrics for one calendar day.
 *
 * P21.K.1: feeds `ad_daily_insights`, the time series the Ad Strategy Engine
 * needs for relative-baseline fatigue detection (7d median vs the campaign's
 * own best 7d). The pre-existing `getAdCampaignInsights` cannot serve this —
 * it returns a single 30-day rolling aggregate capped at 10 campaigns.
 */
export interface MetaCampaignDailyRow {
  campaign_id:   string
  campaign_name: string
  insight_date:  string        // YYYY-MM-DD
  spend:         number
  impressions:   number
  reach:         number | null
  clicks:        number
  frequency:     number | null // impressions / reach, as reported by Meta
  cpm:           number | null
  ctr:           number | null // fraction (0.0318 = 3.18%), always clicks/impressions
  cpc:           number | null
  leads:         number        // action_type 'lead' (Lead Form submissions)
  messaging_conversations: number // CTWA conversations started
  results:       number        // max(leads, messaging) — the north-star unit, NEVER summed (see parseDailyMetrics)
  cost_per_result: number | null
  // ── 视频完播（ads IMPACT 阶段 1 §2.2）。null = Meta 没返回（非视频广告），不是 0。
  video_3s_views:          number | null // actions[video_view]：Meta 口径的 3 秒播放
  video_thruplays:         number | null
  video_p25:               number | null
  video_p50:               number | null
  video_p75:               number | null
  video_p95:               number | null
  video_p100:              number | null
  video_avg_watch_seconds: number | null
  /** 原始 actions 整包：结果阶梯由客户配置决定，不用每换一种结果就改表。 */
  actions:                 MetaActionStat[] | null
}

export interface GraphCampaignDailyRow extends GraphCampaignRow {
  date_start?: string
  reach?:      string
  frequency?:  string
  cpm?:        string
  video_thruplay_watched_actions?: MetaActionStat[]
  video_p25_watched_actions?:      MetaActionStat[]
  video_p50_watched_actions?:      MetaActionStat[]
  video_p75_watched_actions?:      MetaActionStat[]
  video_p95_watched_actions?:      MetaActionStat[]
  video_p100_watched_actions?:     MetaActionStat[]
  video_avg_time_watched_actions?: MetaActionStat[]
}

/**
 * 视频类字段 Meta 返回 `[{action_type:'video_view', value:'544'}]`（2026-09-14 NAL 实拉）。
 * 字段缺失 → null（这条广告没有视频数据），不伪造 0。
 */
function videoStat(stats: MetaActionStat[] | undefined): number | null {
  if (!stats || stats.length === 0) return null
  const hit = stats.find(s => s.action_type === 'video_view') ?? stats[0]
  const n = Number(hit.value)
  return Number.isFinite(n) ? n : null
}

// Action-type priority lists and the never-sum picker live in
// ./objective-metrics — shared with the account-level cost metrics so the
// hierarchical-double-count rule is stated once.

/** Metric half of a daily row — identical at campaign and ad level. */
export type DailyMetrics = Omit<MetaCampaignDailyRow, 'campaign_id' | 'campaign_name' | 'insight_date'>

export function parseDailyMetrics(row: GraphCampaignDailyRow): DailyMetrics {
  const base  = parseInsights(row)
  const reach = row.reach !== undefined ? parseInt(row.reach, 10) || null : null

  // Same function as the account total and the rolling campaign aggregate.
  const ctr = clickThroughRate(base.clicks, base.impressions)

  const leads     = pickAction(row.actions, LEAD_ACTION_PRIORITY)
  const messaging = pickAction(row.actions, MESSAGING_ACTION_PRIORITY)
  // NEVER `leads + messaging`. For a Lead Form campaign whose page has
  // Messenger auto-reply / lead-form-to-Messenger handoff enabled (CTS's
  // setup), Meta reports the SAME conversion under BOTH LEAD_ACTION_PRIORITY
  // and MESSAGING_ACTION_PRIORITY — the 27 form submits on 2026-09-06 also
  // showed up as 25 messaging_conversations, and summing gave 52 = a 2×
  // over-count that showed the PM $3.9 CPL when Meta itself said $7.6.
  // See docs/history/CHANGELOG.md 2026-09-08.
  //
  // `max` picks the dominant metric per row without ever inflating: it's the
  // right answer for the overlap case, and for a pure-messaging or pure-lead
  // campaign one of the two is 0 so max returns the non-zero one intact. The
  // theoretical case (independent leads AND independent messaging on the same
  // ad, no overlap) would under-count by min(leads, messaging) — accepted
  // because it's rare in practice and safer than the alternative.
  const results   = Math.max(leads, messaging)

  return {
    spend:         base.spend,
    impressions:   base.impressions,
    reach,
    clicks:        base.clicks,
    frequency:     row.frequency !== undefined ? parseFloat(row.frequency) || null : null,
    cpm:           row.cpm !== undefined ? parseFloat(row.cpm) || null : null,
    ctr,
    cpc:           base.cpc,
    leads,
    messaging_conversations: messaging,
    results,
    cost_per_result: results > 0 ? base.spend / results : null,
    video_3s_views:          row.actions?.some(a => a.action_type === 'video_view')
      ? pickAction(row.actions, ['video_view']) : null,
    video_thruplays:         videoStat(row.video_thruplay_watched_actions),
    video_p25:               videoStat(row.video_p25_watched_actions),
    video_p50:               videoStat(row.video_p50_watched_actions),
    video_p75:               videoStat(row.video_p75_watched_actions),
    video_p95:               videoStat(row.video_p95_watched_actions),
    video_p100:              videoStat(row.video_p100_watched_actions),
    video_avg_watch_seconds: videoStat(row.video_avg_time_watched_actions),
    actions:                 row.actions ?? null,
  }
}

function parseCampaignDailyRow(row: GraphCampaignDailyRow): MetaCampaignDailyRow | null {
  if (!row.campaign_id || !row.date_start) return null

  return {
    campaign_id:   row.campaign_id,
    campaign_name: row.campaign_name ?? row.campaign_id,
    insight_date:  row.date_start,
    ...parseDailyMetrics(row),
  }
}

export const DAILY_FIELD_LIST = [
  'campaign_id',
  'campaign_name',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'frequency',
  'cpm',
  'actions',
  'video_thruplay_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_avg_time_watched_actions',
]

const DAILY_FIELDS = DAILY_FIELD_LIST.join(',')

/**
 * Fetch per-campaign, per-day insights across a date range, following pagination.
 *
 * Unlike `getAdCampaignInsights` this returns EVERY campaign (no spend-sorted
 * top-N truncation) broken down by day, which is what a time series requires.
 *
 * Degrades rather than throwing: on any transport/HTTP error it returns the
 * rows gathered so far with `complete: false`.
 */
export async function getCampaignDailyInsights(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<InsightPageWalk<MetaCampaignDailyRow>> {
  const params = new URLSearchParams({
    fields: DAILY_FIELDS,
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'campaign',
    time_increment: '1',
    limit: '500',
  })

  return fetchInsightPages<GraphCampaignDailyRow, MetaCampaignDailyRow>(
    `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`,
    'campaign daily',
    parseCampaignDailyRow,
  )
}

/**
 * Fetch each campaign's frequency over a whole window (typically 7 days).
 *
 * Frequency is impressions/reach and is NOT additive — averaging seven daily
 * frequencies does not give the 7-day frequency, because reach deduplicates
 * people across the window. It must be requested for the window itself.
 */
export async function getCampaignWindowFrequency(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  return (await walkCampaignWindowFrequency(adAccountId, accessToken, since, until)).frequency
}

/** Same read, but says whether every page came back (Magic Bridge live rules must not judge on a partial map). */
export async function walkCampaignWindowFrequency(
  adAccountId: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<{ frequency: Map<string, number>; complete: boolean }> {
  const params = new URLSearchParams({
    fields: 'campaign_id,frequency',
    time_range: JSON.stringify({ since, until }),
    access_token: accessToken,
    level: 'campaign',
    limit: '500',
  })

  const out = new Map<string, number>()
  let url: string | undefined = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`

  for (let page = 0; page < MAX_INSIGHT_PAGES && url; page++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error('[meta/client] window frequency fetch error:', err)
      return { frequency: out, complete: false }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/client] window frequency HTTP ${res.status}:`, body.slice(0, 300))
      return { frequency: out, complete: false }
    }

    const json = await res.json() as {
      data?: Array<{ campaign_id?: string; frequency?: string }>
      paging?: { next?: string }
    }

    for (const row of json.data ?? []) {
      if (!row.campaign_id || row.frequency === undefined) continue
      const freq = parseFloat(row.frequency)
      if (Number.isFinite(freq)) out.set(row.campaign_id, freq)
    }

    url = json.paging?.next
  }

  return { frequency: out, complete: url === undefined }
}
