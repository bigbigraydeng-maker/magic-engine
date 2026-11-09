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
  const adsets: SpendDraft[] = []
  const byCampaign = new Map<string, { spend: number; impressions: number }>()
  for (const adset of live) {
    const row = lookup.get(adset.id)
    const spend = spendToMinor(row?.spend, input.currency)
    const impressions = impressionsOf(row?.impressions)
    if (spend === null || impressions === null) return null
    adsets.push({ ...base, entityLevel: 'adset', entityId: adset.id, spendMinor: spend, impressions })
    if (!adset.campaignId) continue
    const g = byCampaign.get(adset.campaignId) ?? { spend: 0, impressions: 0 }
    g.spend += spend
    g.impressions += impressions
    byCampaign.set(adset.campaignId, g)
  }
  const campaigns: SpendDraft[] = [...byCampaign.entries()].map(([id, g]) => ({
    ...base,
    entityLevel: 'campaign',
    entityId: id,
    spendMinor: g.spend,
    impressions: g.impressions,
  }))
  return [...adsets, ...campaigns]
}
