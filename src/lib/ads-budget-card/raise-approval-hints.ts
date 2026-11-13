/**
 * Copy-only helpers for a budget raise that is waiting on spend approval,
 * or already signed and still not executed.
 * Detection uses flywheel_actions hold status + linked action_run status only.
 * This file never enables the confirm button.
 */

import { clipName, money } from './copy'
import type { BudgetHold } from './ledger'

export const KERNEL_APPROVALS_PATH = '/dashboard/kernel-approvals'

export type BudgetRaisePhase = 'awaiting_pm' | 'authorized_idle'

export function isBudgetRaiseHold(payload: BudgetHold): boolean {
  return payload.kind === 'adset_daily_budget' && payload.afterCents > payload.beforeCents
}

export function budgetRaisePhase(
  hold: BudgetHold,
  actionRunStatus: string | null,
): BudgetRaisePhase | null {
  if (hold.status !== 'awaiting' || !isBudgetRaiseHold(hold) || !hold.actionRunId) return null
  if (actionRunStatus === 'pending_approval') return 'awaiting_pm'
  if (actionRunStatus === 'authorized') return 'authorized_idle'
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
    return `你已确认加预算（${who}，${amt}）。还差花钱负责人到「等你点头的动作」页点同意。点同意只签成已授权，不会改 Meta。`
  }
  return `花钱负责人已点同意（${who}，${amt}）。这条加预算停在已授权，日预算没有改。确认按钮不可点：再提交也只返回「已经批准或正在处理，不要重新提交」，不会写 Meta。`
}

export function followUpHintForPhase(phase: BudgetRaisePhase): string {
  if (phase === 'awaiting_pm') {
    return `下一步：打开 ${KERNEL_APPROVALS_PATH}，找到这条加广告组日预算并点同意。同意之后日预算仍不会改。`
  }
  return '目前没有从这张卡或「等你点头的动作」页继续执行的入口。不要把这一步当成还要点一次确认。'
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
    confirmEnabled: false,
    declineEnabled: false,
  }
}
