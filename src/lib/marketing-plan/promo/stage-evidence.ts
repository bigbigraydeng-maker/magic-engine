import type { SupabaseClient } from '@supabase/supabase-js'
import type { MarketingPlan } from '../types'
import type { WatchFinding } from './daily-watch'
import { audienceLadder, type LadderView, type QualifiedSeed, type QuotedSeed } from './audience-ladder'
import { ratioWarning, STAGE_GOAL, STAGE_LABEL } from './delivery-stage'
import { DEFAULT_PROMO_PLAYBOOK } from './playbooks'
import { buildScaleDraft, judgeSwitch, shiftDate, type CaptureState, type SwitchEvidence, type SwitchVerdict } from './stage-switch'
import { allAdsSteps, readPromoSpec, type PromoSpec } from './spec'

const QUOTED = '已报价'
const LEVELS = ['campaign', 'adset'] as const

export interface DeliveryView {
  stage_label: string
  goal: string
  ratio_text: string
  switch_text: string
  can_propose: boolean
  draft_note: string | null
  ladder_note: string
  rungs: LadderView['rungs']
}

interface CaptureRow { complete?: unknown; captured_at?: unknown }

function captureState(rows: Array<CaptureRow | null | undefined>, now: Date, maxAgeMs: number): CaptureState {
  if (rows.some(row => row === undefined)) return 'unreadable'
  if (rows.some(row => row === null)) return 'missing'
  for (const row of rows) {
    if (!row || typeof row.complete !== 'boolean' || typeof row.captured_at !== 'string') return 'unreadable'
    if (!row.complete) return 'incomplete'
    const at = Date.parse(row.captured_at)
    if (!Number.isFinite(at) || now.getTime() - at > maxAgeMs || at > now.getTime()) return 'stale'
  }
  return 'fresh'
}

