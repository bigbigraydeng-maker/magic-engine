/**
 * Read breaker facts from tables we already have. No Meta calls.
 * A truncated read is unreadable, not "nothing is wrong".
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { agreedPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { accountDayKey } from '@/lib/ads-strategy/account-timezone'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { hoursIntoLocalDay, previousDay, type BreakerFacts, type CaptureStamp, type InsightStamp, type PolicyAd, type PrimaryResultKind, type SpendRow } from './rules'
import { readBreakerSettings } from './settings'

const SPEND_LIMIT = 200
const SNAP_PAGE = 1000
const SNAP_MAX_PAGES = 20
const SNAP_LEVELS = new Set(['account', 'campaign', 'adset', 'ad'])
/** A later capture the same day stores only what changed. This reaches that day's full write. */
const CAPTURE_LOOKBACK_MS = 26 * 3_600_000

interface Snap {
  ad_account_id: string
  level: string
  entity_id: string
  entity_name: string | null
  campaign_id: string | null
  adset_id: string | null
  status: string | null
  effective_status: string | null
  captured_at: string
  timezone_name: string | null
  currency: string | null
}

interface SpendRaw {
  ad_account_id: string
  entity_id: string
  entity_name: string | null
  insight_date: string
  spend: number | string | null
  leads: number | null
  messaging_conversations: number | null
  updated_at: string | null
}

