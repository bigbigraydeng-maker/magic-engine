/**
 * Phase 31 M3 — Initiative CRUD
 *
 * Centralises DB access for initiatives. Type/tier mapping enforced.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  InitiativeRow,
  InitiativeType,
  CreateInitiativeInput,
  GoalRow,
} from '@/types/strategy'
import { INITIATIVE_TYPE_TIER } from '@/types/strategy'

/**
 * List initiatives for a Goal, ordered by sort_order.
 * Excludes archived by default.
 */
export async function listInitiativesForGoal(
  supabase: SupabaseClient,
  goalId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<InitiativeRow[]> {
  let query = supabase
    .from('initiatives')
    .select('*')
    .eq('goal_id', goalId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (!opts.includeArchived) query = query.eq('is_archived', false)

  const { data, error } = await query
  if (error) {
    console.error('[strategy/initiatives] listInitiativesForGoal error', error)
    return []
  }
  return (data ?? []) as InitiativeRow[]
}

/**
 * List initiatives across all goals for a client (used by execution Kanban dropdown).
 * Excludes archived. Includes goal title for display.
 */
export async function listInitiativesForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<Array<InitiativeRow & { goal_title: string; goal_status: string }>> {
  const { data, error } = await supabase
    .from('initiatives')
    .select('*, goals!inner(title, status)')
    .eq('client_id', clientId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[strategy/initiatives] listInitiativesForClient error', error)
    return []
  }

  return (data ?? []).map((row: any) => ({
    ...row,
    goal_title: row.goals?.title ?? '(unknown)',
    goal_status: row.goals?.status ?? 'unknown',
  })) as Array<InitiativeRow & { goal_title: string; goal_status: string }>
}

/**
 * Get initiative by id.
 */
export async function getInitiativeById(
  supabase: SupabaseClient,
  id: string,
): Promise<InitiativeRow | null> {
  const { data, error } = await supabase
    .from('initiatives')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return null
  return data as InitiativeRow | null
}

/**
 * Sum of budget_percent for non-archived initiatives under a goal.
 * Excludes the 'unassigned' bucket — its 0% is technically there but UX-irrelevant.
 */
export async function sumBudgetPercent(
  supabase: SupabaseClient,
  goalId: string,
  excludeInitiativeId?: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('initiatives')
    .select('id, budget_percent, initiative_type')
    .eq('goal_id', goalId)
    .eq('is_archived', false)

  if (error || !data) return 0

  return data
    .filter(r => r.id !== excludeInitiativeId)
    .filter(r => r.initiative_type !== 'unassigned')
    .reduce((sum, r) => sum + (r.budget_percent ?? 0), 0)
}

async function validateSupportsInitiativeParent(
  supabase: SupabaseClient,
  goalId: string,
  supportsInitiativeId: string,
): Promise<string | null> {
  const parent = await getInitiativeById(supabase, supportsInitiativeId)
  if (!parent) return 'supports_initiative_id not found'
  if (parent.tier !== 'terminal') return 'supports_initiative_id must be a terminal initiative'
  if (parent.goal_id !== goalId) return 'supports_initiative_id must belong to the same goal'
  return null
}

/**
 * Create an initiative under a goal.
 * Auto-computes:
 *   - tier from initiative_type (terminal/supporting)
 *   - budget_amount from goal.budget_amount * budget_percent
 * Validates:
 *   - Total budget across initiatives ≤ 100%
 *   - Supporting must have supports_initiative_id pointing at a Terminal
 *   - Cannot create under archived/expired Goal (allow draft + active)
 */
export interface CreateInitiativeResult {
  ok: boolean
  initiative?: InitiativeRow
  error?: string
}

export async function createInitiative(
  supabase: SupabaseClient,
  input: CreateInitiativeInput,
): Promise<CreateInitiativeResult> {
  // ── Validation ────────────────────────────────────────────────────────
  if (!input.goal_id) return { ok: false, error: 'goal_id is required' }
  if (!input.initiative_type) return { ok: false, error: 'initiative_type is required' }
  if (!input.title?.trim()) return { ok: false, error: 'title is required' }

  const tier = INITIATIVE_TYPE_TIER[input.initiative_type]
  if (!tier) return { ok: false, error: `Unknown initiative_type: ${input.initiative_type}` }

  // Load parent goal
  const { data: goal, error: goalErr } = await supabase
    .from('goals')
    .select('id, client_id, status, budget_amount')
    .eq('id', input.goal_id)
    .maybeSingle<Pick<GoalRow, 'id' | 'client_id' | 'status' | 'budget_amount'>>()

  if (goalErr || !goal) return { ok: false, error: 'Goal not found' }
  if (goal.status !== 'draft' && goal.status !== 'active') {
    return { ok: false, error: `Cannot add initiative to goal in status '${goal.status}'` }
  }

  // Supporting must point at a terminal (or be unassigned)
  if (tier === 'supporting' && input.initiative_type !== 'unassigned' && !input.supports_initiative_id) {
    return { ok: false, error: 'Supporting initiative must specify supports_initiative_id (a terminal initiative)' }
  }

  if (tier === 'terminal' && input.supports_initiative_id) {
    return { ok: false, error: 'Terminal initiative cannot specify supports_initiative_id' }
  }

  if (input.supports_initiative_id) {
    const parentError = await validateSupportsInitiativeParent(supabase, input.goal_id, input.supports_initiative_id)
    if (parentError) return { ok: false, error: parentError }
  }

  // Budget constraint
  if (input.budget_percent != null) {
    if (input.budget_percent < 0 || input.budget_percent > 100) {
      return { ok: false, error: 'budget_percent must be 0-100' }
    }
    const existingSum = await sumBudgetPercent(supabase, input.goal_id)
    if (existingSum + input.budget_percent > 100.001) {  // tiny epsilon for float
      return { ok: false, error: `Budget exceeds 100% (current ${existingSum}% + new ${input.budget_percent}%)` }
    }
  }

  const budgetAmount = goal.budget_amount != null && input.budget_percent != null
    ? Math.round(goal.budget_amount * input.budget_percent / 100)
    : null

  const { data, error } = await supabase
    .from('initiatives')
    .insert({
      goal_id: input.goal_id,
      client_id: goal.client_id,
      initiative_type: input.initiative_type,
      tier,
      title: input.title.trim(),
      posture: input.posture ?? null,
      budget_percent: input.budget_percent ?? null,
      budget_amount: budgetAmount,
      hypothesis: input.hypothesis ?? null,
      hypothesis_polished_by_ai: false,
      supports_initiative_id: input.supports_initiative_id ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, initiative: data as InitiativeRow }
}

/**
 * Update an existing initiative.
 * Allowed fields: title / posture / budget_percent / hypothesis / supports_initiative_id / sort_order.
 * Cannot change initiative_type (which would also change tier) — delete + recreate instead.
 */
export interface UpdateInitiativeInput {
  title?: string
  posture?: InitiativeRow['posture'] | null
  budget_percent?: number | null
  hypothesis?: string | null
  hypothesis_polished_by_ai?: boolean
  supports_initiative_id?: string | null
  sort_order?: number
  /** Phase 33: Campaign UUIDs linked to this initiative */
  campaign_ids?: string[]
}

export async function updateInitiative(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateInitiativeInput,
): Promise<CreateInitiativeResult> {
  const existing = await getInitiativeById(supabase, id)
  if (!existing) return { ok: false, error: 'Initiative not found' }

  if (patch.supports_initiative_id !== undefined) {
    if (existing.tier === 'terminal' && patch.supports_initiative_id) {
      return { ok: false, error: 'Terminal initiative cannot specify supports_initiative_id' }
    }
    if (existing.tier === 'supporting' && existing.initiative_type !== 'unassigned' && !patch.supports_initiative_id) {
      return { ok: false, error: 'Supporting initiative must specify supports_initiative_id (a terminal initiative)' }
    }
    if (patch.supports_initiative_id) {
      const parentError = await validateSupportsInitiativeParent(supabase, existing.goal_id, patch.supports_initiative_id)
      if (parentError) return { ok: false, error: parentError }
    }
  }

  // Budget re-check if changing budget_percent
  if (patch.budget_percent !== undefined && patch.budget_percent !== null) {
    if (patch.budget_percent < 0 || patch.budget_percent > 100) {
      return { ok: false, error: 'budget_percent must be 0-100' }
    }
    const sumOthers = await sumBudgetPercent(supabase, existing.goal_id, id)
    if (sumOthers + patch.budget_percent > 100.001) {
      return { ok: false, error: `Budget exceeds 100% (others ${sumOthers}% + this ${patch.budget_percent}%)` }
    }
  }

  // Recompute budget_amount if budget_percent changed
  let budgetAmountUpdate: number | null | undefined
  if (patch.budget_percent !== undefined) {
    const { data: goal } = await supabase
      .from('goals')
      .select('budget_amount')
      .eq('id', existing.goal_id)
      .maybeSingle<{ budget_amount: number | null }>()
    budgetAmountUpdate = goal?.budget_amount != null && patch.budget_percent != null
      ? Math.round(goal.budget_amount * patch.budget_percent / 100)
      : null
  }

  const update: Record<string, unknown> = {}
  if (patch.title !== undefined) update.title = patch.title
  if (patch.posture !== undefined) update.posture = patch.posture
  if (patch.budget_percent !== undefined) update.budget_percent = patch.budget_percent
  if (budgetAmountUpdate !== undefined) update.budget_amount = budgetAmountUpdate
  if (patch.hypothesis !== undefined) update.hypothesis = patch.hypothesis
  if (patch.hypothesis_polished_by_ai !== undefined) update.hypothesis_polished_by_ai = patch.hypothesis_polished_by_ai
  if (patch.supports_initiative_id !== undefined) update.supports_initiative_id = patch.supports_initiative_id
  if (patch.sort_order !== undefined) update.sort_order = patch.sort_order
  if (patch.campaign_ids !== undefined) update.campaign_ids = patch.campaign_ids

  const { data, error } = await supabase
    .from('initiatives')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, initiative: data as InitiativeRow }
}

/**
 * Archive (soft-delete) an initiative.
 * Actions still reference initiative_id — they keep showing under archived initiatives
 * for traceability. UI filters them out by is_archived=true.
 */
export async function archiveInitiative(
  supabase: SupabaseClient,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('initiatives')
    .update({ is_archived: true })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
