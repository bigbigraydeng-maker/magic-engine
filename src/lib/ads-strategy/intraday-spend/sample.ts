import {
  LEAD_ACTION_PRIORITY,
  MESSAGING_ACTION_PRIORITY,
  type MetaActionStat,
} from '@/lib/meta/objective-metrics'
import { SAMPLE_RETENTION_DAYS, SAMPLE_STEP_MINUTES } from './constants'

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP'])
const RATE_CODES = new Set([4, 17, 32, 613])

export interface LiveAdset {
  id: string
  campaignId: string | null
  status: string | null
}
export interface InsightSpendRow {
  adsetId: string
  spend?: string
  impressions?: string
  /** Meta inline_link_clicks. Omitted means unknown, not zero. */
  inlineLinkClicks?: string
  /** Omitted means unknown results. A present list uses the health ladder. */
  actions?: readonly MetaActionStat[] | null
}
export interface SpendDraft {
  clientId: string
  adAccountId: string
  accountDay: string
  sampledAt: string
  localMinute: number
  entityLevel: 'campaign' | 'adset'
  entityId: string
  spendMinor: number
  impressions: number
  linkClicks: number | null
  results: number | null
  currency: string | null
  timezone: string
}
export function accountDayKey(timezone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return null
  }
}
export function shiftDay(day: string, delta: number): string {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + delta)
  return t.toISOString().slice(0, 10)
}

/** Minute of the account-local day. Unknown or invalid timezones return null (do not assume UTC). */
export function localMinuteOfDay(timezone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    let hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    if (hour === 24) hour = 0
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
    return hour * 60 + minute
  } catch {
    return null
  }
}
export function bucketMinute(localMinute: number): number | null {
  if (!Number.isInteger(localMinute) || localMinute < 0 || localMinute > 1439) return null
  return Math.floor(localMinute / SAMPLE_STEP_MINUTES) * SAMPLE_STEP_MINUTES
}
export function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - SAMPLE_RETENTION_DAYS * 86_400_000).toISOString()
}
export function isGraphRateLimited(error: { status: number; code: number | null } | null): boolean {
  if (!error) return false
  if (error.status === 429) return true
  return error.code !== null && RATE_CODES.has(error.code)
}
export function minorToMajor(minor: number, currency: string | null): number {
  const factor = currency !== null && ZERO_DECIMAL.has(currency.trim().toUpperCase()) ? 1 : 100
  return minor / factor
}

/** Graph spend is major units. null = the string was present but not a number. */
export function spendToMinor(amount: string | undefined, currency: string | null): number | null {
  if (amount === undefined) return 0
  const trimmed = amount.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  const factor = currency !== null && ZERO_DECIMAL.has(currency.trim().toUpperCase()) ? 1 : 100
  return Math.round(n * factor)
}
function impressionsOf(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n)
}

const PG_INT_MAX = 2 ** 31 - 1

/** A reported count. Omitted, blank, or not a non-negative integer → null, not 0. */
export function reportedCount(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  const rounded = Math.round(n)
  if (!Number.isSafeInteger(rounded) || rounded > PG_INT_MAX) return null
  return rounded
}

function ladderCount(actions: readonly MetaActionStat[], priority: readonly string[]): number | null {
  for (const wanted of priority) {
    const hit = actions.find((row) => row.action_type === wanted)
    if (!hit) continue
    return reportedCount(hit.value)
  }
  return 0
}

/**
 * Health convention: one lead type, one messaging type, then the larger of the two.
 * Overlapping parent and child action types are not summed.
 * No actions array → null (unknown), not 0.
 */
export function resultsFromActions(actions: readonly MetaActionStat[] | null | undefined): number | null {
  if (!Array.isArray(actions)) return null
  const leads = ladderCount(actions, LEAD_ACTION_PRIORITY)
  const messaging = ladderCount(actions, MESSAGING_ACTION_PRIORITY)
  if (leads === null || messaging === null) return null
  return Math.max(leads, messaging)
}

