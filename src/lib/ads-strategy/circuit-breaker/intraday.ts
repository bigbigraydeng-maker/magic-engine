/**
 * Judge today's CPL from the intraday spend sample plus CRM leads.
 * Pure. The pause card is still the existing breaker card. No Meta calls.
 * A missing count, a stale sample, or a loose lead is not zero.
 */

import { SAMPLE_FRESH_MS, NZ_TZ } from '@/lib/ads-strategy/intraday-spend/cap-proposal'
import { accountDayKey } from '@/lib/ads-strategy/intraday-spend/sample'
import { endOfNzDayMs, nzDayMinus } from '@/lib/ads-strategy/promo-window'
import { applyBreaker, type ApplyDeps } from './apply'
import { defaultBreakerSettings } from './settings'
import {
  judgeBreaker,
  previousDay,
  type BreakerFacts,
  type BreakerJudgement,
  type PauseProposal,
  type PrimaryResultKind,
  type SpendRow,
} from './rules'
import type { BreakerSettings } from './settings'

export type IntradayRecheck = 'skip' | 'stale' | 'unread' | 'holding' | 'clear'

export interface IntradaySampleRow {
  readonly accountId: string
  readonly accountDay: string
  readonly sampledAt: string
  readonly localMinute: number
  readonly entityId: string
  readonly spendMinor: number
  readonly currency: string | null
  readonly name: string | null
}

export interface IntradayLeadRow {
  readonly campaignId: string | null
  readonly createdAt: string
}

export interface IntradayCplInput {
  readonly now: Date
  readonly nzDay: string | null
  readonly settings: BreakerSettings
  readonly primaryResult: PrimaryResultKind | null
  readonly samples: readonly IntradaySampleRow[] | null
  readonly leads: readonly IntradayLeadRow[] | null
}

export type IntradayCplVerdict =
  | { readonly kind: 'skip' | 'off' | 'stale' | 'unread' }
  | { readonly kind: 'judged'; readonly judgement: BreakerJudgement }

interface DayBounds {
  readonly start: number
  readonly end: number
}

const CPL_RULES = new Set(['cpl_zero_leads', 'cpl_over_target'])

export function nzDayBounds(day: string): DayBounds | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const end = endOfNzDayMs(day) + 999
  const start = endOfNzDayMs(nzDayMinus(day, 1)) + 1000
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null
  return { start, end }
}

export function judgeIntradayCpl(input: IntradayCplInput): IntradayCplVerdict {
  if (!input.settings.enabled) return { kind: 'off' }
  if (!input.nzDay || input.samples === null || input.leads === null) return { kind: 'unread' }
  if (input.primaryResult !== 'lead') return { kind: 'skip' }
  const latest = latestCampaigns(input.samples, input.nzDay)
  if (latest === 'bad') return { kind: 'unread' }
  if (latest === 'none') return { kind: 'skip' }
  if (latest.some((row) => !freshEnough(row.sampledAt, input.now))) return { kind: 'stale' }
  const bounds = nzDayBounds(input.nzDay)
  if (!bounds) return { kind: 'unread' }
  return { kind: 'judged', judgement: judgeBreaker(factsOf(input, latest, bounds)) }
}

export function intradayPauses(judgement: BreakerJudgement): PauseProposal[] {
  return judgement.pauses.filter((pause) => pause.rules.length > 0 && pause.rules.every((rule) => CPL_RULES.has(rule)))
}

export async function applyIntradayCpl(
  input: IntradayCplInput,
  deps: ApplyDeps,
): Promise<{ cards: number; kind: IntradayCplVerdict['kind'] }> {
  const verdict = judgeIntradayCpl(input)
  if (verdict.kind !== 'judged' || !input.nzDay) return { cards: 0, kind: verdict.kind }
  const applied = await applyBreaker({
    day: input.nzDay,
    pauses: intradayPauses(verdict.judgement),
    alerts: [],
    deps,
  })
  return { cards: applied.cards, kind: 'judged' }
}

/** Fixture only. The number 100 is not a client target. Production reads settings. */
export function dryIntradayCpl(
  rows: readonly {
    entityLevel: 'campaign' | 'adset'
    entityId: string
    adAccountId: string
    accountDay: string
    sampledAt: string
    localMinute: number
    spendMinor: number
    currency: string | null
  }[],
  now: Date,
): { cards: number; kind: IntradayCplVerdict['kind'] } {
  const nzDay = accountDayKey(NZ_TZ, now)
  const verdict = judgeIntradayCpl({
    now,
    nzDay,
    settings: { ...defaultBreakerSettings(), targetCplCents: 100 },
    primaryResult: 'lead',
    samples: rows.filter((row) => row.entityLevel === 'campaign').map(campaignSample),
    leads: [],
  })
  const cards = verdict.kind === 'judged' ? intradayPauses(verdict.judgement).length : 0
  return { cards, kind: verdict.kind }
}

