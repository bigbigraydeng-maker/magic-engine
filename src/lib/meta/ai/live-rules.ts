/**
 * Magic Bridge for self-serve accounts (PR-2; design docs/specs/2026-09-27-magic-bridge-self-serve-open-design.md):
 * run the daily patrol's ad-level rules (D2/D10) on the spot, with the customer's own read-only token, for an
 * account that is not in the daily patrol roster. Same rule code and thresholds as the patrol — this file only
 * builds the patrol's input shape from Graph reads (settings → normalize*, daily insights → DailyRow).
 *
 * Differences from the patrol, all leaning towards reporting less (never more):
 *  - "hit on two consecutive patrols" becomes "hit when judged as of the last day AND as of the day before", from
 *    one read (today's settings, Meta's current numbers);
 *  - setting changes come from Meta's updated_time only (a rename also counts → more "recently changed" skips);
 *  - the client's own Facebook page is the page with ≥ 60% of the last 28 days' ad spend; otherwise we do not judge.
 * Separate 15 s budget; too many ads or any incomplete read → no ad-by-ad check, the rest of the report is unaffected.
 */

import { fetchAdSettings, fetchAdsetSettings, fetchCampaignSettings } from '@/lib/meta/entity-settings'
import { getAdDailyInsights } from '@/lib/meta/ad-insights'
import { getAdsetDailyInsights } from '@/lib/meta/adset-insights'
import { getCampaignWindowFrequency, type MetaCampaignDailyRow } from '@/lib/meta/campaign-insights'
import {
  normalizeAd, normalizeAdset, normalizeCampaign, type EntitySnapshotRow, type SnapshotRowDraft,
} from '@/lib/ads-strategy/portfolio/snapshot'
import { buildAccountContext, shiftDate } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { adLevelCoverage, diagnoseAdLevelRules } from '@/lib/ads-strategy/portfolio/diagnostics/d2-d10-ad-rules'
import type {
  AccountInput, DailyRow, Diagnosis, DiagnosisInput, SettingChange,
} from '@/lib/ads-strategy/portfolio/diagnostics/types'
import { emptyOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-ladder'
import { findingKey } from '@/lib/ads-strategy/rules/patrol-findings'
import { toClientFinding, type ClientRuleFinding, type RuleSectionInput } from '@/lib/ads-strategy/rules/client-copy'

export const LIVE_RULES_BUDGET_MS = 15_000
export const LIVE_HISTORY_DAYS = 28
export const LIVE_MAX_AD_ROWS = 4000
export const LIVE_PAGE_SHARE_MIN = 0.6

export interface LiveRulesArgs {
  clientId: string
  adAccountId: string
  token: string
  currency: string | null
  timezone: string | null
  /** Last complete day in the account's timezone (the report window's end). */
  windowUntil: string
}

type SkipReason = 'mixed_pages' | 'too_many_ads' | 'live_unavailable'
class LiveSkip extends Error {
  constructor(readonly reason: SkipReason) { super(reason) }
}

export interface LiveData {
  snapshots: EntitySnapshotRow[]
  adDaily: DailyRow[]
  daily: DailyRow[]
  settingChanges: SettingChange[]
  frequency: Map<string, number>
}

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LiveSkip('live_unavailable')), ms)
    work.then((v) => { clearTimeout(timer); resolve(v) }, (e: unknown) => { clearTimeout(timer); reject(e) })
  })
}

/** Ad-level parent_id is the CAMPAIGN id (same as the patrol's ad_daily_insights rows); the ad's ad set comes from the snapshot. */
export function toDailyRow(level: 'ad' | 'adset', entityId: string, row: MetaCampaignDailyRow): DailyRow {
  return {
    level, entity_id: entityId, parent_id: row.campaign_id, insight_date: row.insight_date,
    spend: row.spend, impressions: row.impressions, reach: row.reach, clicks: row.clicks,
    leads: row.leads, messaging_conversations: row.messaging_conversations, video_thruplays: row.video_thruplays,
    actions: row.actions,
  }
}

function stamp(draft: SnapshotRowDraft, capturedAt: string): EntitySnapshotRow {
  return { ...draft, settings_hash: 'live', capture_reason: 'daily', captured_at: capturedAt }
}

async function readLive(args: LiveRulesArgs): Promise<LiveData> {
  const since = shiftDate(args.windowUntil, -(LIVE_HISTORY_DAYS - 1))
  const [campaigns, adsets, ads, adRows, adsetRows, frequency] = await Promise.all([
    fetchCampaignSettings(args.adAccountId, args.token),
    fetchAdsetSettings(args.adAccountId, args.token),
    fetchAdSettings(args.adAccountId, args.token),
    getAdDailyInsights(args.adAccountId, args.token, since, args.windowUntil),
    getAdsetDailyInsights(args.adAccountId, args.token, since, args.windowUntil),
    getCampaignWindowFrequency(args.adAccountId, args.token, shiftDate(args.windowUntil, -6), args.windowUntil),
  ])
  if (!campaigns.complete || !adsets.complete || !ads.complete || !adsetRows.complete) throw new LiveSkip('live_unavailable')
  if (!adRows.complete || adRows.rows.length > LIVE_MAX_AD_ROWS) throw new LiveSkip('too_many_ads')
  const ctx = { clientId: args.clientId, adAccountId: args.adAccountId, currency: args.currency, sharedAccount: false }
  const now = new Date().toISOString()
  const snapshots = [
    ...campaigns.rows.map((c) => stamp(normalizeCampaign(ctx, c), now)),
    ...adsets.rows.map((s) => stamp(normalizeAdset(ctx, s), now)),
    ...ads.rows.map((a) => stamp(normalizeAd(ctx, a), now)),
  ]
  const settingChanges: SettingChange[] = []
  for (const s of snapshots) {
    if (s.source_updated_time) settingChanges.push({ level: s.level, entity_id: s.entity_id, captured_at: s.source_updated_time })
  }
  return {
    snapshots, settingChanges, frequency,
    adDaily: adRows.rows.map((r) => toDailyRow('ad', r.ad_id, r)),
    daily: adsetRows.rows.map((r) => toDailyRow('adset', r.adset_id, r)),
  }
}