interface Outcome {
  linkClicks: number | null
  results: number | null
}

/** A missing insight row is zero delivery. A present row with an omitted field stays unknown. */
function outcomeOf(row: InsightSpendRow | undefined): Outcome {
  if (!row) return { linkClicks: 0, results: 0 }
  return {
    linkClicks: reportedCount(row.inlineLinkClicks),
    results: resultsFromActions(row.actions),
  }
}

function addCount(total: number | null, next: number | null): number | null {
  if (total === null || next === null) return null
  return total + next
}

interface CampaignTotals {
  spend: number
  impressions: number
  linkClicks: number | null
  results: number | null
}

function addToCampaign(total: CampaignTotals, spend: number, impressions: number, outcome: Outcome): void {
  total.spend += spend
  total.impressions += impressions
  total.linkClicks = addCount(total.linkClicks, outcome.linkClicks)
  total.results = addCount(total.results, outcome.results)
}

/** ACTIVE ad sets plus one campaign sum. null = do not store. A missing insight row is 0. */
export function draftsForAccount(input: {
  clientId: string
  adAccountId: string
  accountDay: string
  sampledAt: string
  localMinute: number
  timezone: string
  currency: string | null
  adsets: readonly LiveAdset[]
  insights: readonly InsightSpendRow[]
  insightsComplete: boolean
}): SpendDraft[] | null {
  if (!input.insightsComplete) return null
  const minute = bucketMinute(input.localMinute)
  if (minute === null) return null
  const live = input.adsets.filter((a) => a.status === 'ACTIVE' && a.id)
  if (live.length === 0) return []
  const lookup = new Map(input.insights.filter((r) => r.adsetId).map((r) => [r.adsetId, r]))
  const base = {
    clientId: input.clientId,
    adAccountId: input.adAccountId,
    accountDay: input.accountDay,
    sampledAt: input.sampledAt,
    localMinute: minute,
    currency: input.currency,
    timezone: input.timezone,
  }
  return buildDrafts(live, lookup, input.currency, base)
}

type DraftBase = Omit<SpendDraft, 'entityLevel' | 'entityId' | 'spendMinor' | 'impressions' | 'linkClicks' | 'results'>

function buildDrafts(
  live: readonly LiveAdset[],
  lookup: Map<string, InsightSpendRow>,
  currency: string | null,
  base: DraftBase,
): SpendDraft[] | null {
  const adsets: SpendDraft[] = []
  const byCampaign = new Map<string, CampaignTotals>()
  for (const adset of live) {
    const row = lookup.get(adset.id)
    const spend = spendToMinor(row?.spend, currency)
    const impressions = impressionsOf(row?.impressions)
    if (spend === null || impressions === null) return null
    const outcome = outcomeOf(row)
    adsets.push(adsetDraft(base, adset.id, spend, impressions, outcome))
    if (!adset.campaignId) continue
    const g = byCampaign.get(adset.campaignId) ?? emptyCampaign()
    addToCampaign(g, spend, impressions, outcome)
    byCampaign.set(adset.campaignId, g)
  }
  return [...adsets, ...campaignDrafts(base, byCampaign)]
}

function adsetDraft(
  base: DraftBase,
  entityId: string,
  spendMinor: number,
  impressions: number,
  outcome: Outcome,
): SpendDraft {
  return {
    ...base,
    entityLevel: 'adset',
    entityId,
    spendMinor,
    impressions,
    linkClicks: outcome.linkClicks,
    results: outcome.results,
  }
}

function campaignDrafts(base: DraftBase, byCampaign: Map<string, CampaignTotals>): SpendDraft[] {
  return [...byCampaign.entries()].map(([id, g]) => ({
    ...base,
    entityLevel: 'campaign',
    entityId: id,
    spendMinor: g.spend,
    impressions: g.impressions,
    linkClicks: g.linkClicks,
    results: g.results,
  }))
}

function emptyCampaign(): CampaignTotals {
  return { spend: 0, impressions: 0, linkClicks: 0, results: 0 }
}
