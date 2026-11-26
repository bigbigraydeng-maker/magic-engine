/**
 * Adjustment memory — turns a confirmed promo adjustment into a client_decision_history row,
 * and maps the recheck result onto that row's outcome verdict.
 *
 * Client-private memory only: nothing here writes global_learned_lessons. Promotion to the
 * cross-client pool stays a separate, human-triggered path through write-lesson.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdjustDecision, PromoAdjustmentRecord, RecheckResult } from '@/lib/marketing-plan/types'
import { updateDecisionOutcome } from './service'
import type { DecisionHistory, OutcomeVerdict } from './types'

const DECISION_LABEL_ZH: Record<AdjustDecision, string> = {
  fix_data: '补数据',
  fix_execution: '补执行',
  revise_prescription: '改处方',
  continue: '继续',
}

const ALL_DECISIONS: AdjustDecision[] = ['fix_data', 'fix_execution', 'revise_prescription', 'continue']

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

export function recheckResultToVerdict(result: RecheckResult): OutcomeVerdict {
  if (result === 'improved') return 'success'
  if (result === 'worse') return 'failure'
  return 'inconclusive'
}

function rowSummary(rows: PromoAdjustmentRecord['trigger']['rows']): string {
  if (rows.length === 0) return '无对账行'
  return rows.map(r => `${r.key}:${r.status}`).join('、')
}

async function findExisting(
  supabase: SupabaseClient,
  clientId: string,
  goalId: string,
  adjustmentId: string,
): Promise<DecisionHistory | null> {
  const { data, error } = await supabase
    .from('client_decision_history')
    .select('*')
    .eq('client_id', clientId)
    .eq('source_kind', 'promo_adjustment')
    .eq('goal_id', goalId)
  if (error) return null
  const rows = (data ?? []) as DecisionHistory[]
  return rows.find(r => r.source_ref?.adjustment_id === adjustmentId) ?? null
}

/**
 * Idempotent: writing the same adjustment twice returns the first row.
 * Returns null when the record is not confirmed yet or the write fails.
 */
export async function saveAdjustmentDecision(
  supabase: SupabaseClient,
  clientId: string,
  rec: PromoAdjustmentRecord,
  planId: string,
): Promise<DecisionHistory | null> {
  if (!rec.decision) return null

  const existing = await findExisting(supabase, clientId, rec.goal_id, rec.id)
  if (existing) return existing

  const reasons = [...rec.suggestion_reasons]
  if (rec.override_reason) reasons.push(`人工改判：${rec.override_reason}`)

  const { data, error } = await supabase
    .from('client_decision_history')
    .insert({
      client_id: clientId,
      decision_context: `窗口 ${rec.window.start}～${rec.window.end}，对账：${rowSummary(rec.trigger.rows)}`,
      chosen_action: DECISION_LABEL_ZH[rec.decision],
      alternatives_rejected: ALL_DECISIONS.filter(d => d !== rec.decision).map(d => DECISION_LABEL_ZH[d]),
      reasoning: reasons.join('；') || '无',
      source_kind: 'promo_adjustment',
      source_ref: {
        plan_id: planId,
        adjustment_id: rec.id,
        goal_id: rec.goal_id,
        window_start: rec.window.start,
      },
      goal_id: rec.goal_id,
    })
    .select()
    .single()

  if (error) {
    const code = (error as { code?: string }).code
    if (code === UNIQUE_VIOLATION) return findExisting(supabase, clientId, rec.goal_id, rec.id)
    console.error('[memory] saveAdjustmentDecision error:', error.message)
    return null
  }
  return data as DecisionHistory
}

/** Writes the recheck verdict back onto the memory row (success / failure / inconclusive). */
export async function recordAdjustmentOutcome(
  supabase: SupabaseClient,
  decisionHistoryId: string,
  recheck: NonNullable<PromoAdjustmentRecord['recheck']>,
): Promise<OutcomeVerdict> {
  const verdict = recheckResultToVerdict(recheck.result)
  await updateDecisionOutcome(
    supabase,
    decisionHistoryId,
    verdict,
    `复检 ${recheck.at.slice(0, 10)}：${rowSummary(recheck.rows)}`,
  )
  return verdict
}
