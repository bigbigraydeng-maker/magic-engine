/**
 * Read the facts for a scale-back card. A short or failed read is unreadable.
 * This file does not call Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { agreedPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { accountDayKey } from '@/lib/ads-strategy/account-timezone'
import { previousDay } from '@/lib/ads-strategy/circuit-breaker/rules'
import { resolveTargetCplCents } from '@/lib/ads-strategy/client-target-cpl'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS } from '@/lib/ads-strategy/portfolio/diagnostics/thresholds'
import { hasPromoField, readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import type { ChainStep } from './chain'
import type { FallbackCampaign, FallbackDay, FallbackInput } from './rules'

const SNAP_LIMIT = 500
const ROW_LIMIT = 200
const HOUR_MS = 3_600_000

interface Snap {
  ad_account_id: string
  level: string
  entity_id: string
  campaign_id: string | null
  effective_status: string | null
  daily_budget_minor: number | string | null
  captured_at: string
  timezone_name: string | null
  currency: string | null
}

export async function loadScaleFallback(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<FallbackInput | 'unreadable'> {
  const client = await clientOf(sb, clientId)
  if (client === 'unreadable') return 'unreadable'
  const accountId = text(client?.meta_ad_account_id)
  if (!accountId) return empty()
  const snaps = await snapsOf(sb, clientId)
  if (snaps === 'unreadable') return 'unreadable'
  const clock = clockOf(snaps.rows, accountId, now)
  if (!clock) return empty()
  const plans = await list(sb, 'marketing_plans', 'status, plan_data', clientId, { status: 'approved' })
  const strategy = await one(sb, 'ad_strategy_configs', 'target_cost_per_primary', clientId)
  const actions = await actionsOf(sb, clientId)
  const insights = await insightsOf(sb, clientId, accountId, clock.yesterday, clock.dayBefore)
  const fresh = await freshCapture(sb, clientId, accountId, now)
  if (plans === 'unreadable' || strategy === 'unreadable' || actions === 'unreadable' || insights === 'unreadable' || fresh === 'unreadable') {
    return 'unreadable'
  }
  return assemble(client?.leads_config, strategy, plans, snaps, actions, insights, fresh, clock, accountId)
}

function assemble(
  leads: unknown,
  strategy: Record<string, unknown> | null,
  plans: Record<string, unknown>[],
  snaps: { rows: Snap[]; truncated: boolean },
  actions: { steps: ChainStep[]; truncated: boolean },
  insights: { days: FallbackInput['days']; truncated: boolean },
  fresh: boolean,
  clock: { yesterday: string; dayBefore: string },
  accountId: string,
): FallbackInput {
  const latest = latestSnaps(snaps.rows.filter((row) => row.ad_account_id === accountId))
  const cap = agreedPlanDailyTotalCap(plans)
  return {
    stage: stageOf(plans),
    targetCents: resolveTargetCplCents({
      strategyMajor: strategy?.target_cost_per_primary,
      leadsConfig: leads,
      planRows: plans,
    }),
    capCents: cap.state === 'set' ? cap.cents : null,
    fresh,
    timezoneKnown: true,
    truncated: snaps.truncated || actions.truncated || insights.truncated || cap.state === 'unreadable' || latest === null,
    yesterday: clock.yesterday,
    dayBefore: clock.dayBefore,
    currency: currencyOf(latest ?? []),
    adsets: adsetsOf(latest ?? []),
    campaigns: campaignsOf(latest ?? []),
    days: insights.days,
    actions: actions.steps,
  }
}

function stageOf(plans: readonly Record<string, unknown>[]): FallbackInput['stage'] {
  const marked: string[] = []
  for (const plan of plans) {
    if (!hasPromoField(plan.plan_data)) continue
    const spec = readPromoSpec(plan.plan_data)
    if (!spec?.delivery) return 'unreadable'
    marked.push(spec.delivery.stage)
  }
  if (marked.length === 0 || new Set(marked).size !== 1) return marked.length === 0 ? 'other' : 'unreadable'
  return marked[0] === 'scale' ? 'scale' : 'other'
}

function clockOf(rows: readonly Snap[], accountId: string, now: Date): { yesterday: string; dayBefore: string } | null {
  const zone = latestSnaps(rows)?.find((row) => row.level === 'account' && row.ad_account_id === accountId)?.timezone_name
  if (!zone) return null
  try {
    const today = accountDayKey(zone, now)
    const yesterday = previousDay(today)
    return { yesterday, dayBefore: previousDay(yesterday) }
  } catch {
    return null
  }
}

function adsetsOf(rows: readonly Snap[]): FallbackInput['adsets'] {
  return rows.filter((row) => row.level === 'adset').map((row) => ({
    adsetId: row.entity_id,
    campaignId: row.campaign_id,
    delivering: DELIVERING_STATUSES.has(row.effective_status ?? ''),
    dailyBudgetCents: cents(row.daily_budget_minor),
  }))
}

function campaignsOf(rows: readonly Snap[]): FallbackCampaign[] {
  return rows.filter((row) => row.level === 'campaign').map((row) => ({
    id: row.entity_id,
    delivering: DELIVERING_STATUSES.has(row.effective_status ?? ''),
    dailyBudgetCents: cents(row.daily_budget_minor),
  }))
}

function latestSnaps(rows: readonly Snap[]): Snap[] | null {
  const groups = new Map<string, Snap[]>()
  for (const row of rows) {
    const key = `${row.level}:${row.entity_id}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const out: Snap[] = []
  for (const list of groups.values()) {
    const newest = list.map((row) => row.captured_at).sort().at(-1)
    const ties = list.filter((row) => row.captured_at === newest)
    const first = ties[0]
    if (!first || ties.some((row) => row.daily_budget_minor !== first.daily_budget_minor || row.effective_status !== first.effective_status)) {
      return null
    }
    out.push(first)
  }
  return out
}

function currencyOf(rows: readonly Snap[]): string | null {
  const code = rows.find((row) => row.level === 'account')?.currency ?? null
  return code && /^[A-Z]{3}$/.test(code) ? code : null
}

async function freshCapture(sb: SupabaseClient, clientId: string, accountId: string, now: Date): Promise<boolean | 'unreadable'> {
  const { data, error } = await sb.from('ad_snapshot_captures')
    .select('complete, captured_at, skipped_shared')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .eq('level', 'ad')
    .order('captured_at', { ascending: false })
    .limit(ROW_LIMIT)
  if (error) return 'unreadable'
  const row = (data as Array<{ complete?: boolean; captured_at?: string; skipped_shared?: boolean }> | null)?.find((item) => (
    item.complete === true && item.skipped_shared !== true && typeof item.captured_at === 'string'
  ))
  if (!row?.captured_at) return false
  const age = now.getTime() - Date.parse(row.captured_at)
  return Number.isFinite(age) && age >= 0 && age <= OWNERSHIP_MAX_AD_CAPTURE_AGE_HOURS * HOUR_MS
}

async function snapsOf(sb: SupabaseClient, clientId: string): Promise<{ rows: Snap[]; truncated: boolean } | 'unreadable'> {
  const { data, error } = await sb.from('ad_entity_snapshots')
    .select('ad_account_id, level, entity_id, campaign_id, effective_status, daily_budget_minor, captured_at, timezone_name, currency')
    .eq('client_id', clientId)
    .in('level', ['account', 'campaign', 'adset'])
    .order('captured_at', { ascending: false })
    .limit(SNAP_LIMIT)
  if (error) return 'unreadable'
  const rows = (data ?? []) as Snap[]
  return { rows, truncated: rows.length >= SNAP_LIMIT }
}

async function insightsOf(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  yesterday: string,
  dayBefore: string,
): Promise<{ days: FallbackInput['days']; truncated: boolean } | 'unreadable'> {
  const { data, error } = await sb.from('ad_daily_insights')
    .select('entity_id, insight_date, spend, leads')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .eq('level', 'adset')
    .in('insight_date', [yesterday, dayBefore])
    .limit(ROW_LIMIT)
  if (error) return 'unreadable'
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return { days: daysOf(rows, yesterday, dayBefore), truncated: rows.length >= ROW_LIMIT }
}

function daysOf(rows: readonly Record<string, unknown>[], yesterday: string, dayBefore: string): FallbackInput['days'] {
  const out: Record<string, { yesterday?: FallbackDay; dayBefore?: FallbackDay }> = {}
  for (const row of rows) {
    const id = text(row.entity_id)
    const day = text(row.insight_date)?.slice(0, 10)
    if (!id || (day !== yesterday && day !== dayBefore)) continue
    const slot = day === yesterday ? 'yesterday' : 'dayBefore'
    const current = out[id] ?? {}
    if (current[slot]) {
      current[slot] = { spendCents: null, leads: null }
    } else {
      current[slot] = { spendCents: spendCents(row.spend), leads: leadCount(row.leads) }
    }
    out[id] = current
  }
  return out
}

async function actionsOf(sb: SupabaseClient, clientId: string): Promise<{ steps: ChainStep[]; truncated: boolean } | 'unreadable'> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('payload, executed_at')
    .eq('client_id', clientId)
    .eq('action_type', 'ads.adjust_adset_daily_budget')
    .limit(ROW_LIMIT)
  if (error) return 'unreadable'
  const rows = (data ?? []) as Array<{ payload?: unknown; executed_at?: string | null }>
  const steps = rows.map(stepOf)
  if (steps.some((step) => step === 'bad')) return 'unreadable'
  return { steps: steps.flatMap((step) => (step === 'bad' ? [] : step)), truncated: rows.length >= ROW_LIMIT }
}

function stepOf(row: { payload?: unknown; executed_at?: string | null }): ChainStep[] | 'bad' {
  if (!row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as {
    kind?: unknown
    status?: unknown
    wroteMeta?: unknown
    beforeCents?: unknown
    afterCents?: unknown
    order?: { adsetId?: unknown }
  }
  if (payload.kind !== 'adset_daily_budget') return []
  const adsetId = text(payload.order?.adsetId)
  const before = cents(payload.beforeCents)
  const after = cents(payload.afterCents)
  if (!adsetId || before === null || after === null || typeof payload.status !== 'string') return 'bad'
  return [{
    adsetId,
    beforeCents: before,
    afterCents: after,
    executedAt: typeof row.executed_at === 'string' ? row.executed_at : '',
    wroteMeta: payload.wroteMeta === true,
    status: payload.status,
  }]
}

async function clientOf(sb: SupabaseClient, clientId: string): Promise<Record<string, unknown> | null | 'unreadable'> {
  const { data, error } = await sb.from('clients').select('leads_config, meta_ad_account_id').eq('id', clientId).maybeSingle()
  if (error) return 'unreadable'
  return (data as Record<string, unknown> | null) ?? null
}

async function one(sb: SupabaseClient, table: string, columns: string, clientId: string): Promise<Record<string, unknown> | null | 'unreadable'> {
  const { data, error } = await sb.from(table).select(columns).eq('client_id', clientId).maybeSingle()
  if (error) return 'unreadable'
  return (data as Record<string, unknown> | null) ?? null
}

async function list(
  sb: SupabaseClient,
  table: string,
  columns: string,
  clientId: string,
  extra: { status: string },
): Promise<Record<string, unknown>[] | 'unreadable'> {
  const { data, error } = await sb.from(table).select(columns).eq('client_id', clientId).eq('status', extra.status).limit(ROW_LIMIT)
  if (error) return 'unreadable'
  const rows = (data ?? []) as Record<string, unknown>[]
  return rows.length >= ROW_LIMIT ? 'unreadable' : rows
}

function empty(): FallbackInput {
  return {
    stage: 'other', targetCents: null, capCents: null, fresh: false, timezoneKnown: false,
    truncated: false, yesterday: null, dayBefore: null, currency: null, adsets: [], campaigns: [], days: {}, actions: [],
  }
}

function spendCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(amount) || amount < 0) return null
  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

function leadCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function cents(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return cents(Number(value))
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
