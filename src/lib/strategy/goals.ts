/**
 * Phase 31 — Goal lifecycle operations
 *
 * IMPACT app/impact stage: Inspect (a draft demand stays out of Measure until this gate passes).
 *
 * Centralises all DB access for goals so API routes stay thin.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  GoalRow,
  CreateGoalInput,
  GoalStatus,
} from '@/types/strategy'

/**
 * Get the **most-recently-activated** Goal for a client (singular focus view).
 *
 * Phase 32: multiple active Goals may exist. This helper returns the newest one
 * (by created_at desc) for backward compatibility with the single-banner view.
 * Use `listActiveGoals` when you need all of them.
 *
 * "[Migration] Unassigned Backlog" placeholders are excluded — they're
 * draft-status containers for legacy actions, not real goals.
 */
export async function getActiveGoal(
  supabase: SupabaseClient,
  clientId: string,
): Promise<GoalRow | null> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[strategy/goals] getActiveGoal error', error)
    return null
  }
  return data as GoalRow | null
}

/**
 * Phase 32: list ALL active Goals for a client (multi-Goal support).
 * Ordered newest first. Use for the multi-Goal banner / overview.
 */
export async function listActiveGoals(
  supabase: SupabaseClient,
  clientId: string,
): Promise<GoalRow[]> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[strategy/goals] listActiveGoals error', error)
    return []
  }
  return (data ?? []) as GoalRow[]
}

/**
 * List all goals for a client (any status), ordered newest first.
 * Excludes migration placeholders unless includeMigrationPlaceholders=true.
 */
export async function listGoalsForClient(
  supabase: SupabaseClient,
  clientId: string,
  opts: { includeMigrationPlaceholders?: boolean; statuses?: GoalStatus[] } = {},
): Promise<GoalRow[]> {
  let query = supabase
    .from('goals')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (opts.statuses && opts.statuses.length > 0) {
    query = query.in('status', opts.statuses)
  }

  if (!opts.includeMigrationPlaceholders) {
    query = query.neq('title', '[Migration] Unassigned Backlog')
  }

  const { data, error } = await query
  if (error) {
    console.error('[strategy/goals] listGoalsForClient error', error)
    return []
  }
  return (data ?? []) as GoalRow[]
}

/**
 * Get a goal by id (no client scoping — caller must validate access).
 */
export async function getGoalById(
  supabase: SupabaseClient,
  goalId: string,
): Promise<GoalRow | null> {
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .maybeSingle()

  if (error) {
    console.error('[strategy/goals] getGoalById error', error)
    return null
  }
  return data as GoalRow | null
}

/**
 * Create a draft Goal. FDE later flips it to 'active' explicitly via activateGoal.
 * Validations:
 *   - period_end must be after period_start
 *   - target_value must differ from baseline (otherwise meaningless goal)
 *   - awareness_subtype is required if intent='awareness'
 */
export interface CreateGoalResult {
  ok: boolean
  goal?: GoalRow
  error?: string
}

export async function createGoal(
  supabase: SupabaseClient,
  clientId: string,
  input: CreateGoalInput,
): Promise<CreateGoalResult> {
  // ── Input validation ──────────────────────────────────────────────────
  if (!input.intent) return { ok: false, error: 'intent is required' }
  if (!input.title?.trim()) return { ok: false, error: 'title is required' }
  if (!input.primary_metric_key) return { ok: false, error: 'primary_metric_key is required' }
  if (!input.primary_metric_label) return { ok: false, error: 'primary_metric_label is required' }

  const periodStart = new Date(input.period_start)
  const periodEnd = new Date(input.period_end)
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return { ok: false, error: 'period_start and period_end must be valid ISO dates' }
  }
  if (periodEnd <= periodStart) {
    return { ok: false, error: 'period_end must be after period_start' }
  }

  if (input.baseline_value === input.target_value) {
    return { ok: false, error: 'target_value must differ from baseline_value' }
  }

  // Phase 32: awareness_subtype is now a special case of sub_type — accept either.
  const awarenessSubtype = input.awareness_subtype
    ?? (input.intent === 'awareness'
      && input.sub_type
      && ['new_market', 'event_campaign', 'geographic_expansion', 'reputation_recovery'].includes(input.sub_type)
      ? input.sub_type as 'new_market' | 'event_campaign' | 'geographic_expansion' | 'reputation_recovery'
      : null)

  if (input.intent === 'awareness' && !awarenessSubtype && !input.sub_type) {
    return { ok: false, error: 'sub_type (or awareness_subtype) is required for awareness goals' }
  }

  const reasoning = readText(input.fde_reasoning)
  if (!isGoalReason(reasoning)) {
    return { ok: false, error: '不能保存草稿，缺：理由' }
  }

  // ── Insert ────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('goals')
    .insert({
      client_id: clientId,
      intent: input.intent,
      sub_type: input.sub_type ?? awarenessSubtype ?? null,  // P32
      awareness_subtype: awarenessSubtype ?? null,
      title: input.title.trim(),
      primary_metric_key: input.primary_metric_key,
      primary_metric_label: input.primary_metric_label,
      primary_metric_unit: input.primary_metric_unit ?? null,
      baseline_value: input.baseline_value,
      target_value: input.target_value,
      target_direction: input.target_direction ?? 'increase',  // P32
      supporting_metrics: input.supporting_metrics ?? [],
      period_start: input.period_start,
      period_end: input.period_end,
      budget_amount: input.budget_amount ?? null,
      budget_currency: input.budget_currency ?? 'AUD',
      status: 'draft',
      fde_reasoning: reasoning,
      is_beta: true,
    })
    .select()
    .single()

  if (error) {
    console.error('[strategy/goals] createGoal insert error', error)
    return { ok: false, error: error.message }
  }
  return { ok: true, goal: data as GoalRow }
}

