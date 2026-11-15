/**
 * Read today's sample and CRM leads, then propose the existing pause card.
 * Does not write Meta and does not turn a client's breaker switch on.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NZ_TZ } from '@/lib/ads-strategy/intraday-spend/cap-proposal'
import { accountDayKey } from '@/lib/ads-strategy/intraday-spend/sample'
import { getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import {
  intradayPauses,
  judgeIntradayCpl,
  nzDayBounds,
  type IntradayCplInput,
  type IntradayLeadRow,
  type IntradayRecheck,
  type IntradaySampleRow,
} from './intraday'
import { proposeBreakerJudgement } from './run'
import { readBreakerSettings, type BreakerSettings } from './settings'
import type { PrimaryResultKind } from './rules'

const SAMPLE_CAP = 4000
const LEAD_CAP = 2000

interface ClientCtx {
  readonly settings: BreakerSettings
  readonly primaryResult: PrimaryResultKind | null
}

export interface IntradayCplReceipt {
  readonly cards: number
  readonly clients: number
  readonly failed: number
  readonly action: string
}

export async function runIntradayCplCards(sb: SupabaseClient, now: Date): Promise<IntradayCplReceipt> {
  let clients: { id: string }[]
  try {
    clients = await getActiveClientsWithMetaAccounts(sb)
  } catch {
    return { cards: 0, clients: 0, failed: 1, action: 'unread' }
  }
  let cards = 0
  let failed = 0
  for (const client of clients) {
    const one = await oneClient(sb, client.id, now)
    cards += one.cards
    if (one.failed) failed += 1
  }
  return { cards, clients: clients.length, failed, action: failed > 0 ? 'partial' : 'ok' }
}

export async function intradayPauseStill(
  sb: SupabaseClient,
  clientId: string,
  campaignId: string,
  now: Date,
): Promise<IntradayRecheck> {
  try {
    const input = await loadIntradayCplInput(sb, clientId, now)
    if (input === 'unread') return 'unread'
    return recheckOf(input, campaignId)
  } catch {
    return 'unread'
  }
}

export async function loadIntradayCplInput(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<IntradayCplInput | 'unread'> {
  const nzDay = accountDayKey(NZ_TZ, now)
  if (!nzDay) return 'unread'
  const ctx = await readContext(sb, clientId)
  if (!ctx) return 'unread'
  if (!ctx.settings.enabled || ctx.primaryResult !== 'lead') return packed(now, nzDay, ctx, [], [])
  const samples = await readSamples(sb, clientId, nzDay, await readNames(sb, clientId))
  if (!samples) return 'unread'
  const leads = await readLeads(sb, clientId, nzDay)
  if (!leads) return 'unread'
  return packed(now, nzDay, ctx, samples, leads)
}

function recheckOf(input: IntradayCplInput, campaignId: string): IntradayRecheck {
  const verdict = judgeIntradayCpl(input)
  if (verdict.kind === 'stale') return 'stale'
  if (verdict.kind === 'unread') return 'unread'
  if (verdict.kind !== 'judged') return 'skip'
  const hit = intradayPauses(verdict.judgement).some((pause) => pause.campaignId === campaignId)
  return hit ? 'holding' : 'clear'
}

async function oneClient(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<{ cards: number; failed: boolean }> {
  try {
    const input = await loadIntradayCplInput(sb, clientId, now)
    if (input === 'unread') return { cards: 0, failed: true }
    const verdict = judgeIntradayCpl(input)
    if (verdict.kind === 'unread') return { cards: 0, failed: true }
    if (verdict.kind !== 'judged' || !input.nzDay) return { cards: 0, failed: false }
    const result = await proposeBreakerJudgement(sb, clientId, input.nzDay, verdict.judgement)
    return { cards: result.cards, failed: Boolean(result.error) }
  } catch {
    return { cards: 0, failed: true }
  }
}

function packed(now: Date, nzDay: string, ctx: ClientCtx, samples: IntradaySampleRow[], leads: IntradayLeadRow[]): IntradayCplInput {
  return { now, nzDay, settings: ctx.settings, primaryResult: ctx.primaryResult, samples, leads }
}

async function readContext(sb: SupabaseClient, clientId: string): Promise<ClientCtx | null> {
  const client = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (client.error) return null
  const strategy = await sb.from('ad_strategy_configs')
    .select('target_cost_per_primary, primary_result')
    .eq('client_id', clientId)
    .maybeSingle()
  if (strategy.error) return null
  const plans = await sb.from('marketing_plans').select('plan_data').eq('client_id', clientId).eq('status', 'approved').limit(20)
  if (plans.error) return null
  const row = strategy.data as { target_cost_per_primary?: unknown; primary_result?: unknown } | null
  const leads = (client.data as { leads_config?: unknown } | null)?.leads_config ?? null
  return {
    settings: readBreakerSettings(leads, (plans.data ?? []) as { plan_data?: unknown }[], row),
    primaryResult: primaryOf(row?.primary_result),
  }
}

function primaryOf(value: unknown): PrimaryResultKind | null {
  if (value === 'lead' || value === 'messaging_started') return value
  return null
}

async function readNames(sb: SupabaseClient, clientId: string): Promise<Map<string, string>> {
  const { data, error } = await sb.from('ad_entity_snapshots')
    .select('entity_id, entity_name')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .order('captured_at', { ascending: false })
    .limit(200)
  const names = new Map<string, string>()
  if (error || !Array.isArray(data)) return names
  for (const row of data as { entity_id?: unknown; entity_name?: unknown }[]) {
    if (typeof row.entity_id !== 'string' || names.has(row.entity_id)) continue
    if (typeof row.entity_name === 'string' && row.entity_name.trim()) names.set(row.entity_id, row.entity_name)
  }
  return names
}

async function readSamples(
  sb: SupabaseClient,
  clientId: string,
  day: string,
  names: ReadonlyMap<string, string>,
): Promise<IntradaySampleRow[] | null> {
  const { data, error } = await sb.from('ad_intraday_spend_samples')
    .select('ad_account_id, account_day, sampled_at, local_minute, entity_id, spend_minor, currency')
    .eq('client_id', clientId)
    .eq('account_day', day)
    .eq('entity_level', 'campaign')
    .order('local_minute', { ascending: false })
    .limit(SAMPLE_CAP)
  if (error || !Array.isArray(data) || data.length >= SAMPLE_CAP) return null
  const mapped = data.map((row) => mapSample(row as Record<string, unknown>, names))
  if (mapped.some((row) => row === null)) return null
  return mapped.filter((row): row is IntradaySampleRow => row !== null)
}

function mapSample(raw: Record<string, unknown>, names: ReadonlyMap<string, string>): IntradaySampleRow | null {
  const spend = asInt(raw.spend_minor)
  const minute = asInt(raw.local_minute)
  if (spend === null || minute === null) return null
  if (typeof raw.ad_account_id !== 'string' || typeof raw.entity_id !== 'string') return null
  if (typeof raw.account_day !== 'string' || typeof raw.sampled_at !== 'string') return null
  return {
    accountId: raw.ad_account_id,
    accountDay: raw.account_day.slice(0, 10),
    sampledAt: raw.sampled_at,
    localMinute: minute,
    entityId: raw.entity_id,
    spendMinor: spend,
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    name: names.get(raw.entity_id) ?? null,
  }
}

async function readLeads(sb: SupabaseClient, clientId: string, day: string): Promise<IntradayLeadRow[] | null> {
  const bounds = nzDayBounds(day)
  if (!bounds) return null
  const { data, error } = await sb.from('contacts')
    .select('attr_campaign_id, created_at')
    .eq('client_id', clientId)
    .gte('created_at', new Date(bounds.start).toISOString())
    .lte('created_at', new Date(bounds.end).toISOString())
    .limit(LEAD_CAP)
  if (error || !Array.isArray(data) || data.length >= LEAD_CAP) return null
  return (data as { attr_campaign_id?: unknown; created_at?: unknown }[]).map((row) => ({
    campaignId: typeof row.attr_campaign_id === 'string' ? row.attr_campaign_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  }))
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}
