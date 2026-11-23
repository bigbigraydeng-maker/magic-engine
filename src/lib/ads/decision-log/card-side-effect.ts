/**
 * Fire-and-forget decision log attach after card execution — never throws to caller.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BudgetHold, HoldRow as BudgetRow } from '@/lib/ads-budget-card/ledger'
import type { HoldRow as PauseRow, PauseHold } from '@/lib/ads-pause-card/ledger'
import { decisionFromBudgetCard, decisionFromPauseCard } from './auto-from-card'
import { mergeDecisionOntoCardRow } from './persist'

export function attachBudgetCardDecisionLog(
  supabase: SupabaseClient,
  clientId: string,
  row: BudgetRow,
  hold: BudgetHold,
): void {
  if (hold.status !== 'executed' || !hold.wroteMeta) return
  const executedAt = new Date().toISOString()
  const decision = decisionFromBudgetCard({
    actionId: row.id,
    hold,
    confirmedEmail: hold.confirmedBy,
    executedAt,
  })
  void mergeDecisionOntoCardRow(supabase, {
    clientId,
    actionId: row.id,
    decision,
    currentPayload: row.payload as unknown as Record<string, unknown>,
  }).catch(() => undefined)
}

export function attachPauseCardDecisionLog(
  supabase: SupabaseClient,
  clientId: string,
  row: PauseRow,
  hold: PauseHold,
): void {
  if (hold.status !== 'executed' || !hold.wrote) return
  const executedAt = new Date().toISOString()
  const decision = decisionFromPauseCard({
    actionId: row.id,
    hold,
    executedAt,
  })
  void mergeDecisionOntoCardRow(supabase, {
    clientId,
    actionId: row.id,
    decision,
    currentPayload: row.payload as unknown as Record<string, unknown>,
  }).catch(() => undefined)
}