export async function loadBreakerFacts(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<BreakerFacts | 'unreadable'> {
  const client = await readClient(sb, clientId)
  if (!client) return 'unreadable'
  const strategy = await readStrategy(sb, clientId)
  if (!strategy) return 'unreadable'
  const plans = await readPlans(sb, clientId)
  if (!plans) return 'unreadable'
  const captured = await readCaptureRows(sb, clientId)
  if (!captured) return 'unreadable'
  const snaps = await readSnaps(sb, clientId, captured.rows)
  if (!snaps) return 'unreadable'
  const localDate = timezoneOf(snaps.rows) ? accountDayKey(timezoneOf(snaps.rows), now) : null
  const spend = await readSpend(sb, clientId, localDate)
  if (!spend) return 'unreadable'
  const captures = { rows: stalenessStamps(captured.rows), error: captured.error }
  const settings = readBreakerSettings(client.leads, plans.rows, strategy.row)
  const delivering = deliveringAccountIds(latestSnaps(snaps.rows), spend.rows, captures.rows, now, settings.staleHours)
  const accounts = accountIds(client.primary, snaps.rows, delivering)
  return assemble(now, localDate, client.leads, plans, snaps, spend, captures, accounts, strategy.row, delivering)
}

function assemble(
  now: Date,
  localDate: string | null,
  leads: unknown,
  plans: { rows: { plan_data?: unknown }[]; error: boolean },
  snaps: { rows: Snap[]; truncated: boolean },
  spend: { rows: SpendRaw[]; truncated: boolean },
  captures: { rows: CaptureStamp[]; error: boolean },
  accounts: string[],
  strategy: { target_cost_per_primary?: unknown; primary_result?: unknown } | null,
  delivering: readonly string[],
): BreakerFacts {
  const cap = plans.error ? null : agreedPlanDailyTotalCap(plans.rows)
  const latest = latestSnaps(snaps.rows)
  const live = liveCampaigns(latest)
  const currency = currencyOf(latest)
  const primaryResult = primaryResultOf(strategy?.primary_result)
  return {
    now,
    localDate,
    yesterday: localDate ? previousDay(localDate) : null,
    hoursElapsed: hoursIntoLocalDay(timezoneOf(snaps.rows), now),
    capCents: cap?.state === 'set' ? cap.cents : null,
    capReadable: !plans.error && cap?.state !== 'unreadable',
    settings: readBreakerSettings(leads, plans.rows, strategy),
    spend: spend.rows.flatMap((row) => mapSpend(row, live, currency, primaryResult)),
    spendReadable: !spend.truncated,
    policyAds: policyAds(latest, live),
    policyReadable: !snaps.truncated,
    captures: captures.rows,
    insights: insightStamps(spend.rows),
    accounts,
    freshReadable: !captures.error && !spend.truncated,
    deliveringAccounts: delivering,
    primaryResult,
  }
}

/** Same column mapping as ads health / ads strategy: lead → leads, messaging_started → messaging_conversations. */
function primaryResultOf(value: unknown): PrimaryResultKind | null {
  if (value === 'lead' || value === 'messaging_started') return value
  return null
}

function countedPrimary(primary: PrimaryResultKind | null, row: SpendRaw): number | null {
  if (primary === null) return null
  const raw = primary === 'messaging_started' ? row.messaging_conversations : row.leads
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

async function readClient(sb: SupabaseClient, clientId: string): Promise<{ leads: unknown; primary: string | null } | null> {
  const { data, error } = await sb.from('clients').select('leads_config, meta_ad_account_id').eq('id', clientId).maybeSingle()
  if (error) return null
  const row = data as { leads_config?: unknown; meta_ad_account_id?: string | null } | null
  return { leads: row?.leads_config ?? null, primary: row?.meta_ad_account_id ?? null }
}

async function readStrategy(
  sb: SupabaseClient,
  clientId: string,
): Promise<{ row: { target_cost_per_primary?: unknown; primary_result?: unknown } | null } | null> {
  const { data, error } = await sb.from('ad_strategy_configs').select('target_cost_per_primary, primary_result').eq('client_id', clientId).maybeSingle()
  if (error) return null
  return { row: (data as { target_cost_per_primary?: unknown; primary_result?: unknown } | null) ?? null }
}

async function readPlans(sb: SupabaseClient, clientId: string): Promise<{ rows: { plan_data?: unknown }[]; error: boolean } | null> {
  const { data, error } = await sb.from('marketing_plans').select('status, plan_data').eq('client_id', clientId).eq('status', 'approved').limit(20)
  if (error) return { rows: [], error: true }
  return { rows: (data ?? []) as { plan_data?: unknown }[], error: false }
}

const SNAP_COLUMNS = 'ad_account_id, level, entity_id, entity_name, campaign_id, adset_id, status, effective_status, captured_at, timezone_name, currency'

/** Latest complete capture, plus the same day's earlier rows. Older history is not a gap. */
async function readSnaps(
  sb: SupabaseClient,
  clientId: string,
  captures: readonly CaptureRow[],
): Promise<{ rows: Snap[]; truncated: boolean } | null> {
  const rows: Snap[] = []
  for (const point of snapPoints(captures)) {
    const page = await readSnapPoint(sb, clientId, point)
    if (!page) return null
    if (page.truncated) return { rows, truncated: true }
    rows.push(...page.rows)
  }
  return { rows, truncated: false }
}

async function readSnapPoint(
  sb: SupabaseClient,
  clientId: string,
  point: CapturePoint,
): Promise<{ rows: Snap[]; truncated: boolean } | null> {
  const rows: Snap[] = []
  for (let page = 0; page < SNAP_MAX_PAGES; page += 1) {
    const at = Date.parse(point.capturedAt)
    if (!Number.isFinite(at)) return { rows, truncated: true }
    const from = page * SNAP_PAGE
    const since = new Date(at - CAPTURE_LOOKBACK_MS).toISOString()
    const { data, error } = await sb.from('ad_entity_snapshots')
      .select(SNAP_COLUMNS)
      .eq('client_id', clientId)
      .eq('ad_account_id', point.accountId)
      .eq('level', point.level)
      .gte('captured_at', since)
      .lte('captured_at', point.capturedAt)
      .order('entity_id', { ascending: true })
      .order('captured_at', { ascending: true })
      .range(from, from + SNAP_PAGE - 1)
    if (error) return null
    const batch = (data ?? []) as Snap[]
    rows.push(...batch)
    if (batch.length < SNAP_PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

async function readSpend(
  sb: SupabaseClient,
  clientId: string,
  localDate: string | null,
): Promise<{ rows: SpendRaw[]; truncated: boolean } | null> {
  if (!localDate) return { rows: [], truncated: false }
  const { data, error } = await sb.from('ad_daily_insights')
    .select('ad_account_id, entity_id, entity_name, insight_date, spend, leads, messaging_conversations, updated_at')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gte('insight_date', previousDay(localDate))
    .lte('insight_date', localDate)
    .limit(SPEND_LIMIT)
  if (error) return null
  const rows = (data ?? []) as SpendRaw[]
  return { rows, truncated: rows.length >= SPEND_LIMIT }
}

async function readCaptureRows(sb: SupabaseClient, clientId: string): Promise<{ rows: CaptureRow[]; error: boolean } | null> {
  const { data, error } = await sb.from('ad_snapshot_captures')
    .select('ad_account_id, level, captured_at, complete, skipped_shared')
    .eq('client_id', clientId)
    .in('level', [...SNAP_LEVELS])
    .order('captured_at', { ascending: false })
    .limit(SPEND_LIMIT)
  if (error) return { rows: [], error: true }
  return { rows: (data ?? []) as CaptureRow[], error: false }
}

interface CaptureRow {
  ad_account_id: string
  level: string
  captured_at: string
  complete: boolean
  skipped_shared: boolean
}

interface CapturePoint {
  accountId: string
  level: string
  capturedAt: string
}

function snapPoints(rows: readonly CaptureRow[]): CapturePoint[] {
  const seen = new Set<string>()
  const out: CapturePoint[] = []
  for (const row of rows) {
    if (!row.complete || row.skipped_shared || !row.captured_at || !row.ad_account_id) continue
    if (!SNAP_LEVELS.has(row.level)) continue
    const key = `${row.ad_account_id}:${row.level}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ accountId: row.ad_account_id, level: row.level, capturedAt: row.captured_at })
  }
  return out
}

function stalenessStamps(rows: readonly CaptureRow[]): CaptureStamp[] {
  const seen = new Set<string>()
  const out: CaptureStamp[] = []
  for (const row of rows) {
    if ((row.level !== 'campaign' && row.level !== 'ad') || !row.complete || row.skipped_shared) continue
    if (seen.has(row.ad_account_id)) continue
    seen.add(row.ad_account_id)
    out.push({ accountId: row.ad_account_id, capturedAt: row.captured_at, complete: true })
  }
  return out
}

function deliveringAccountIds(
  latest: readonly Snap[],
  spend: readonly SpendRaw[],
  captures: readonly CaptureStamp[],
  now: Date,
  staleHours: number,
): string[] {
  const fresh = freshCaptureAccounts(captures, now, staleHours)
  const ids = new Set<string>()
  for (const row of latest) {
    if (fresh.has(row.ad_account_id) && liveEntity(row)) ids.add(row.ad_account_id)
  }
  for (const row of spend) if (spent(row)) ids.add(row.ad_account_id)
  return [...ids]
}

function freshCaptureAccounts(captures: readonly CaptureStamp[], now: Date, staleHours: number): Set<string> {
  const fresh = new Set<string>()
  for (const row of captures) {
    if (!row.complete || !row.capturedAt) continue
    const age = (now.getTime() - Date.parse(row.capturedAt)) / 3_600_000
    if (Number.isFinite(age) && age >= 0 && age < staleHours) fresh.add(row.accountId)
  }
  return fresh
}

function liveEntity(row: Snap): boolean {
  if (row.level !== 'campaign' && row.level !== 'adset' && row.level !== 'ad') return false
  return Boolean(row.effective_status && DELIVERING_STATUSES.has(row.effective_status))
}

function spent(row: SpendRaw): boolean {
  const amount = typeof row.spend === 'number' ? row.spend : Number(row.spend)
  return Number.isFinite(amount) && amount > 0
}

function latestSnaps(rows: readonly Snap[]): Snap[] {
  const newest = new Map<string, Snap>()
  for (const row of rows) {
    const key = `${row.ad_account_id}:${row.level}:${row.entity_id}`
    const prev = newest.get(key)
    if (!prev || row.captured_at > prev.captured_at) newest.set(key, row)
  }
  return [...newest.values()]
}

function liveCampaigns(rows: readonly Snap[]): Set<string> {
  const live = new Set<string>()
  for (const row of rows) {
    if (row.level === 'campaign' && row.effective_status && DELIVERING_STATUSES.has(row.effective_status)) live.add(row.entity_id)
  }
  return live
}

function policyAds(rows: readonly Snap[], live: Set<string>): PolicyAd[] {
  return rows.filter((row) => row.level === 'ad').map((row) => ({
    accountId: row.ad_account_id,
    campaignId: row.campaign_id ?? '',
    campaignName: campaignName(rows, row.campaign_id),
    adsetId: row.adset_id,
    configuredActive: row.status === 'ACTIVE',
    effectiveStatus: row.effective_status ?? '',
    campaignLive: row.campaign_id !== null && live.has(row.campaign_id),
  }))
}

function mapSpend(
  row: SpendRaw,
  live: Set<string>,
  currency: string | null,
  primary: PrimaryResultKind | null,
): SpendRow[] {
  const spend = typeof row.spend === 'number' ? row.spend : Number(row.spend)
  if (!row.entity_id || !Number.isFinite(spend)) return []
  return [{
    accountId: row.ad_account_id,
    campaignId: row.entity_id,
    campaignName: row.entity_name?.trim() || '在投的广告系列',
    day: String(row.insight_date).slice(0, 10),
    spendCents: Math.round(spend * 100),
    primaryCount: countedPrimary(primary, row),
    currency,
    campaignLive: live.has(row.entity_id),
  }]
}

function insightStamps(rows: readonly SpendRaw[]): InsightStamp[] {
  const newest = new Map<string, string>()
  for (const row of rows) {
    if (!row.updated_at) continue
    const prior = newest.get(row.ad_account_id)
    if (!prior || row.updated_at > prior) newest.set(row.ad_account_id, row.updated_at)
  }
  return [...newest].map(([accountId, updatedAt]) => ({ accountId, updatedAt }))
}

function accountIds(primary: string | null, rows: readonly Snap[], delivering: readonly string[]): string[] {
  const ids = new Set(rows.map((row) => row.ad_account_id).filter(Boolean))
  if (primary) ids.add(primary)
  for (const id of delivering) if (id) ids.add(id)
  return [...ids]
}

function timezoneOf(rows: readonly Snap[]): string | null {
  const account = rows.find((row) => row.level === 'account' && row.timezone_name)
  return account?.timezone_name ?? null
}

function currencyOf(rows: readonly Snap[]): string | null {
  const account = rows.find((row) => row.level === 'account' && row.currency)
  return account?.currency ?? null
}

function campaignName(rows: readonly Snap[], campaignId: string | null): string {
  const match = rows.find((row) => row.level === 'campaign' && row.entity_id === campaignId)
  return match?.entity_name?.trim() || '在投的广告系列'
}
