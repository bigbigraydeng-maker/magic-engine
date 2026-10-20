import { supabaseAdmin } from '@/lib/supabase'

export type LiveAdsFact =
  | { ok: true; live_adsets: number; spend_today: number | null; spend_day: string | null; currency: string | null; as_of: string | null }
  | { ok: false; reason: string }

export interface LiveAdsInput {
  /** latest snapshot row per adset (already de-duplicated by entity, newest first-wins) */
  adsets: { entity_id: string; effective_status: string | null; capture_reason: string | null; captured_at: string }[]
  /** campaign-level insight rows for the most recent insight_date that exists */
  insights: { insight_date: string; spend: number | null }[]
  currency: string | null
  today: string // YYYY-MM-DD in the account timezone (caller supplies)
}

export function summarizeLiveAds(input: LiveAdsInput): LiveAdsFact {
  const live_adsets = input.adsets.filter(
    (a) => a.effective_status === 'ACTIVE' && a.capture_reason !== 'disappeared',
  ).length

  let spend_day: string | null = null
  for (const row of input.insights) {
    if (spend_day === null || row.insight_date > spend_day) {
      spend_day = row.insight_date
    }
  }

  let spend_today: number | null = null
  if (spend_day !== null && spend_day === input.today) {
    let sum = 0
    for (const row of input.insights) {
      if (row.insight_date === input.today) {
        sum += row.spend ?? 0
      }
    }
    spend_today = sum
  }

  let as_of: string | null = null
  for (const a of input.adsets) {
    if (as_of === null || a.captured_at > as_of) {
      as_of = a.captured_at
    }
  }

  return {
    ok: true,
    live_adsets,
    spend_today,
    spend_day,
    currency: input.currency,
    as_of,
  }
}

function normalizeAccountId(raw: string): string {
  const digits = raw.replace(/^act_/, '')
  return `act_${digits}`
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function loadAccountIds(clientId: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id')
    .eq('client_id', clientId)
  if (error) return null
  const rows = (data ?? []) as { ad_account_id: string | null }[]
  const ids = rows
    .map((r) => r.ad_account_id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (ids.length > 0) return ids.map(normalizeAccountId)

  const fallback = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  if (fallback.error) return null
  const single = (fallback.data as { meta_ad_account_id: string | null } | null)?.meta_ad_account_id
  if (typeof single === 'string' && single.length > 0) return [normalizeAccountId(single)]
  return []
}

interface AdsetRow {
  entity_id: string
  effective_status: string | null
  capture_reason: string | null
  captured_at: string
}

async function loadAdsets(clientId: string, accounts: string[], since: string): Promise<AdsetRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('entity_id, effective_status, capture_reason, captured_at')
    .eq('client_id', clientId)
    .eq('level', 'adset')
    .in('ad_account_id', accounts)
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(2000)
  if (error) return null
  const rows = (data ?? []) as AdsetRow[]
  const seen = new Set<string>()
  const out: AdsetRow[] = []
  for (const r of rows) {
    if (seen.has(r.entity_id)) continue
    seen.add(r.entity_id)
    out.push(r)
  }
  return out
}

interface InsightRow {
  insight_date: string
  spend: number | null
}

async function loadInsights(clientId: string, accounts: string[], since: string): Promise<InsightRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date, spend')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .in('ad_account_id', accounts)
    .gte('insight_date', since)
  if (error) return null
  const raw = (data ?? []) as { insight_date: string; spend: unknown }[]
  let latest: string | null = null
  for (const r of raw) {
    if (latest === null || r.insight_date > latest) latest = r.insight_date
  }
  if (latest === null) return []
  return raw
    .filter((r) => r.insight_date === latest)
    .map((r) => ({ insight_date: r.insight_date, spend: toNumberOrNull(r.spend) }))
}

async function loadCurrency(clientId: string, accounts: string[]): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('currency')
    .eq('client_id', clientId)
    .eq('level', 'account')
    .in('ad_account_id', accounts)
    .order('captured_at', { ascending: false })
    .limit(1)
  if (error) return null
  const rows = (data ?? []) as { currency: string | null }[]
  return rows[0]?.currency ?? null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function minusDays(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000)
}

export async function loadLiveAds(clientId: string, now: Date = new Date()): Promise<LiveAdsFact> {
  try {
    const accounts = await loadAccountIds(clientId)
    if (accounts === null) return { ok: false, reason: '读不到广告花费' }
    if (accounts.length === 0) return { ok: false, reason: '这个客户没有绑定广告账户' }

    const today = isoDate(now)
    const adsetsSince = minusDays(now, 2).toISOString()
    const insightsSince = isoDate(minusDays(now, 1))

    const adsets = await loadAdsets(clientId, accounts, adsetsSince)
    if (adsets === null) return { ok: false, reason: '读不到广告花费' }

    const insights = await loadInsights(clientId, accounts, insightsSince)
    if (insights === null) return { ok: false, reason: '读不到广告花费' }

    const currency = await loadCurrency(clientId, accounts)

    return summarizeLiveAds({ adsets, insights, currency, today })
  } catch {
    return { ok: false, reason: '读不到广告花费' }
  }
}
