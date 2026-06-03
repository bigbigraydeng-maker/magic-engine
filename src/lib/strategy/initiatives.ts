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

// ─── Phase 33 M4 — Execution summary aggregation ─────────────────────────────
//
// Goal 详情页要看一眼就知道执行进度。聚合两条信息：
//   1) 每个 Initiative 的 action 完成率 + 真实 Campaign 数（防御死 ID + paused）
//   2) 整个 Goal 的汇总数（N Initiative / X Campaign / Y action 已完成 / Z 进行中）
//
// 为什么独立一个 server 聚合 helper 而不是前端 fetch:
//   - 避免 N+1：每 Initiative 一个 fetch 在前端就是 N 个请求
//   - 避免现存 bug 复用：InitiativeExecutionPanel 拉 campaign 用 ?status=active，
//     paused 会从统计里消失。这里直接全状态查
//   - 死 ID 防御：用 IN(...) 查 campaign_briefs 真实存在的 id，不靠 array_length
//
// completion rate 分母：total - skipped（skipped 不该算分母，
// 否则 FDE 跳过的卡片会拖低完成率）。

export interface InitiativeExecutionSummary {
  initiativeId: string
  title: string
  initiativeType: string
  /** Real campaign count (existing rows in campaign_briefs that match campaign_ids) */
  campaignCount: number
  /** Campaign status breakdown (active / paused / draft / archived / completed). */
  campaignStatusCounts: Record<string, number>
  totalActions: number
  /** completed - skipped is NOT subtracted; completed is the literal count */
  completedActions: number
  inProgressActions: number
  pendingActions: number
  skippedActions: number
  /** completed / (total - skipped), 0..100; null when denominator is 0 */
  completionPct: number | null
}

export interface GoalExecutionSummary {
  goalId: string
  initiativeCount: number
  /** Sum of real campaigns across all initiatives (deduplicated). */
  totalCampaigns: number
  totalActions: number
  totalCompleted: number
  totalInProgress: number
  totalPending: number
  totalSkipped: number
  /** Aggregate completion (sum completed / sum (total - skipped)); null when denom=0 */
  aggregateCompletionPct: number | null
  perInitiative: InitiativeExecutionSummary[]
}

/**
 * Compute execution summary for a Goal in one DB roundtrip per table.
 *
 * Architecture notes:
 *   - 1 query to list active (non-archived) initiatives for the goal
 *   - 1 query to fetch all execution_items where initiative_id IN (...)
 *   - 1 query to fetch all campaign_briefs where id IN (flattened campaign_ids)
 *   - In-memory grouping per initiative
 *
 * The pgrest .in() filter is bounded — for typical Goal scope (2-5 initiatives,
 * each with 0-5 campaigns and 0-20 actions) this stays well under any query cap.
 */
export async function getExecutionSummaryForGoal(
  supabase: SupabaseClient,
  goalId: string,
): Promise<GoalExecutionSummary | null> {
  // 1) Initiatives for this goal (active = is_archived=false; unassigned bucket excluded)
  const inits = await listInitiativesForGoal(supabase, goalId, { includeArchived: false })
  const realInits = inits.filter(i => i.initiative_type !== 'unassigned')

  if (realInits.length === 0) {
    return {
      goalId,
      initiativeCount: 0,
      totalCampaigns: 0,
      totalActions: 0,
      totalCompleted: 0,
      totalInProgress: 0,
      totalPending: 0,
      totalSkipped: 0,
      aggregateCompletionPct: null,
      perInitiative: [],
    }
  }

  const initIds = realInits.map(i => i.id)
  const allCampaignIds = Array.from(
    new Set(realInits.flatMap(i => i.campaign_ids ?? [])),
  )

  // 2) All actions across these initiatives
  const { data: actions, error: actionsError } = await supabase
    .from('execution_items')
    .select('initiative_id, status')
    .in('initiative_id', initIds)
  if (actionsError) {
    console.error('[strategy/initiatives] execution_items query error', actionsError)
    return null
  }

  // 3) Real campaign rows (defend against deleted campaigns leaving dead ids)
  let campaignRows: Array<{ id: string; status: string | null }> = []
  if (allCampaignIds.length > 0) {
    const { data, error } = await supabase
      .from('campaign_briefs')
      .select('id, status')
      .in('id', allCampaignIds)
    if (error) {
      console.error('[strategy/initiatives] campaign_briefs query error', error)
    } else {
      campaignRows = (data ?? []) as Array<{ id: string; status: string | null }>
    }
  }
  const realCampaignIds = new Set(campaignRows.map(c => c.id))
  const campaignStatusById = new Map(
    campaignRows.map(c => [c.id, c.status ?? 'unknown'] as const),
  )

  // 4) Per-Initiative aggregation
  const perInitiative: InitiativeExecutionSummary[] = realInits.map(init => {
    const initActions = (actions ?? []).filter(a => a.initiative_id === init.id)
    const completed   = initActions.filter(a => a.status === 'completed').length
    const inProgress  = initActions.filter(a => a.status === 'in_progress').length
    const pending     = initActions.filter(a => a.status === 'pending').length
    const skipped     = initActions.filter(a => a.status === 'skipped').length
    const total       = initActions.length

    const liveCampaignIds = (init.campaign_ids ?? []).filter(id => realCampaignIds.has(id))
    const campaignStatusCounts: Record<string, number> = {}
    for (const cid of liveCampaignIds) {
      const s = campaignStatusById.get(cid) ?? 'unknown'
      campaignStatusCounts[s] = (campaignStatusCounts[s] ?? 0) + 1
    }

    const denom = total - skipped
    const completionPct = denom > 0 ? Math.round((completed / denom) * 100) : null

    return {
      initiativeId: init.id,
      title: init.title,
      initiativeType: init.initiative_type,
      campaignCount: liveCampaignIds.length,
      campaignStatusCounts,
      totalActions: total,
      completedActions: completed,
      inProgressActions: inProgress,
      pendingActions: pending,
      skippedActions: skipped,
      completionPct,
    }
  })

  // 5) Goal-level totals
  const totalActions     = perInitiative.reduce((s, p) => s + p.totalActions, 0)
  const totalCompleted   = perInitiative.reduce((s, p) => s + p.completedActions, 0)
  const totalInProgress  = perInitiative.reduce((s, p) => s + p.inProgressActions, 0)
  const totalPending     = perInitiative.reduce((s, p) => s + p.pendingActions, 0)
  const totalSkipped     = perInitiative.reduce((s, p) => s + p.skippedActions, 0)
  const totalCampaigns   = realCampaignIds.size  // dedup across initiatives

  const aggDenom = totalActions - totalSkipped
  const aggregateCompletionPct = aggDenom > 0
    ? Math.round((totalCompleted / aggDenom) * 100)
    : null

  return {
    goalId,
    initiativeCount: realInits.length,
    totalCampaigns,
    totalActions,
    totalCompleted,
    totalInProgress,
    totalPending,
    totalSkipped,
    aggregateCompletionPct,
    perInitiative,
  }
}
