/**
 * Recheck a budget-step card immediately before the provider write.
 * The human-stop envelope does not apply this ratio. This function does.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { stepProblem } from './guard'
import { loadApprovedLock, sameLock, type PrescriptionLock } from './prescription-lock'
import { cardRaiseCapBlock, type RaiseWriteContext } from './raise-quota'
import { readStepRatio } from './ratio'
import type { StepRatio } from './types'

export function cardFields(lock: PrescriptionLock): Record<string, unknown> {
  return {
    card_prescription_id: lock.prescriptionId,
    card_version: lock.version,
    card_goal_id: lock.goalId,
    ...(lock.planId ? { card_plan_id: lock.planId } : {}),
    card_plan_hash: lock.planHash,
    card_approved_on: lock.approvedOn,
  }
}

export async function budgetCardWriteBlock(
  sb: SupabaseClient,
  clientId: string,
  input: Readonly<Record<string, unknown>>,
  currentCents: number,
  afterCents: number,
  raise?: RaiseWriteContext,
): Promise<string | null> {
  const saved = savedLock(input)
  if (saved === 'absent') return null
  if (saved === 'invalid') return '预算卡上的处方读不全，没有改。'
  const before = input.before_cents
  if (typeof before !== 'number' || !Number.isSafeInteger(before) || before <= 0) {
    return '确认时的日预算读不全，没有改。'
  }
  if (before !== currentCents) return '现日预算和确认时不一样，没有改。'
  const locked = await loadApprovedLock(sb, clientId, saved.prescriptionId)
  if (!locked.ok) return locked.reason
  if (!sameLock(saved, locked.lock)) return '处方的版本、目标或计划变了，没有改。'
  const ratio = await readStepRatio(sb, clientId, raise?.now ?? new Date())
  if (typeof ratio !== 'number') return ratioClosed(ratio)
  const step = stepProblem(currentCents, afterCents, ratio)
  if (step) return step
  if (afterCents <= currentCents) return null
  if (!raise) return '执行前的预算快照读不到，没有改。'
  if (!saved.planId) return '已批准的计划里还没有每天广告总上限，没有改。'
  const cap = await readPlanDailyTotalCap(sb, clientId, saved.planId)
  if (!cap.ok) return cap.reason
  return cardRaiseCapBlock(sb, clientId, currentCents, afterCents, raise, cap.cents)
}

function savedLock(input: Readonly<Record<string, unknown>>): PrescriptionLock | 'absent' | 'invalid' {
  if (input.card_prescription_id === undefined) return 'absent'
  const prescriptionId = text(input.card_prescription_id)
  const goalId = text(input.card_goal_id)
  const planHash = text(input.card_plan_hash)
  const approvedOn = text(input.card_approved_on)
  const version = input.card_version
  const planId = input.card_plan_id === undefined || input.card_plan_id === null ? null : text(input.card_plan_id)
  if (!prescriptionId || !goalId || !planHash || !approvedOn || planId === '') return 'invalid'
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) return 'invalid'
  return { prescriptionId, version, goalId, planId: planId ?? '', planHash, approvedOn }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function ratioClosed(ratio: Exclude<StepRatio, number>): string {
  if (ratio === 'off') return '这个客户关掉了调整日预算的确认卡，没有改。'
  if (ratio === 'invalid') return '这个客户允许的调整幅度设置无效，没有改。'
  return '允许的调整幅度读不到，没有改。'
}