/**
 * The page carrying ≥ 60% of the window's ad spend. Ads without a known page count towards the total but can never
 * win. 'no_spend' = nothing spent in the window (nothing to judge); null = no page dominates.
 */
export function dominantPage(adDaily: readonly DailyRow[], snapshots: readonly EntitySnapshotRow[]): string | null | 'no_spend' {
  const pageOf = new Map<string, string | null>()
  for (const s of snapshots) if (s.level === 'ad') pageOf.set(s.entity_id, s.creative_page_id)
  const byPage = new Map<string, number>()
  let total = 0
  for (const r of adDaily) {
    total += r.spend
    const page = pageOf.get(r.entity_id)
    if (page) byPage.set(page, (byPage.get(page) ?? 0) + r.spend)
  }
  if (total <= 0) return 'no_spend'
  let best: string | null = null
  let bestSpend = 0
  for (const [page, spend] of byPage) if (spend > bestSpend) { best = page; bestSpend = spend }
  return best !== null && bestSpend / total >= LIVE_PAGE_SHARE_MIN ? best : null
}

function frequencyRows(frequency: Map<string, number>, day: string): DailyRow[] {
  return Array.from(frequency, ([campaignId, f]) => ({
    level: 'campaign' as const, entity_id: campaignId, parent_id: null, insight_date: day, spend: 0, impressions: 0,
    reach: null, clicks: 0, leads: 0, messaging_conversations: 0, video_thruplays: null, actions: null, frequency_7d: f,
  }))
}

/** Judge D2/D10 as of `day` using only data up to that day. Exported for tests. */
export function judgeAsOf(args: LiveRulesArgs, data: LiveData, day: string, pageId: string): { hits: Diagnosis[]; adsChecked: number } {
  const account: AccountInput = {
    adAccountId: args.adAccountId, shared: false, timezone: args.timezone, currency: args.currency,
    snapshots: data.snapshots,
    daily: [...data.daily.filter((r) => r.insight_date <= day), ...frequencyRows(data.frequency, day)],
    adDaily: data.adDaily.filter((r) => r.insight_date <= day),
    hourly: {}, hourlyError: null, latestCaptures: [], lastInsightDate: day, settingChanges: data.settingChanges,
  }
  const input: DiagnosisInput = {
    clientId: args.clientId, date: day, evaluatedAt: new Date().toISOString(), outcome: emptyOutcomeConfig(),
    outcomeConfigured: false, messagingReferralAvailable: false, digestRecipients: [], clientPageId: pageId,
    accounts: [account],
  }
  const ctx = buildAccountContext(account, day)
  const hits = diagnoseAdLevelRules(ctx, input).filter((d) => d.status === 'hit' && d.clientVisible)
  return { hits, adsChecked: adLevelCoverage(ctx, input).adsChecked }
}

/** Keep only findings hit both as of the last day and as of the day before (the patrol's two-in-a-row rule). */
export function liveSection(args: LiveRulesArgs, data: LiveData): RuleSectionInput {
  const page = dominantPage(data.adDaily, data.snapshots)
  if (page === 'no_spend') return { source: 'live', dataDate: args.windowUntil, adsChecked: 0, findings: [] }
  if (page === null) return { source: 'none', reason: 'mixed_pages' }
  const last = judgeAsOf(args, data, args.windowUntil, page)
  const before = judgeAsOf(args, data, shiftDate(args.windowUntil, -1), page)
  const beforeKeys = new Set(before.hits.map(findingKey).filter((k): k is string => k !== null))
  const campaignFrequency = (id: string | null) => (id === null ? null : data.frequency.get(id) ?? null)
  const findings = last.hits
    .filter((f) => { const k = findingKey(f); return k !== null && beforeKeys.has(k) })
    .map((f) => toClientFinding(f, { currency: args.currency, dataDate: args.windowUntil, campaignFrequency, voice: 'self_serve' }))
    .filter((f): f is ClientRuleFinding => f !== null)
  return { source: 'live', dataDate: args.windowUntil, adsChecked: last.adsChecked, findings }
}

/** Never throws: any failure becomes a 'none' section with an honest reason. */
export async function runLiveRules(args: LiveRulesArgs, budgetMs = LIVE_RULES_BUDGET_MS): Promise<RuleSectionInput> {
  try {
    const data = await withBudget(readLive(args), budgetMs)
    return liveSection(args, data)
  } catch (error) {
    return { source: 'none', reason: error instanceof LiveSkip ? error.reason : 'live_unavailable' }
  }
}
