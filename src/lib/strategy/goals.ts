/**
 * Phase 31 — Goal lifecycle operations
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
      fde_reasoning: input.fde_reasoning ?? null,
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
 * Activate a draft Goal — moves status to 'active'.
 * Phase 32: 1-active-Goal restriction removed. Multiple active Goals allowed
 * per client (e.g. CTS 4 团 + Oztop 清仓 + 月营收同时跑).
 */
export async function activateGoal(
  supabase: SupabaseClient,
  goalId: string,
): Promise<{ ok: boolean; error?: string }> {
  const goal = await getGoalById(supabase, goalId)
  if (!goal) return { ok: false, error: 'Goal not found' }
  if (goal.status !== 'draft') {
    return { ok: false, error: `Cannot activate goal in status '${goal.status}'` }
  }

  const { error } = await supabase
    .from('goals')
    .update({ status: 'active' })
    .eq('id', goalId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
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
