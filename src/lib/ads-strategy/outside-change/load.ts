/**
 * Reads stored snapshots and ME action rows for the ads-health outside-change tag.
 * Database only. Never calls Meta and never writes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  detectOutsideChanges,
  idsInRecord,
  MATCH_BEFORE_MS,
  OUTSIDE_LOOKBACK_DAYS,
  type ActionFact,
  type OutsideChange,
  type SnapshotFact,
} from './detect'

const PAGE_SIZE = 1000
const LEVELS = ['campaign', 'adset', 'ad']
const ACTION_KEYS = [
  'ads.scale_unit_budget',
  'ads.cut_unit_budget',
  'ads.cut_campaign_budget',
  'ads.adjust_bid',
  'ads.budget_move_plan',
  'ads.create_ad',
  'ads.add_retargeting_adset',
  'ads.swap_creative',
]
const SNAP_COLS = 'level, entity_id, entity_name, campaign_id, adset_id, settings_hash, daily_budget_minor, lifetime_budget_minor, currency, captured_at'

interface RawSnap {
  level: string
  entity_id: string
  entity_name: string | null
  campaign_id: string | null
  adset_id: string | null
  settings_hash: string | null
  daily_budget_minor: number | string | null
  lifetime_budget_minor: number | string | null
  currency: string | null
  captured_at: string
}

interface RawFly {
  action_type: string
  payload: unknown
  executed_at: string
}

interface RawRun {
  action_key: string
  input: unknown
  status: string | null
  created_at: string
  finished_at: string | null
}

function minor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function toSnapshot(row: RawSnap): SnapshotFact | null {
  if (row.level !== 'campaign' && row.level !== 'adset' && row.level !== 'ad') return null
  if (!row.settings_hash || !row.entity_id || !row.captured_at) return null
  return {
    level: row.level,
    entityId: row.entity_id,
    entityName: row.entity_name,
    campaignId: row.campaign_id,
    adsetId: row.adset_id,
    settingsHash: row.settings_hash,
    dailyBudgetMinor: minor(row.daily_budget_minor),
    lifetimeBudgetMinor: minor(row.lifetime_budget_minor),
    currency: row.currency,
    capturedAt: row.captured_at,
  }
}

function statusOf(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const status = (payload as { status?: unknown }).status
  return typeof status === 'string' && status ? status : null
}

function toFlywheel(row: RawFly): ActionFact {
  return { key: row.action_type, occurredAt: row.executed_at, ids: idsInRecord(row.payload), status: statusOf(row.payload) }
}

function toRun(row: RawRun): ActionFact {
  return { key: row.action_key, occurredAt: row.finished_at ?? row.created_at, ids: idsInRecord(row.input), status: row.status }
}

async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

export async function loadOutsideChanges(
  clientId: string,
  supabase: SupabaseClient,
  now = new Date(),
): Promise<OutsideChange[]> {
  const since = new Date(now.getTime() - OUTSIDE_LOOKBACK_DAYS * 86_400_000).toISOString()
  const actionSince = new Date(Date.parse(since) - MATCH_BEFORE_MS).toISOString()
  const snapshots = await pageAll<RawSnap>((from, to) =>
    supabase.from('ad_entity_snapshots').select(SNAP_COLS)
      .eq('client_id', clientId).eq('platform', 'meta').in('level', LEVELS)
      .gte('captured_at', since).order('captured_at', { ascending: true }).range(from, to),
  )
  const flywheel = await pageAll<RawFly>((from, to) =>
    supabase.from('flywheel_actions').select('action_type, payload, executed_at')
      .eq('client_id', clientId).eq('flywheel', 'ads').in('action_type', ACTION_KEYS)
      .gte('executed_at', actionSince).order('executed_at', { ascending: true }).range(from, to),
  )
  const runs = await pageAll<RawRun>((from, to) =>
    supabase.from('action_runs').select('action_key, input, status, created_at, finished_at')
      .eq('client_id', clientId).in('action_key', ACTION_KEYS)
      .gte('created_at', actionSince).order('created_at', { ascending: true }).range(from, to),
  )
  const facts = snapshots.map(toSnapshot).filter((row): row is SnapshotFact => row !== null)
  return detectOutsideChanges(facts, [...flywheel.map(toFlywheel), ...runs.map(toRun)])
}
