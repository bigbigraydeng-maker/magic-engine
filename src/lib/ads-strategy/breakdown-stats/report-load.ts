import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BreakdownReport,
  REPORT_DEFAULT_DAYS,
  REPORT_MAX_DAYS,
  ReportAccount,
} from './report-types'
import { buildBreakdownReport, LeadInput, StatInput } from './report'

export interface ReportLoadDeps {
  supabase: SupabaseClient
  resolveTimezone(adAccountId: string): Promise<string | null>
  now(): Date
}

const PAGE_SIZE = 1000
const OBJECTIVE_CHUNK = 200

/** Parse `days` query param; clamp to [7, REPORT_MAX_DAYS] with default fallback. */
export function clampDays(raw: string | null): number {
  if (raw === null) return REPORT_DEFAULT_DAYS
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || Number.isNaN(n) || n < 7) return REPORT_DEFAULT_DAYS
  if (n > REPORT_MAX_DAYS) return REPORT_MAX_DAYS
  return n
}

/** Convert an ISO timestamp to a local date/hour in the given timezone. */
export function localParts(
  iso: string,
  timezone: string | null,
): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(new Date(iso))
  let year = ''
  let month = ''
  let day = ''
  let hour = 0
  for (const p of parts) {
    if (p.type === 'year') year = p.value
    else if (p.type === 'month') month = p.value
    else if (p.type === 'day') day = p.value
    else if (p.type === 'hour') hour = Number.parseInt(p.value, 10)
  }
  return { date: `${year}-${month}-${day}`, hour }
}

