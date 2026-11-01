/**
 * Checks ad delivery and saves an inactive candidate lesson when actionable.
 * The temporal cost-per-lead attribution keeps its own outcome row; a
 * same-account winner comparison is diagnostic context, not that outcome.
 *
 * No Meta call, no spend, no new table. A prescription goes out only as an
 * inactive candidate lesson.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { writeGlobalLesson, type LessonInput, type WriteLessonResult } from '@/lib/memory/write-lesson'
import { ADS_METRIC_KEY } from '../vocabulary'
import {
  aggregateDelivery,
  buildFunnelInput,
  checkAdsFunnel,
  finiteOrNull,
  isFunnelCheckInput,
  planOrNull,
  toLessonInput,
  FUNNEL_REASON,
  type ActionStat,
  type DeliveryDay,
  type DeliverySide,
  type FunnelCheckInput,
  type FunnelCheckResult,
} from './ads-funnel-health'

export interface FunnelAction {
  id: string
  client_id: string
  expected_metric: string
  executed_at: string
  payload: Record<string, unknown> | null
}

export interface FunnelRecordResult {
  checked: boolean
  errors: string[]
}

type PersistResult = WriteLessonResult | { ok: true; lessonKey: string; skipped: true }

function textField(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

function readSide(value: unknown): DeliverySide | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return planOrNull({
    objective: textField(row, 'objective'),
    destinationType: textField(row, 'destination_type', 'destinationType'),
    entityId: textField(row, 'entity_id', 'entityId'),
    adAccountId: textField(row, 'ad_account_id', 'adAccountId'),
  })
}

function parseActions(value: unknown): ActionStat[] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return null
  const actions: ActionStat[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { action_type?: unknown; value?: unknown }
    if (typeof record.action_type !== 'string') continue
    const raw = record.value
    const asText = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null
    if (asText === null) continue
    actions.push({ action_type: record.action_type, value: asText })
  }
  return actions
}

/** Map one ad_daily_insights row. Ignores ctr and all-clicks on purpose. */
export function mapInsightRow(row: Record<string, unknown>): DeliveryDay | null {
  const adAccountId = textField(row, 'ad_account_id')
  const entityId = textField(row, 'entity_id')
  if (!adAccountId || !entityId) return null
  return {
    adAccountId,
    entityId,
    spend: finiteOrNull(row.spend),
    impressions: finiteOrNull(row.impressions),
    leads: finiteOrNull(row.leads),
    actions: parseActions(row.actions),
    videoP100: finiteOrNull(row.video_p100),
    videoThruPlay: finiteOrNull(row.video_thruplays),
  }
}

function windowDates(executedAt: string, windowDays: number): { from: string; to: string } {
  const start = new Date(executedAt)
  const end = new Date(start)
  end.setDate(end.getDate() + windowDays)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

function resolveInput(built: FunnelCheckInput | FunnelCheckResult): FunnelCheckResult {
  if ('verdict' in built) return built
  return checkAdsFunnel(built)
}

async function loadDays(action: FunnelAction, windowDays: number): Promise<DeliveryDay[]> {
  const dates = windowDates(action.executed_at, windowDays)
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    supabaseAdmin
      .from('ad_daily_insights')
      .select('ad_account_id, entity_id, insight_date, spend, impressions, leads, actions, video_p100, video_thruplays')
      .eq('client_id', action.client_id)
      .eq('platform', 'meta')
      .eq('level', 'ad')
      .gte('insight_date', dates.from)
      .lte('insight_date', dates.to)
      .order('entity_id', { ascending: true })
      .order('insight_date', { ascending: true })
      .range(from, to),
  )
  const days: DeliveryDay[] = []
  for (const row of rows) {
    const day = mapInsightRow(row)
    if (day) days.push(day)
  }
  return days
}

function inputForAction(action: FunnelAction, days: DeliveryDay[]): FunnelCheckResult | FunnelCheckInput | null {
  const raw = action.payload?.funnel_health
  if (raw !== undefined) {
    return isFunnelCheckInput(raw) ? raw : { ...refuseMissing(), planCompared: true }
  }
  if (days.length === 0) return null
  const plan = readSide(action.payload?.ads_plan)
  const actual = readSide(action.payload?.ads_actual)
  return buildFunnelInput(aggregateDelivery(days), plan, actual)
}

function refuseMissing(): FunnelCheckResult {
  return checkAdsFunnel({
    plan: { objective: 'MISSING', destinationType: null, entityId: null, adAccountId: null },
    actual: { objective: null, destinationType: null, entityId: null, adAccountId: null },
    subject: emptyUnit(),
    peers: [],
  })
}

function emptyUnit() {
  return {
    id: 'missing',
    adAccountId: '',
    spend: null,
    impressions: null,
    linkClicks: null,
    leads: null,
    formOpens: null,
    videoP100: null,
    videoThruPlay: null,
  }
}

/**
 * Write the candidate once. A later run must not flip is_active back to false
 * after a person has adopted the lesson (write-lesson defaults isActive to true;
 * this function still passes false on the first write).
 */
export async function persistCandidateLesson(
  supabase: SupabaseClient,
  input: LessonInput,
): Promise<PersistResult> {
  const forced: LessonInput = { ...input, isActive: false }
  const existing = await supabase
    .from('global_learned_lessons')
    .select('lesson_key')
    .eq('lesson_key', forced.lessonKey)
    .maybeSingle()
  if (existing.error) return { ok: false, reason: 'db', error: existing.error.message }
  if (existing.data) return { ok: true, lessonKey: forced.lessonKey, skipped: true }
  return writeGlobalLesson(supabase, forced)
}

async function writeLesson(result: FunnelCheckResult): Promise<string | null> {
  const lesson = toLessonInput(result)
  if (!lesson) return null
  const saved = await persistCandidateLesson(supabaseAdmin, lesson)
  if (!saved.ok) return saved.reason === 'not_shareable' ? saved.verdict.summary : saved.error
  return null
}

/**
 * Run the check for a cost-per-lead action. Other metrics return checked:false
 * and do not touch ad insights. Never throws.
 */
export async function recordAdsFunnelCheck(
  action: FunnelAction,
  windowDays: number,
): Promise<FunnelRecordResult> {
  if (action.expected_metric !== ADS_METRIC_KEY.COST_PER_LEAD) return { checked: false, errors: [] }
  try {
    const days = action.payload?.funnel_health !== undefined ? [] : await loadDays(action, windowDays)
    const built = inputForAction(action, days)
    if (!built) return { checked: false, errors: [] }
    const result = 'verdict' in built ? built : resolveInput(built)
    // Rows that never stored link clicks are "not checked", not a zero.
    // There is no candidate diagnosis in that case.
    const explicit = action.payload?.funnel_health !== undefined
    if (!explicit && result.reasonCode === FUNNEL_REASON.missing_data) {
      return { checked: false, errors: [] }
    }
    const lessonError = await writeLesson(result)
    return { checked: true, errors: lessonError === null ? [] : [lessonError] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { checked: false, errors: [`ads funnel check: ${message}`] }
  }
}
