/**
 * Copy-only helpers for budget **raises** that need PM spend approval, then a second confirm on the card.
 * Detection uses flywheel_actions hold status + linked action_run status only.
 */

import { clipName, money } from './copy'
import type { BudgetHold } from './ledger'

export const KERNEL_APPROVALS_PATH = '/dashboard/kernel-approvals'

export type BudgetRaisePhase = 'awaiting_pm' | 'awaiting_confirm'

export function isBudgetRaiseHold(payload: BudgetHold): boolean {
  return payload.kind === 'adset_daily_budget' && payload.afterCents > payload.beforeCents
}

export function budgetRaisePhase(
  hold: BudgetHold,
  actionRunStatus: string | null,
): BudgetRaisePhase | null {
  if (hold.status !== 'awaiting' || !isBudgetRaiseHold(hold) || !hold.actionRunId) return null
  if (actionRunStatus === 'pending_approval') return 'awaiting_pm'
  if (actionRunStatus === 'authorized') return 'awaiting_confirm'
  return null
}

export function raiseAdsetLabel(hold: BudgetHold): string {
  const name = clipName(hold.order.name)
  return name
}

export function raiseAmountPhrase(hold: BudgetHold): string {
  return `${money(hold.beforeCents)} 调到 ${money(hold.afterCents)}`
}

export function statusLineForPhase(phase: BudgetRaisePhase, hold: BudgetHold): string {
  const who = raiseAdsetLabel(hold)
  const amt = raiseAmountPhrase(hold)
  if (phase === 'awaiting_pm') {
    return `你已确认加预算（${who}，${amt}）。现在还差花钱负责人到「等你点头的动作」页批准，批准后不会自动改 Meta。`
  }
  return `花钱负责人已批准加预算（${who}，${amt}）。请回到这张卡再点一次「确认」，才会真正改日预算。`
}

export function followUpHintForPhase(phase: BudgetRaisePhase): string {
  if (phase === 'awaiting_pm') {
    return `下一步：打开 ${KERNEL_APPROVALS_PATH}，找到这条「加广告组日预算」并点同意。`
  }
  return '下一步：就在本页点「确认」执行（不是去等你点头的动作页）。'
}

export interface BudgetRaiseCardOverlay {
  readonly phase: BudgetRaisePhase
  readonly statusLine: string
  readonly followUpHint: string
  readonly followUpHref: string | null
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
}

export function overlayForPhase(phase: BudgetRaisePhase, hold: BudgetHold): BudgetRaiseCardOverlay {
  return {
    phase,
    statusLine: statusLineForPhase(phase, hold),
    followUpHint: followUpHintForPhase(phase),
    followUpHref: phase === 'awaiting_pm' ? KERNEL_APPROVALS_PATH : null,
    confirmEnabled: phase === 'awaiting_confirm',
    declineEnabled: false,
  }
}
