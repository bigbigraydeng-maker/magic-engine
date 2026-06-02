/**
 * Phase 31 — Authorization helpers for goal/initiative routes
 *
 * Goal and Initiative endpoints don't have client_id in the URL — they're keyed
 * by goal_id or initiative_id. To enforce dashboard client access, we first
 * load the row to get its client_id, then delegate to requireDashboardClientAccess.
 *
 * Returns either { ok: true, ... } with the loaded row, or { ok: false, ... }
 * with an HTTP-ready error.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { GoalRow, InitiativeRow } from '@/types/strategy'

interface AuthSuccess<T> {
  ok: true
  row: T
}

interface AuthFailure {
  ok: false
  status: 401 | 403 | 404 | 500
  error: string
}

/**
 * Load a goal by id and check the caller has access to its client.
 */
export async function requireGoalAccess(
  goalId: string,
): Promise<AuthSuccess<GoalRow> | AuthFailure> {
  const { data: goal, error } = await supabaseAdmin
    .from('goals')
    .select('*')
    .eq('id', goalId)
    .maybeSingle<GoalRow>()

  if (error) {
    console.error('[strategy/auth-helpers] requireGoalAccess load error', error)
    return { ok: false, status: 500, error: 'Failed to load goal' }
  }
  if (!goal) return { ok: false, status: 404, error: 'Goal not found' }

  const access = await requireDashboardClientAccess(goal.client_id)
  if (!access.ok) return access as AuthFailure

  return { ok: true, row: goal }
}

/**
 * Load an initiative by id and check the caller has access to its client.
 */
export async function requireInitiativeAccess(
  initiativeId: string,
): Promise<AuthSuccess<InitiativeRow> | AuthFailure> {
  const { data: initiative, error } = await supabaseAdmin
    .from('initiatives')
    .select('*')
    .eq('id', initiativeId)
    .maybeSingle<InitiativeRow>()

  if (error) {
    console.error('[strategy/auth-helpers] requireInitiativeAccess load error', error)
    return { ok: false, status: 500, error: 'Failed to load initiative' }
  }
  if (!initiative) return { ok: false, status: 404, error: 'Initiative not found' }

  const access = await requireDashboardClientAccess(initiative.client_id)
  if (!access.ok) return access as AuthFailure

  return { ok: true, row: initiative }
}