function utcDateString(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysUtc(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return utcDateString(d)
}

function normaliseAccountId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`
}

interface RawAccountRow {
  ad_account_id: string
  hidden_from_ad_health: boolean | null
}

async function loadAccounts(
  clientId: string,
  deps: ReportLoadDeps,
): Promise<string[]> {
  const { data, error } = await deps.supabase
    .from('client_meta_ad_accounts')
    .select('ad_account_id, hidden_from_ad_health')
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as RawAccountRow[]
  return rows
    .filter((r) => !r.hidden_from_ad_health)
    .map((r) => normaliseAccountId(r.ad_account_id))
}

interface AccountMeta {
  latestStatDate: string | null
  lastFetchedAt: string | null
  currency: string | null
}

async function loadAccountMeta(
  adAccountId: string,
  deps: ReportLoadDeps,
): Promise<AccountMeta> {
  const latest = await deps.supabase
    .from('ad_breakdown_stats')
    .select('stat_date, fetched_at')
    .eq('ad_account_id', adAccountId)
    .order('stat_date', { ascending: false })
    .limit(1)
  if (latest.error) throw new Error(latest.error.message)
  const latestRow = (latest.data ?? [])[0] as
    | { stat_date: string; fetched_at: string | null }
    | undefined

  const currency = await deps.supabase
    .from('ad_breakdown_stats')
    .select('currency')
    .eq('ad_account_id', adAccountId)
    .limit(1)
  if (currency.error) throw new Error(currency.error.message)
  const currencyRow = (currency.data ?? [])[0] as
    | { currency: string | null }
    | undefined

  return {
    latestStatDate: latestRow?.stat_date ?? null,
    lastFetchedAt: latestRow?.fetched_at ?? null,
    currency: currencyRow?.currency ?? null,
  }
}

async function loadReportAccounts(
  accountIds: string[],
  deps: ReportLoadDeps,
): Promise<ReportAccount[]> {
  const out: ReportAccount[] = []
  for (const id of accountIds) {
    const timezone = await deps.resolveTimezone(id)
    const meta = await loadAccountMeta(id, deps)
    out.push({
      adAccountId: id,
      currency: meta.currency,
      timezone,
      latestStatDate: meta.latestStatDate,
      lastFetchedAt: meta.lastFetchedAt,
    })
  }
  return out
}

function computeWindow(
  accounts: ReportAccount[],
  days: number,
  now: Date,
): { since: string; until: string } {
  let until: string | null = null
  for (const a of accounts) {
    if (a.latestStatDate && (until === null || a.latestStatDate > until)) {
      until = a.latestStatDate
    }
  }
  if (until === null) {
    const yesterday = new Date(now.getTime())
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    until = utcDateString(yesterday)
  }
  const since = addDaysUtc(until, -(days - 1))
  return { since, until }
}

interface RawStatRow {
  ad_account_id: string
  entity_id: string
  campaign_id: string | null
  stat_date: string
  breakdown_key: string
  breakdown_value: Record<string, string | number> | null
  spend: number | string | null
  impressions: number | string | null
  clicks: number | string | null
  link_clicks?: number | string | null
  meta_leads: number | string | null
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function toStatInput(r: RawStatRow): StatInput {
  return {
    ad_account_id: r.ad_account_id,
    campaign_id: r.campaign_id,
    stat_date: r.stat_date,
    breakdown_key: r.breakdown_key,
    breakdown_value: r.breakdown_value ?? {},
    spend: toNumber(r.spend),
    impressions: toNumber(r.impressions),
    clicks: toNumber(r.clicks),
    link_clicks: r.link_clicks == null ? null : toNumber(r.link_clicks),
    meta_leads: r.meta_leads === null ? null : toNumber(r.meta_leads),
  }
}

/** Parallel page requests; 90 days of hourly/region/age rows is ~30 pages, one at a time took seconds. */
const STATS_PAGE_CONCURRENCY = 6

export async function loadStats(
  accountIds: string[],
  since: string,
  until: string,
  deps: ReportLoadDeps,
): Promise<{ stats: StatInput[]; adAccountMap: Map<string, string> }> {
  const adAccountMap = new Map<string, string>()
  if (accountIds.length === 0) return { stats: [], adAccountMap }
  const query = () =>
    deps.supabase
      .from('ad_breakdown_stats')
      .select(
        'ad_account_id, entity_id, campaign_id, stat_date, breakdown_key, breakdown_value, spend, impressions, clicks, link_clicks, meta_leads',
      )
      .in('ad_account_id', accountIds)
      .gte('stat_date', since)
      .lte('stat_date', until)
      .order('id', { ascending: true })
  const fetchPage = async (page: number): Promise<RawStatRow[]> => {
    const from = page * PAGE_SIZE
    const { data, error } = await query().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    return (data ?? []) as RawStatRow[]
  }

  const raw: RawStatRow[] = []
  // Fetch pages in batches; stop at the first short page so a count is never needed.
  for (let page = 0; ; page += STATS_PAGE_CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: STATS_PAGE_CONCURRENCY }, (_, i) => fetchPage(page + i)),
    )
    let done = false
    for (const rows of batch) {
      if (done) break
      for (const r of rows) raw.push(r)
      if (rows.length < PAGE_SIZE) done = true
    }
    if (done) break
  }

  // Lead form ad -> account, from the placement rows already loaded (no second query).
  for (const r of raw) {
    if (r.breakdown_key === 'placement_device' && r.entity_id && !adAccountMap.has(r.entity_id)) {
      adAccountMap.set(r.entity_id, r.ad_account_id)
    }
  }
  return { stats: raw.map(toStatInput), adAccountMap }
}

interface RawSnapshotRow {
  entity_id: string
  objective: string | null
  captured_at: string
}

async function loadObjectives(
  campaignIds: string[],
  deps: ReportLoadDeps,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  if (campaignIds.length === 0) return result
  const latestAt = new Map<string, string>()
  for (let i = 0; i < campaignIds.length; i += OBJECTIVE_CHUNK) {
    const chunk = campaignIds.slice(i, i + OBJECTIVE_CHUNK)
    // Each campaign has many snapshot rows; page through them, or campaigns past the 1000-row
    // response cap would silently lose their objective and drop out of the lead metrics.
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await deps.supabase
        .from('ad_entity_snapshots')
        .select('entity_id, objective, captured_at')
        .eq('level', 'campaign')
        .in('entity_id', chunk)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as RawSnapshotRow[]
      for (const r of rows) {
        // A 'disappeared' or partial snapshot can carry a null objective; never let it hide the real one.
        if (r.objective === null) continue
        const prev = latestAt.get(r.entity_id)
        if (prev === undefined || r.captured_at > prev) {
          latestAt.set(r.entity_id, r.captured_at)
          result.set(r.entity_id, r.objective)
        }
      }
      if (rows.length < PAGE_SIZE) break
    }
  }
  return result
}

interface RawTouchpointRow {
  attr_ad_id: string
  occurred_at: string
}

async function loadTouchpoints(
  clientId: string,
  sinceIso: string,
  deps: ReportLoadDeps,
): Promise<RawTouchpointRow[]> {
  const out: RawTouchpointRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await deps.supabase
      .from('contact_touchpoints')
      .select('attr_ad_id, occurred_at')
      .eq('client_id', clientId)
      .eq('channel', 'meta_lead_form')
      .not('attr_ad_id', 'is', null)
      .gte('occurred_at', sinceIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as RawTouchpointRow[]
    for (const r of rows) out.push(r)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

function buildLeads(
  touchpoints: RawTouchpointRow[],
  adAccountMap: Map<string, string>,
  timezoneByAccount: Map<string, string | null>,
  since: string,
  until: string,
): { leads: LeadInput[]; unmatched: number } {
  const out: LeadInput[] = []
  let unmatched = 0
  for (const t of touchpoints) {
    const accountId = adAccountMap.get(t.attr_ad_id)
    if (!accountId) {
      // No account to take a timezone from; judge the window in UTC just for the count.
      const { date } = localParts(t.occurred_at, null)
      if (date >= since && date <= until) unmatched += 1
      continue
    }
    const tz = timezoneByAccount.get(accountId) ?? null
    const { date, hour } = localParts(t.occurred_at, tz)
    if (date < since || date > until) continue
    out.push({ ad_account_id: accountId, local_date: date, local_hour: hour })
  }
  return { leads: out, unmatched }
}

/** Load everything needed for the breakdown report and build it. */
export async function loadBreakdownReport(
  clientId: string,
  days: number,
  deps: ReportLoadDeps,
): Promise<BreakdownReport> {
  const accountIds = await loadAccounts(clientId, deps)
  const accounts = await loadReportAccounts(accountIds, deps)
  const { since, until } = computeWindow(accounts, days, deps.now())

  const sinceIso = `${addDaysUtc(since, -1)}T00:00:00Z`
  const [{ stats, adAccountMap }, touchpoints] = await Promise.all([
    loadStats(accountIds, since, until, deps),
    loadTouchpoints(clientId, sinceIso, deps),
  ])

  const campaignIdSet = new Set<string>()
  for (const s of stats) {
    if (s.campaign_id) campaignIdSet.add(s.campaign_id)
  }
  const objectives = await loadObjectives([...campaignIdSet], deps)

  const timezoneByAccount = new Map<string, string | null>()
  for (const a of accounts) timezoneByAccount.set(a.adAccountId, a.timezone)

  const { leads, unmatched } = buildLeads(touchpoints, adAccountMap, timezoneByAccount, since, until)

  return buildBreakdownReport({
    since,
    until,
    days,
    accounts,
    stats,
    leads,
    objectives,
    unmatchedLeads: unmatched,
  })
}