function campaignSample(row: {
  entityId: string
  adAccountId: string
  accountDay: string
  sampledAt: string
  localMinute: number
  spendMinor: number
  currency: string | null
}): IntradaySampleRow {
  return {
    accountId: row.adAccountId,
    accountDay: row.accountDay,
    sampledAt: row.sampledAt,
    localMinute: row.localMinute,
    entityId: row.entityId,
    spendMinor: row.spendMinor,
    currency: row.currency,
    name: '合成系列',
  }
}

function latestCampaigns(
  rows: readonly IntradaySampleRow[],
  day: string,
): readonly IntradaySampleRow[] | 'none' | 'bad' {
  const today = rows.filter((row) => row.accountDay === day)
  if (today.length === 0) return 'none'
  if (today.some((row) => !usableSample(row))) return 'bad'
  const minute = new Map<string, number>()
  for (const row of today) {
    const prior = minute.get(row.accountId) ?? -1
    if (row.localMinute > prior) minute.set(row.accountId, row.localMinute)
  }
  const picked = new Map<string, IntradaySampleRow>()
  for (const row of today) {
    if (row.localMinute !== minute.get(row.accountId)) continue
    const prior = picked.get(row.entityId)
    if (!prior || row.sampledAt >= prior.sampledAt) picked.set(row.entityId, row)
  }
  return [...picked.values()]
}

function usableSample(row: IntradaySampleRow): boolean {
  return Number.isSafeInteger(row.spendMinor)
    && row.spendMinor >= 0
    && Number.isSafeInteger(row.localMinute)
    && row.localMinute >= 0
    && row.localMinute <= 1439
}

function freshEnough(iso: string, now: Date): boolean {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return false
  const age = now.getTime() - time
  return age >= 0 && age <= SAMPLE_FRESH_MS
}

function factsOf(input: IntradayCplInput, rows: readonly IntradaySampleRow[], bounds: DayBounds): BreakerFacts {
  const day = input.nzDay as string
  const spend = rows.map((row) => spendOf(row, input.leads ?? [], bounds, day))
  const accounts = [...new Set(spend.map((row) => row.accountId))]
  const fresh = rows.map((row) => row.sampledAt).sort().at(-1) ?? input.now.toISOString()
  return {
    now: input.now,
    localDate: day,
    yesterday: previousDay(day),
    hoursElapsed: 18,
    capCents: null,
    capReadable: true,
    settings: input.settings,
    spend,
    spendReadable: true,
    policyAds: [],
    policyReadable: true,
    captures: accounts.map((accountId) => ({ accountId, capturedAt: fresh, complete: true })),
    insights: accounts.map((accountId) => ({ accountId, updatedAt: fresh })),
    accounts,
    freshReadable: true,
    primaryResult: 'lead',
  }
}

function spendOf(row: IntradaySampleRow, leads: readonly IntradayLeadRow[], bounds: DayBounds, day: string): SpendRow {
  return {
    accountId: row.accountId,
    campaignId: row.entityId,
    campaignName: row.name?.trim() || '在投的广告系列',
    day,
    spendCents: row.spendMinor,
    primaryCount: countFor(row.entityId, leads, bounds),
    currency: row.currency,
    campaignLive: true,
  }
}

function countFor(campaignId: string, leads: readonly IntradayLeadRow[], bounds: DayBounds): number | null {
  let mine = 0
  let loose = 0
  for (const lead of leads) {
    const bucket = leadBucket(lead, campaignId, bounds)
    if (bucket === 'bad') return null
    if (bucket === 'mine') mine += 1
    if (bucket === 'loose') loose += 1
  }
  if (mine === 0 && loose > 0) return null
  return mine
}

function leadBucket(lead: IntradayLeadRow, campaignId: string, bounds: DayBounds): 'mine' | 'loose' | 'other' | 'bad' {
  const when = Date.parse(lead.createdAt)
  const loose = lead.campaignId === null || lead.campaignId === ''
  if (!Number.isFinite(when)) return loose || lead.campaignId === campaignId ? 'bad' : 'other'
  if (when < bounds.start || when > bounds.end) return 'other'
  if (lead.campaignId === campaignId) return 'mine'
  return loose ? 'loose' : 'other'
}