/**
 * Activate a draft Goal — moves status to 'active' (进行中).
 * Phase 32: 1-active-Goal restriction removed. Multiple active Goals allowed.
 *
 * Refuses the draft → active step unless the demand contract is complete.
 * Does not rewrite the row's other fields and does not touch goals that are
 * already past draft.
 */
export async function activateGoal(
  supabase: SupabaseClient,
  goalId: string,
): Promise<ActivateGoalResult> {
  const goal = await getGoalById(supabase, goalId)
  if (!goal) return { ok: false, error: 'Goal not found' }
  if (goal.status !== 'draft') {
    return { ok: false, error: `Cannot activate goal in status '${goal.status}'` }
  }

  const refusal = assessGoalActivation(goal)
  if (refusal) return refusal

  const { error } = await supabase
    .from('goals')
    .update({ status: 'active' })
    .eq('id', goalId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Contract gaps that block draft → active. Order is stable. */
export type GoalActivationGap = 'primary_metric' | 'period' | 'baseline' | 'reason'

export interface ActivateGoalResult {
  ok: boolean
  error?: string
  /** Present only when the contract refused the transition. */
  missing?: GoalActivationGap[]
  /** Present when a sales goal's primary metric is a click or a lead. */
  sales_metric?: 'click_or_lead'
}

/**
 * Fields the activation gate reads. `baseline_value` is `unknown` because
 * PostgREST returns PostgreSQL NUMERIC as a string.
 */
export interface GoalActivationSubject {
  intent: string | null
  primary_metric_key: unknown
  primary_metric_label: unknown
  baseline_value: unknown
  supporting_metrics: unknown
  period_start: unknown
  period_end: unknown
  fde_reasoning: unknown
}

/**
 * Reserved supporting-metric mark for "we do not know the baseline".
 * `goals.baseline_value` is numeric NOT NULL, so 0 remains a declared baseline.
 * Callers store `{ key: BASELINE_UNKNOWN_KEY, label: BASELINE_UNKNOWN_LABEL }`
 * on `supporting_metrics`. No new column.
 */
export const BASELINE_UNKNOWN_KEY = 'baseline_unknown'
export const BASELINE_UNKNOWN_LABEL = '基线未知'

const GAP_LABEL: Record<GoalActivationGap, string> = {
  primary_metric: '主指标',
  period: '周期起止',
  baseline: '基线（数值或「基线未知」）',
  reason: '理由',
}

const REASON_PLACEHOLDERS = new Set([
  'tbd', 'todo', 'n/a', 'na', 'none', 'null', 'unknown',
  '未知', '待定', '-', '—', '无',
])

/**
 * Click / lead primary metrics. Sales must not be measured by these.
 * TODO(outcome-levels): replace `isClickOrLeadPrimaryMetric` with the export
 * of the same name from src/lib/strategy/outcome-levels.ts (parallel work;
 * do not create that file here). That module owns the contact-success /
 * qualified-lead / sale split.
 */
const CLICK_OR_LEAD_KEYS = new Set([
  'seo_gsc_clicks_28d',
  'leads_count',
  'messaging_started',
  'form_submissions',
  'phone_calls',
])

const CLICK_OR_LEAD_LABELS = new Set([
  '谷歌搜索点击（近 28 天）',
  'Google search clicks (28 days)',
  '新增线索/询盘',
  'New leads / inquiries',
  '私信/WhatsApp 对话开启数',
  'Messaging conversations started',
  'GA4 表单提交',
  'GA4 form submissions',
  '电话呼入',
  'Phone calls in',
])

/**
 * Returns a refusal when the draft is not allowed to become active.
 * Returns null when the contract is satisfied. Does not write.
 */
export function assessGoalActivation(goal: GoalActivationSubject): ActivateGoalResult | null {
  const missing = collectActivationGaps(goal)
  const salesDetail = salesClickOrLeadDetail(goal)
  if (missing.length === 0 && !salesDetail) return null
  return {
    ok: false,
    error: formatActivationRefusal(missing, salesDetail),
    missing,
    ...(salesDetail ? { sales_metric: 'click_or_lead' as const } : {}),
  }
}

function collectActivationGaps(goal: GoalActivationSubject): GoalActivationGap[] {
  const missing: GoalActivationGap[] = []
  if (!hasPrimaryMetric(goal)) missing.push('primary_metric')
  if (!hasPeriod(goal)) missing.push('period')
  if (!hasBaseline(goal)) missing.push('baseline')
  if (!isGoalReason(goal.fde_reasoning)) missing.push('reason')
  return missing
}

function hasPrimaryMetric(goal: GoalActivationSubject): boolean {
  return readText(goal.primary_metric_key).length > 0
    && readText(goal.primary_metric_label).length > 0
}

function hasPeriod(goal: GoalActivationSubject): boolean {
  const start = parseDate(goal.period_start)
  const end = parseDate(goal.period_end)
  if (start === null || end === null) return false
  return end > start
}

function hasBaseline(goal: GoalActivationSubject): boolean {
  return hasBaselineValue(goal.baseline_value) || baselineMarkedUnknown(goal.supporting_metrics)
}

/** A finite number, including 0, is a declared baseline. Blank is not. */
function hasBaselineValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return Number.isFinite(Number(trimmed))
}

function baselineMarkedUnknown(metrics: unknown): boolean {
  if (!Array.isArray(metrics)) return false
  return metrics.some(item => {
    if (!item || typeof item !== 'object') return false
    const record = item as { key?: unknown; label?: unknown }
    const key = readText(record.key).toLowerCase()
    const label = readText(record.label)
    return key === BASELINE_UNKNOWN_KEY || label === BASELINE_UNKNOWN_LABEL
  })
}

/** Same rule the activation gate uses. Create and draft edits must share it. */
export function isGoalReason(value: unknown): boolean {
  const text = readText(value)
  if (text.length < 8) return false
  const token = text.toLowerCase().replace(/[.!?。！？]+$/g, '')
  if (REASON_PLACEHOLDERS.has(token)) return false
  return /[A-Za-z\u3400-\u9FFF]/.test(text)
}

function salesClickOrLeadDetail(goal: GoalActivationSubject): string | null {
  if (goal.intent !== 'sales') return null
  const key = readText(goal.primary_metric_key)
  const label = readText(goal.primary_metric_label)
  if (!key && !label) return null
  if (!isClickOrLeadPrimaryMetric(key, label)) return null
  return key || label
}

function isClickOrLeadPrimaryMetric(key: string, label: string): boolean {
  const normalized = key.trim().toLowerCase()
  if (CLICK_OR_LEAD_KEYS.has(normalized)) return true
  if (/(^|[_\-.])(click|clicks|lead|leads|inquiry|inquiries|enquiry|enquiries)([_\-.]|$)/.test(normalized)) {
    return true
  }
  if (
    normalized.includes('form_submission')
    || normalized.includes('messaging_started')
    || normalized.includes('phone_call')
  ) return true
  return CLICK_OR_LEAD_LABELS.has(label.trim())
}

function formatActivationRefusal(missing: GoalActivationGap[], salesDetail: string | null): string {
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(`缺：${missing.map(gap => GAP_LABEL[gap]).join('、')}`)
  }
  if (salesDetail) {
    parts.push(`销售目标的主指标不能是点击或线索（${salesDetail}）`)
  }
  return `不能改为进行中，${parts.join('；')}`
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Archive an active or expired Goal (does not delete it).
 */
export async function archiveGoal(
  supabase: SupabaseClient,
  goalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('goals')
    .update({ status: 'archived' })
    .eq('id', goalId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Delete a draft goal (rare — only allowed for drafts, never active/archived).
 */
export async function deleteDraftGoal(
  supabase: SupabaseClient,
  goalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const goal = await getGoalById(supabase, goalId)
  if (!goal) return { ok: false, error: 'Goal not found' }
  if (goal.status !== 'draft') {
    return { ok: false, error: 'Only draft goals can be deleted' }
  }
  if (goal.title === '[Migration] Unassigned Backlog') {
    return { ok: false, error: 'Migration placeholder cannot be deleted directly' }
  }

  const { error } = await supabase.from('goals').delete().eq('id', goalId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Replace the reason on a draft only. Does not touch any other column,
 * and the write itself is limited to rows still in draft.
 */
export async function updateDraftGoalReason(
  supabase: SupabaseClient,
  goalId: string,
  reasoning: unknown,
): Promise<CreateGoalResult> {
  const goal = await getGoalById(supabase, goalId)
  if (!goal) return { ok: false, error: 'Goal not found' }
  if (goal.status !== 'draft') {
    return { ok: false, error: 'Only draft goals can change their reason' }
  }

  const text = readText(reasoning)
  if (!isGoalReason(text)) {
    return { ok: false, error: '不能保存草稿，缺：理由' }
  }

  const { data, error } = await supabase
    .from('goals')
    .update({ fde_reasoning: text })
    .eq('id', goalId)
    .eq('status', 'draft')
    .select()
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'Goal not found' }
  return { ok: true, goal: data as GoalRow }
}
