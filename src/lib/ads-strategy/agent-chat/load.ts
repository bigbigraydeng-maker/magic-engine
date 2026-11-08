/**
 * Read-only loaders for ads agent investigation (synced tables only).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientAdAccounts } from '@/lib/meta/client-ad-accounts'
import { loadOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-config'
import { mergeFreshness, emptyFreshness, type DataFreshness } from './evidence'
import { opaqueAccountRef, opaqueEntityRef, type EntityLevel } from './refs'
import type { InsightSlice } from './aggregate'
import type { SnapshotLite } from './delivery'

const PAGE = 1000
const LEVELS: EntityLevel[] = ['campaign', 'adset', 'ad']

export interface AccountCatalogEntry {
  ref: string
  label: string | null
}

export interface EntityCatalogEntry {
  ref: string
  level: EntityLevel
  name: string | null
  account_ref: string
}

export interface InvestigationDataContext {
  accounts: AccountCatalogEntry[]
  accountIdByRef: Map<string, string>
  entityByRef: Map<string, { accountRef: string; entityId: string; level: EntityLevel; name: string | null }>
  outcomePrimary: import('@/lib/ads-strategy/portfolio/outcome-ladder').OutcomeStep | null
  freshness: DataFreshness
  couldNotRead: string[]
}

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function parseActions(v: unknown): InsightSlice['actions'] {
  if (!Array.isArray(v)) return null
  const out: Array<{ action_type: string; value: string }> = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const row = item as { action_type?: unknown; value?: unknown }
    if (typeof row.action_type !== 'string') continue
    out.push({ action_type: row.action_type, value: String(row.value ?? '0') })
  }
  return out.length > 0 ? out : null
}

export async function buildInvestigationContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<InvestigationDataContext> {
  const couldNotRead: string[] = []
  const accountsRaw = await getClientAdAccounts(clientId)
  const accounts: AccountCatalogEntry[] = accountsRaw.map((a, i) => ({
    ref: opaqueAccountRef(a.adAccountId, i + 1),
    label: a.label ?? (a.isPrimary ? 'primary' : null),
  }))
  const accountIdByRef = new Map(accounts.map((a, i) => [a.ref, accountsRaw[i].adAccountId]))

  let freshness = emptyFreshness()

  for (let i = 0; i < accountsRaw.length; i++) {
    const adAccountId = accountsRaw[i].adAccountId
    const [insightMax, snapMax] = await Promise.all([
      supabase.from('ad_daily_insights')
        .select('insight_date')
        .eq('client_id', clientId)
        .eq('ad_account_id', adAccountId)
        .order('insight_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('ad_entity_snapshots')
        .select('captured_at')
        .eq('client_id', clientId)
        .eq('ad_account_id', adAccountId)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (insightMax.error) {
      couldNotRead.push(`账户索引 ${i + 1}：日指标最后同步日读失败（${insightMax.error.message}）`)
    } else {
      const d = (insightMax.data as { insight_date?: string } | null)?.insight_date ?? null
      freshness = mergeFreshness(freshness, { last_insight_date: d, last_snapshot_captured_at: null })
    }
    if (snapMax.error) {
      couldNotRead.push(`账户索引 ${i + 1}：实体快照新鲜度读失败（${snapMax.error.message}）`)
    } else {
      const c = (snapMax.data as { captured_at?: string } | null)?.captured_at ?? null
      freshness = mergeFreshness(freshness, { last_insight_date: null, last_snapshot_captured_at: c })
    }
  }

  const entityByRef = new Map<string, { accountRef: string; entityId: string; level: EntityLevel; name: string | null }>()

  for (let i = 0; i < accountsRaw.length; i++) {
    const adAccountId = accountsRaw[i].adAccountId
    const accountRef = accounts[i].ref
    try {
      const rows = await readAll<{
        level: string
        entity_id: string
        entity_name: string | null
        effective_status: string | null
        status: string | null
        learning_stage: string | null
        captured_at: string
      }>((from, to) =>
        supabase.from('ad_entity_snapshots')
          .select('level, entity_id, entity_name, effective_status, status, learning_stage, captured_at')
          .eq('client_id', clientId)
          .eq('ad_account_id', adAccountId)
          .in('level', LEVELS)
          .order('captured_at', { ascending: false })
          .order('entity_id', { ascending: true })
          .range(from, to),
      )

      const latest = new Map<string, typeof rows[0]>()
      for (const r of rows) {
        if (!LEVELS.includes(r.level as EntityLevel)) continue
        const key = `${r.level}:${r.entity_id}`
        if (!latest.has(key)) latest.set(key, r)
      }

      for (const r of latest.values()) {
        const level = r.level as EntityLevel
        const ref = opaqueEntityRef(level, r.entity_id)
        entityByRef.set(ref, {
          accountRef,
          entityId: r.entity_id,
          level,
          name: r.entity_name,
        })
      }
    } catch (e) {
      couldNotRead.push(`账户索引 ${i + 1}：实体快照读失败（${e instanceof Error ? e.message : String(e)}）`)
    }
  }

  const outcome = await loadOutcomeConfig(clientId)
  if (outcome.source === 'read_error') {
    couldNotRead.push(`客户主结果配置读失败（${outcome.error ?? 'unknown'}）`)
  }

  return {
    accounts,
    accountIdByRef,
    entityByRef,
    outcomePrimary: outcome.config.primary ?? outcome.config.leading ?? null,
    freshness,
    couldNotRead,
  }
}

export function matchEntities(
  ctx: InvestigationDataContext,
  opts: { level?: EntityLevel; name_contains?: string; entity_ref?: string },
): EntityCatalogEntry[] {
  if (opts.entity_ref) {
    const hit = ctx.entityByRef.get(opts.entity_ref)
    if (!hit) return []
    return [{
      ref: opts.entity_ref,
      level: hit.level,
      name: hit.name,
      account_ref: hit.accountRef,
    }]
  }

  const needle = opts.name_contains?.trim().toLowerCase()
  const level = opts.level
  const out: EntityCatalogEntry[] = []
  for (const [ref, e] of ctx.entityByRef) {
    if (level && e.level !== level) continue
    if (needle && !(e.name ?? '').toLowerCase().includes(needle)) continue
    out.push({ ref, level: e.level, name: e.name, account_ref: e.accountRef })
  }
  out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  return out.slice(0, 25)
}

export async function loadInsightSlices(
  supabase: SupabaseClient,
  clientId: string,
  accountId: string,
  entityId: string,
  level: EntityLevel,
  start: string,
  end: string,
): Promise<{ rows: InsightSlice[]; couldNotRead: string[] }> {
  const couldNotRead: string[] = []
  try {
    const raw = await readAll<Record<string, unknown>>((from, to) =>
      supabase.from('ad_daily_insights')
        .select(
          'level, entity_id, entity_name, insight_date, spend, impressions, clicks, leads, '
          + 'messaging_conversations, reach, video_thruplays, video_3s_views, frequency, frequency_7d, actions',
        )
        .eq('client_id', clientId)
        .eq('ad_account_id', accountId)
        .eq('level', level)
        .eq('entity_id', entityId)
        .gte('insight_date', start)
        .lte('insight_date', end)
        .order('insight_date', { ascending: true })
        .range(from, to),
    )

    const byDay = new Map<string, InsightSlice>()
    for (const r of raw) {
      const date = String(r.insight_date)
      byDay.set(date, {
        level,
        entity_id: String(r.entity_id),
        entity_name: (r.entity_name as string | null) ?? null,
        insight_date: date,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        leads: num(r.leads),
        messaging_conversations: num(r.messaging_conversations),
        reach: r.reach === null || r.reach === undefined ? null : num(r.reach),
        video_thruplays: r.video_thruplays === null || r.video_thruplays === undefined ? null : num(r.video_thruplays),
        video_3s_views: r.video_3s_views === null || r.video_3s_views === undefined ? null : num(r.video_3s_views),
        frequency: r.frequency === null || r.frequency === undefined ? null : num(r.frequency),
        frequency_7d: r.frequency_7d === null || r.frequency_7d === undefined ? null : num(r.frequency_7d),
        actions: parseActions(r.actions),
      })
    }
    return { rows: Array.from(byDay.values()), couldNotRead }
  } catch (e) {
    couldNotRead.push(`日指标读失败：${e instanceof Error ? e.message : String(e)}`)
    return { rows: [], couldNotRead }
  }
}

export async function loadLatestSnapshotsForDelivery(
  supabase: SupabaseClient,
  clientId: string,
  accountId: string,
  level?: EntityLevel,
  nameContains?: string,
): Promise<{ snaps: SnapshotLite[]; couldNotRead: string[] }> {
  const couldNotRead: string[] = []
  const levels = level ? [level] : LEVELS
  try {
    const raw = await readAll<Record<string, unknown>>((from, to) =>
      supabase.from('ad_entity_snapshots')
        .select('level, entity_id, entity_name, effective_status, status, learning_stage, captured_at')
        .eq('client_id', clientId)
        .eq('ad_account_id', accountId)
        .in('level', levels)
        .order('captured_at', { ascending: false })
        .order('entity_id', { ascending: true })
        .range(from, to),
    )
    const needle = nameContains?.trim().toLowerCase()
    const latest = new Map<string, SnapshotLite>()
    for (const r of raw) {
      const lvl = r.level as string
      if (!LEVELS.includes(lvl as EntityLevel)) continue
      const name = (r.entity_name as string | null) ?? null
      if (needle && !(name ?? '').toLowerCase().includes(needle)) continue
      const key = `${lvl}:${r.entity_id}`
      if (!latest.has(key)) {
        latest.set(key, {
          level: lvl as EntityLevel,
          entity_id: String(r.entity_id),
          entity_name: name,
          effective_status: (r.effective_status as string | null) ?? null,
          status: (r.status as string | null) ?? null,
          learning_stage: (r.learning_stage as string | null) ?? null,
        })
      }
    }
    return { snaps: Array.from(latest.values()), couldNotRead }
  } catch (e) {
    couldNotRead.push(`投放状态快照读失败：${e instanceof Error ? e.message : String(e)}`)
    return { snaps: [], couldNotRead }
  }
}