async function latestCapture(
  supabase: SupabaseClient, clientId: string, accountId: string, level: string,
): Promise<CaptureRow | null | undefined> {
  const { data, error } = await supabase.from('ad_snapshot_captures')
    .select('complete, captured_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .eq('level', level)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return undefined
  return (data as CaptureRow | null) ?? null
}

async function readCaptures(supabase: SupabaseClient, clientId: string, accountIds: string[], now: Date): Promise<CaptureState> {
  const maxAgeMs = DEFAULT_PROMO_PLAYBOOK.factFreshnessDays * 86_400_000
  const rows: Array<CaptureRow | null | undefined> = []
  for (const accountId of accountIds) {
    for (const level of LEVELS) rows.push(await latestCapture(supabase, clientId, accountId, level))
  }
  return captureState(rows, now, maxAgeMs)
}

interface InsightRow { insight_date?: unknown; spend?: unknown; leads?: unknown }

function insightTotals(rows: InsightRow[] | null, from: string, to: string): { leads: number; spend: number; dates: number } | null {
  if (!rows) return null
  const byDate = new Map<string, { leads: number; spend: number }>()
  for (const row of rows) {
    if (typeof row.insight_date !== 'string' || row.insight_date < from || row.insight_date > to) continue
    if (row.spend === null || row.spend === undefined || row.leads === null || row.leads === undefined) return null
    const spend = typeof row.spend === 'number' ? row.spend : Number(row.spend)
    const leads = typeof row.leads === 'number' ? row.leads : Number(row.leads)
    if (!Number.isFinite(spend) || !Number.isFinite(leads) || leads < 0 || spend < 0) return null
    const cur = byDate.get(row.insight_date) ?? { leads: 0, spend: 0 }
    cur.leads += leads
    cur.spend += spend
    byDate.set(row.insight_date, cur)
  }
  let leads = 0
  let spend = 0
  for (const value of byDate.values()) { leads += value.leads; spend += value.spend }
  return { leads, spend, dates: byDate.size }
}

async function readInsights(
  supabase: SupabaseClient, clientId: string, accountIds: string[], from: string, to: string,
): Promise<{ leads: number; spend: number; dates: number } | null> {
  const { data, error } = await supabase.from('ad_daily_insights')
    .select('insight_date, spend, leads')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .in('ad_account_id', accountIds)
    .gte('insight_date', from)
    .lte('insight_date', to)
    .limit(2000)
  if (error) return null
  const rows = (data ?? []) as InsightRow[]
  if (rows.length >= 2000) return null
  return insightTotals(rows, from, to)
}

async function readTarget(supabase: SupabaseClient, clientId: string): Promise<number | null | undefined> {
  const { data, error } = await supabase.from('ad_strategy_configs')
    .select('target_cost_per_primary')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) return undefined
  const raw = (data as { target_cost_per_primary?: unknown } | null)?.target_cost_per_primary
  if (raw === null || raw === undefined) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

async function readCurrency(supabase: SupabaseClient, accountIds: string[]): Promise<string | null | undefined> {
  const codes = new Set<string>()
  for (const accountId of accountIds) {
    const { data, error } = await supabase.from('ad_entity_snapshots')
      .select('currency')
      .eq('ad_account_id', accountId)
      .eq('level', 'account')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return undefined
    const code = (data as { currency?: unknown } | null)?.currency
    if (typeof code !== 'string' || code.trim() === '') return accountIds.length === 1 ? null : undefined
    codes.add(code.trim().toUpperCase())
  }
  if (codes.size !== 1 && accountIds.length > 1) return undefined
  return [...codes][0] ?? null
}

function countriesOf(spec: PromoSpec): string[] {
  const set = new Set<string>()
  for (const row of allAdsSteps(spec)) {
    for (const code of row.step.settings.targeting?.countries ?? []) set.add(code)
  }
  return [...set]
}

async function readLadderFacts(
  supabase: SupabaseClient, clientId: string,
): Promise<{ qualified: QualifiedSeed; quoted: QuotedSeed }> {
  const stages = await supabase.from('client_pipeline_stages').select('stage_key, label').eq('client_id', clientId).limit(100)
  const config = await supabase.from('ad_strategy_configs').select('qualified_stage_keys').eq('client_id', clientId).maybeSingle()
  if (stages.error || config.error) return { qualified: 'unreadable', quoted: 'unreadable' }
  const stageRows = (stages.data ?? []) as { stage_key?: unknown; label?: unknown }[]
  if (stageRows.length >= 100) return { qualified: 'unreadable', quoted: 'unreadable' }
  const keysRaw = (config.data as { qualified_stage_keys?: unknown } | null)?.qualified_stage_keys
  const keys = Array.isArray(keysRaw) ? keysRaw.filter((key): key is string => typeof key === 'string' && key !== '') : []
  const quotedRows = stageRows.filter(row => row.label === QUOTED && typeof row.stage_key === 'string')
  const quoted: QuotedSeed = quotedRows.length === 0 ? 'absent' : quotedRows.some(row => keys.includes(String(row.stage_key))) ? 'included' : 'excluded'
  if (keys.length === 0) return { qualified: 'unset', quoted }
  const count = await supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('client_id', clientId).in('stage', keys)
  if (count.error || typeof count.count !== 'number') return { qualified: 'unreadable', quoted }
  return { qualified: count.count > 0 ? 'ready' : 'empty', quoted }
}

function blankEvidence(capture: CaptureState): SwitchEvidence {
  return { capture, asOf: null, stableEnd: null, datesSeen: null, leads: null, spendMajor: null, targetMajor: null, currency: null }
}

async function loadEvidence(supabase: SupabaseClient, clientId: string, spec: PromoSpec, today: string, now: Date): Promise<SwitchEvidence> {
  const accountIds = [...new Set(allAdsSteps(spec).map(row => row.step.settings.ad_account_id))]
  if (accountIds.length === 0) return blankEvidence('missing')
  const capture = await readCaptures(supabase, clientId, accountIds, now)
  const target = await readTarget(supabase, clientId)
  if (capture !== 'fresh' || !spec.delivery) {
    return { ...blankEvidence(capture), targetMajor: target === undefined ? null : target }
  }
  const stableEnd = shiftDate(today, -DEFAULT_PROMO_PLAYBOOK.insightsUnstableDays)
  const totals = stableEnd < spec.delivery.started_on ? { leads: 0, spend: 0, dates: 0 } : await readInsights(supabase, clientId, accountIds, spec.delivery.started_on, stableEnd)
  const currency = await readCurrency(supabase, accountIds)
  if (currency === undefined || target === undefined || totals === null) return { ...blankEvidence('unreadable'), asOf: today, stableEnd }
  return { capture, asOf: today, stableEnd, datesSeen: totals.dates, leads: totals.leads, spendMajor: totals.spend, targetMajor: target, currency }
}

export function describeDelivery(spec: PromoSpec, verdict: SwitchVerdict, ladder: LadderView, draftNote: string | null): DeliveryView {
  const marked = spec.delivery !== undefined
  return {
    stage_label: marked && spec.delivery ? STAGE_LABEL[spec.delivery.stage] : '还没标',
    goal: marked && spec.delivery ? spec.delivery.goal : STAGE_GOAL.test,
    ratio_text: ratioWarning(spec).text,
    switch_text: verdict.text,
    can_propose: verdict.kind === 'propose',
    draft_note: draftNote,
    ladder_note: ladder.note,
    rungs: ladder.rungs,
  }
}

export async function loadDeliveryView(
  supabase: SupabaseClient, clientId: string, spec: PromoSpec, today: string | null, now: Date = new Date(),
): Promise<DeliveryView> {
  try {
    const ladderFacts = await readLadderFacts(supabase, clientId)
    const ladder = audienceLadder({ stage: spec.delivery?.stage ?? null, countries: countriesOf(spec), ...ladderFacts })
    if (!today) {
      return describeDelivery(spec, { kind: 'unreadable', text: '不知道今天是客户的哪一天，不能判断能不能换阶段。' }, ladder, null)
    }
    const evidence = await loadEvidence(supabase, clientId, spec, today, now)
    const verdict = judgeSwitch(spec, evidence)
    const draftNote = verdict.kind === 'propose' ? buildScaleDraft(spec, today).note : null
    return describeDelivery(spec, verdict, ladder, draftNote)
  } catch {
    const ladder = audienceLadder({ stage: spec.delivery?.stage ?? null, countries: [], qualified: 'unreadable', quoted: 'unreadable' })
    return describeDelivery(spec, { kind: 'unreadable', text: '阶段证据没读成，这次不提案。' }, ladder, null)
  }
}

export async function stageSwitchFinding(
  supabase: SupabaseClient, plan: MarketingPlan, today: string | null, title: string,
): Promise<WatchFinding | null> {
  try {
    const spec = readPromoSpec(plan.plan_data)
    if (plan.status !== 'approved' || !today || spec?.delivery?.stage !== 'test') return null
    const view = await loadDeliveryView(supabase, plan.client_id, spec, today)
    if (!view.can_propose) return null
    return {
      code: 'stage_switch_ready',
      what: `推广计划《${title}》：${view.switch_text}`,
      how: '打开推广计划页，点「生成放量草稿」。看完再决定批不批。正在跑的计划不会被改，也不会自动重新批准。',
    }
  } catch {
    return null
  }
}
