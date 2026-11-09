/**
 * Database access for the daily-plan auto-publish *status* view.
 *
 * The PM-only "auto publish" section of the daily-plan page needs to show every
 * attempt the unattended scheduler has recorded for a plan, not just the ones a
 * human must act on. `listAttemptsNeedingAttention` in the worker store is
 * deliberately narrow (it filters to the statuses that need a human), so this
 * module adds the one read the status route needs: every attempt row for a plan
 * and client.
 *
 * Database errors are thrown, never swallowed — a status view that silently
 * reported "no attempts" when the read failed would tell a PM the scheduler had
 * done nothing when in fact it could not be checked.
 */
import { supabaseAdmin } from '@/lib/supabase'

import { type AttemptRecord } from './daily-plan-auto-publish-worker-store'

const ATTEMPTS_TABLE = 'daily_plan_auto_publish_attempts'

/**
 * Every attempt row for a plan and client, in no particular order.
 *
 * The caller sorts: the status route orders by date ascending for display, and
 * keeping the ordering decision out of the store keeps this a plain read.
 */
export async function listPlanAttempts(planId: string, clientId: string): Promise<AttemptRecord[]> {
  const { data, error } = await supabaseAdmin
    .from(ATTEMPTS_TABLE)
    .select('*')
    .eq('plan_id', planId)
    .eq('client_id', clientId)

  if (error) throw error

  return (data ?? []) as AttemptRecord[]
}
