/**
 * Client monthly report — read-only ads block (L2).
 *
 * Sources: ad_daily_insights, ad_entity_snapshots, ad_strategy_configs, CRM,
 * flywheel_actions + flywheel_outcomes. Plain data for UI / HTML export;
 * missing pieces are reported in `gaps`, never invented.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { parseOutcomeConfigRow } from '@/lib/ads-strategy/portfolio/outcome-config'
import { CORE_METRIC_NOUN, type CoreMetric } from '@/lib/ads-strategy/rules/core-metric'
import {
  resolveAutonomousBoardState,
  type BoardViewer,
} from '@/lib/flywheel/autonomous-action-board'

export interface MonthlyAdsEntityRow {
  name: string
  spend: number
  results: number
  costPerResult: number | null
}

export interface MonthlyAdsLedgerLine {
  executedAt: string
  actionLabel: string
  entityName: string | null
  beforeText: string | null
  afterText: string | null
  observedResult: string | null
}

export interface MonthlyAdsSection {
  currency: string | null
  primaryResultLabel: string | null
  spend: number | null
  results: number | null
  costPerResult: number | null
  targetCostPerResult: number | null
  vsTarget: 'at_or_below' | 'above' | 'no_target' | 'not_comparable' | null
  qualifiedLeads: number | null
  qualifiedStagesLabel: string | null
  topAdSets: MonthlyAdsEntityRow[]
  bottomAdSets: MonthlyAdsEntityRow[]
  topCreatives: MonthlyAdsEntityRow[]
  bottomCreatives: MonthlyAdsEntityRow[]
  ledger: MonthlyAdsLedgerLine[]
  gaps: string[]
}

interface InsightRow {
  entity_id: string
  entity_name: string | null
  spend: number | null
  leads: number | null
  messaging_conversations: number | null
  insight_date: string
}

interface LedgerRow {
  id: string
  action_type: string
  executed_at: string | null
  payload: Record<string, unknown> | null
}

interface OutcomeJoin {
  action_id: string
  verdict: string | null
  delta_pct: number | null
  metric_key: string | null
}

const ACTION_LABEL_ZH: Record<string, string> = {
  'ads.pause_campaign': '暂停广告系列',
  'ads.pause_ad_set': '暂停广告组',
  'ads.pause_ad': '暂停广告',
  'ads.reactivate_campaign': '恢复广告系列',
  'ads.adjust_bid': '调整日预算',
  'ads.adjust_adset_daily_budget': '调整广告组日预算',
  'ads.add_negative_keyword': '添加否定关键词',
  'ads.create_ad': '新建广告',
}

const round2 = (n: number) => Math.round(n * 100) / 100

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function primaryCount(row: InsightRow, primary: CoreMetric | null): number {
  if (primary === 'lead') return num(row.leads)
  if (primary === 'messaging_started') return num(row.messaging_conversations)
  return 0
}

function aggregateByEntity(
  rows: InsightRow[],
  primary: CoreMetric | null,
  nameFallback: Map<string, string>,
): Map<string, { name: string; spend: number; results: number }> {
  const map = new Map<string, { name: string; spend: number; results: number }>()
  for (const row of rows) {
    const id = row.entity_id
    const name =
      (row.entity_name?.trim() || nameFallback.get(id) || '（名称未读到）')
    const cur = map.get(id) ?? { name, spend: 0, results: 0 }
    cur.spend += num(row.spend)
    cur.results += primaryCount(row, primary)
    if (!map.has(id)) cur.name = name
    map.set(id, cur)
  }
  return map
}

function rankEntities(
  map: Map<string, { name: string; spend: number; results: number }>,
  pick: 'top' | 'bottom',
  limit = 3,
): MonthlyAdsEntityRow[] {
  const eligible = [...map.values()].filter(e => e.spend > 0 && e.results > 0)
  const withCpl = eligible.map(e => ({
    name: e.name,
    spend: round2(e.spend),
    results: e.results,
    costPerResult: round2(e.spend / e.results),
  }))
  withCpl.sort((a, b) => {
    const da = a.costPerResult ?? Infinity
    const db = b.costPerResult ?? Infinity
    if (da !== db) return pick === 'top' ? da - db : db - da
    return pick === 'top' ? b.spend - a.spend : a.spend - b.spend
  })
  return withCpl.slice(0, limit)
}

function formatStatusPayload(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null
  const o = part as Record<string, unknown>
  const bits: string[] = []
  if (typeof o.name === 'string' && o.name.trim()) bits.push(o.name.trim())
  if (typeof o.status === 'string') bits.push(`状态 ${o.status}`)
  if (typeof o.daily_budget === 'string' && o.daily_budget) {
    const cents = parseInt(o.daily_budget, 10)
    if (Number.isFinite(cents)) bits.push(`日预算 ${(cents / 100).toFixed(2)}`)
  }
  return bits.length > 0 ? bits.join('，') : null
}

function entityNameFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const keys = [
    'adset_name', 'ad_name', 'campaign_name', 'entity_name', 'name',
  ] as const
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const before = payload.before
  if (before && typeof before === 'object' && typeof (before as { name?: string }).name === 'string') {
    return (before as { name: string }).name.trim()
  }
  return null
}

function formatObservedOutcome(row: OutcomeJoin | undefined): string | null {
  if (!row?.verdict) return '归因结果尚未算出'
  const pct =
    row.delta_pct != null && Number.isFinite(Number(row.delta_pct))
      ? `${Number(row.delta_pct) > 0 ? '+' : ''}${round2(Number(row.delta_pct))}%`
      : null
  switch (row.verdict) {
    case 'confirmed':
      return pct ? `观察到变化，与预期方向一致（约 ${pct}）` : '观察到变化，与预期方向一致'
    case 'reversed':
      return pct ? `观察到变化，与预期相反（约 ${pct}）` : '观察到变化，与预期相反'
    case 'inconclusive':
      return '暂时看不出明确效果'
    default:
      return `归因状态：${row.verdict}`
  }
}

async function readInsights(
  clientId: string,
  level: 'campaign' | 'adset' | 'ad',
  periodFrom: string,
  periodTo: string,
): Promise<{ rows: InsightRow[]; error: string | null }> {
  try {
    const rows = await fetchAll<InsightRow>((from, to) =>
      supabaseAdmin
        .from('ad_daily_insights')
        .select('entity_id, entity_name, spend, leads, messaging_conversations, insight_date')
        .eq('client_id', clientId)
        .eq('level', level)
        .gte('insight_date', periodFrom)
        .lte('insight_date', periodTo)
        .order('insight_date', { ascending: true })
        .order('entity_id', { ascending: true })
        .range(from, to),
    )
    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) }
  }
}

async function loadNameFallback(
  clientId: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (entityIds.length === 0) return map
  const unique = [...new Set(entityIds)]
  const chunkSize = 80
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize)
    const { data, error } = await supabaseAdmin
      .from('ad_entity_snapshots')
      .select('entity_id, entity_name, captured_at')
      .eq('client_id', clientId)
      .in('entity_id', slice)
      .order('captured_at', { ascending: false })
    if (error) continue
    for (const row of (data ?? []) as Array<{ entity_id: string; entity_name: string | null }>) {
      if (map.has(row.entity_id)) continue
      const n = row.entity_name?.trim()
      if (n) map.set(row.entity_id, n)
    }
  }
  return map
}

async function loadCurrency(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('currency, captured_at')
    .eq('client_id', clientId)
    .eq('level', 'account')
    .order('captured_at', { ascending: false })
    .limit(1)
  if (error || !data?.length) return null
  const c = (data[0] as { currency: string | null }).currency
  return typeof c === 'string' && c.trim() ? c.trim() : null
}

async function loadPrimaryAndTarget(clientId: string): Promise<{
  primary: CoreMetric | null
  target: number | null
  gaps: string[]
}> {
  const gaps: string[] = []
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('leading_result, primary_result, target_cost_per_primary, min_primary_per_unit, qualified_stage_keys')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    gaps.push('读不到广告结果设置（目标成本）')
    return { primary: null, target: null, gaps }
  }
  if (!data) {
    gaps.push('尚未配置广告主结果与目标成本')
    return { primary: null, target: null, gaps }
  }
  const cfg = parseOutcomeConfigRow(data as Record<string, unknown>)
  const primary =
    cfg.primary === 'lead' || cfg.primary === 'messaging_started' ? cfg.primary : null
  if (!primary) gaps.push('主结果未配置，无法统一计算进线成本')
  return { primary, target: cfg.targetCostPerPrimary, gaps }
}

async function loadQualifiedStagesLabel(clientId: string): Promise<{
  keys: string[]
  label: string | null
  gap: string | null
}> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('qualified_stage_keys')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    if (/qualified_stage_keys/.test(error.message)) {
      return { keys: [], label: null, gap: '数据库还没有「合格阶段」配置列' }
    }
    return { keys: [], label: null, gap: '读不到合格阶段设置' }
  }
  const raw = (data as { qualified_stage_keys?: unknown } | null)?.qualified_stage_keys
  const keys = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
  if (keys.length === 0) {
    return { keys: [], label: null, gap: '未配置哪些 CRM 阶段算「合格询盘」' }
  }
  const { data: stages } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key, label')
    .eq('client_id', clientId)
  const labelMap = new Map<string, string>()
  for (const s of (stages ?? []) as Array<{ stage_key: string; label: string | null }>) {
    if (s.label?.trim()) labelMap.set(s.stage_key, s.label.trim())
  }
  const parts = keys.map(k => labelMap.get(k) ? `${labelMap.get(k)}（${k}）` : k)
  return { keys, label: parts.join('、'), gap: null }
}

async function countQualifiedLeads(
  clientId: string,
  keys: string[],
  periodFrom: string,
  periodTo: string,
): Promise<number | { error: string }> {
  if (keys.length === 0) return 0
  try {
    const events = await fetchAll<{ contact_id: string }>((from, to) =>
      supabaseAdmin
        .from('contact_stage_events')
        .select('contact_id')
        .eq('client_id', clientId)
        .in('to_stage', keys)
        .gte('created_at', `${periodFrom}T00:00:00.000Z`)
        .lte('created_at', `${periodTo}T23:59:59.999Z`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    const fromNew = await fetchAll<{ id: string }>((from, to) =>
      supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('client_id', clientId)
        .in('stage', keys)
        .gte('created_at', `${periodFrom}T00:00:00.000Z`)
        .lte('created_at', `${periodTo}T23:59:59.999Z`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
    const ids = new Set<string>()
    for (const e of events) ids.add(e.contact_id)
    for (const c of fromNew) ids.add(c.id)
    return ids.size
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

async function loadLedger(
  clientId: string,
  periodFrom: string,
  periodTo: string,
  viewer: BoardViewer,
): Promise<{ lines: MonthlyAdsLedgerLine[]; gap: string | null }> {
  try {
    const rows = await fetchAll<LedgerRow>((from, to) =>
      supabaseAdmin
        .from('flywheel_actions')
        .select('id, action_type, executed_at, payload')
        .eq('client_id', clientId)
        .eq('flywheel', 'ads')
        .neq('action_type', 'ads.meta_snapshot')
        .gte('executed_at', `${periodFrom}T00:00:00.000Z`)
        .lte('executed_at', `${periodTo}T23:59:59.999Z`)
        .order('executed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    )
    const visible = rows.filter(r => {
      const status = r.payload?.status
      return resolveAutonomousBoardState(status, viewer) !== null
    })
    const actionIds = visible.map(r => r.id)
    const outcomes = new Map<string, OutcomeJoin>()
    if (actionIds.length > 0) {
      const chunk = 100
      for (let i = 0; i < actionIds.length; i += chunk) {
        const slice = actionIds.slice(i, i + chunk)
        const { data, error } = await supabaseAdmin
          .from('flywheel_outcomes')
          .select('action_id, verdict, delta_pct, metric_key')
          .eq('client_id', clientId)
          .in('action_id', slice)
        if (error) continue
        for (const o of (data ?? []) as OutcomeJoin[]) {
          const prev = outcomes.get(o.action_id)
          if (!prev || (o.verdict === 'confirmed' && prev.verdict !== 'confirmed')) {
            outcomes.set(o.action_id, o)
          }
        }
      }
    }
    const lines: MonthlyAdsLedgerLine[] = visible.map(r => ({
      executedAt: r.executed_at ?? '',
      actionLabel: ACTION_LABEL_ZH[r.action_type] ?? '广告调整',
      entityName: entityNameFromPayload(r.payload),
      beforeText: formatStatusPayload(r.payload?.before),
      afterText: formatStatusPayload(r.payload?.after),
      observedResult: formatObservedOutcome(outcomes.get(r.id)),
    }))
    return { lines, gap: null }
  } catch (e) {
    return { lines: [], gap: e instanceof Error ? e.message : String(e) }
  }
}

export async function collectMonthlyAdsSection(
  clientId: string,
  periodFrom: string,
  periodTo: string,
  options?: { ledgerViewer?: BoardViewer },
): Promise<MonthlyAdsSection> {
  const gaps: string[] = []
  const viewer: BoardViewer = options?.ledgerViewer ?? 'client'

  const [{ primary, target, gaps: cfgGaps }, currency] = await Promise.all([
    loadPrimaryAndTarget(clientId),
    loadCurrency(clientId),
  ])
  gaps.push(...cfgGaps)

  const primaryResultLabel = primary ? CORE_METRIC_NOUN[primary] : null

  const campaignRead = await readInsights(clientId, 'campaign', periodFrom, periodTo)
  if (campaignRead.error) gaps.push('本月广告花费与进线数据读失败')
  const campaignRows = campaignRead.rows

  let spend: number | null = null
  let results: number | null = null
  let costPerResult: number | null = null
  if (campaignRead.error) {
    spend = null
    results = null
  } else if (campaignRows.length === 0) {
    gaps.push('本月没有读到广告投放日数据')
    spend = null
    results = null
  } else if (!primary) {
    spend = round2(campaignRows.reduce((s, r) => s + num(r.spend), 0))
    results = null
    costPerResult = null
  } else {
    spend = round2(campaignRows.reduce((s, r) => s + num(r.spend), 0))
    results = campaignRows.reduce((s, r) => s + primaryCount(r, primary), 0)
    costPerResult = results > 0 && spend != null ? round2(spend / results) : null
  }

  let vsTarget: MonthlyAdsSection['vsTarget'] = null
  if (target == null) vsTarget = 'no_target'
  else if (costPerResult == null) vsTarget = 'not_comparable'
  else vsTarget = costPerResult <= target ? 'at_or_below' : 'above'

  const qualifiedMeta = await loadQualifiedStagesLabel(clientId)
  if (qualifiedMeta.gap) gaps.push(qualifiedMeta.gap)

  let qualifiedLeads: number | null = null
  if (qualifiedMeta.keys.length > 0) {
    const counted = await countQualifiedLeads(clientId, qualifiedMeta.keys, periodFrom, periodTo)
    if (typeof counted === 'number') qualifiedLeads = counted
    else gaps.push('合格询盘人数读失败')
  }

  const entityIds: string[] = []
  const [adsetRead, adRead] = await Promise.all([
    readInsights(clientId, 'adset', periodFrom, periodTo),
    readInsights(clientId, 'ad', periodFrom, periodTo),
  ])
  if (adsetRead.error) gaps.push('广告组明细读失败')
  if (adRead.error) gaps.push('广告素材明细读失败')
  for (const r of [...adsetRead.rows, ...adRead.rows]) entityIds.push(r.entity_id)
  const nameFallback = await loadNameFallback(clientId, entityIds)

  const adsetMap = aggregateByEntity(adsetRead.rows, primary, nameFallback)
  const adMap = aggregateByEntity(adRead.rows, primary, nameFallback)

  const ledgerLoad = await loadLedger(clientId, periodFrom, periodTo, viewer)
  if (ledgerLoad.gap) gaps.push('本月广告操作记录读失败')

  return {
    currency,
    primaryResultLabel,
    spend,
    results,
    costPerResult,
    targetCostPerResult: target,
    vsTarget,
    qualifiedLeads,
    qualifiedStagesLabel: qualifiedMeta.label,
    topAdSets: adsetRead.error ? [] : rankEntities(adsetMap, 'top'),
    bottomAdSets: adsetRead.error ? [] : rankEntities(adsetMap, 'bottom'),
    topCreatives: adRead.error ? [] : rankEntities(adMap, 'top'),
    bottomCreatives: adRead.error ? [] : rankEntities(adMap, 'bottom'),
    ledger: ledgerLoad.lines,
    gaps: [...new Set(gaps)],
  }
}
