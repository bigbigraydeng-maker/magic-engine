import { describe, expect, it } from 'vitest'
import { applyBudgetRaiseOverlay } from '../raise-approval-present'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import type { BudgetHold } from '../ledger'
import {
  KERNEL_APPROVALS_PATH,
  budgetRaisePhase,
  followUpHintForPhase,
  overlayForPhase,
  statusLineForPhase,
} from '../raise-approval-hints'

const baseHold: BudgetHold = {
  kind: 'adset_daily_budget',
  status: 'awaiting',
  cardRunId: 'card-1',
  subjectKey: 'budget-set:abc',
  fingerprint: 'fp',
  orderKey: 'ok',
  order: {
    prescriptionId: 'p1',
    adsetId: '1',
    adAccountId: 'act_1',
    newDailyBudgetCents: 120,
    name: '测试组',
    expectedMetric: 'ads.account.cpa',
    direction: 'up',
    observationWindowDays: 7,
  },
  lock: {
    prescriptionId: 'p1',
    version: 1,
    goalId: 'g1',
    planId: 'plan',
    planHash: 'h',
    approvedOn: '2026-11-02',
  },
  idempotencyKey: 'key',
  beforeCents: 100,
  afterCents: 120,
  direction: 'up',
  observationWindowDays: 7,
  confirmedBy: 'fde@example.com',
  actionRunId: 'run-1',
  readbackCents: null,
  readbackMatched: null,
  writeAttempted: true,
  wroteMeta: false,
}

describe('budgetRaisePhase', () => {
  it('flags raises awaiting PM approval', () => {
    expect(budgetRaisePhase(baseHold, 'pending_approval')).toBe('awaiting_pm')
  })

  it('flags a signed raise that is still not executed', () => {
    expect(budgetRaisePhase(baseHold, 'authorized')).toBe('authorized_idle')
  })

  it('ignores cuts and holds without a linked kernel run', () => {
    const cut = { ...baseHold, afterCents: 80, order: { ...baseHold.order, newDailyBudgetCents: 80 } }
    expect(budgetRaisePhase(cut, 'pending_approval')).toBeNull()
    expect(budgetRaisePhase({ ...baseHold, actionRunId: null }, 'pending_approval')).toBeNull()
    expect(budgetRaisePhase({ ...baseHold, status: 'holding' }, 'pending_approval')).toBeNull()
  })
})

describe('raise approval copy', () => {
  it('points PM approval to kernel-approvals', () => {
    const line = statusLineForPhase('awaiting_pm', baseHold)
    expect(line).toContain('花钱负责人')
    expect(followUpHintForPhase('awaiting_pm')).toContain(KERNEL_APPROVALS_PATH)
    const overlay = overlayForPhase('awaiting_pm', baseHold)
    expect(overlay.confirmEnabled).toBe(false)
  })

  it('keeps confirm off after approval and does not promise a second click', () => {
    const line = statusLineForPhase('authorized_idle', baseHold)
    expect(line).toContain('已授权')
    expect(line).toContain('不会写 Meta')
    expect(line).not.toContain('再点一次')
    expect(followUpHintForPhase('authorized_idle')).toContain('没有')
    expect(followUpHintForPhase('authorized_idle')).not.toContain('点「确认」执行')
    const overlay = overlayForPhase('authorized_idle', baseHold)
    expect(overlay.confirmEnabled).toBe(false)
    expect(overlay.declineEnabled).toBe(false)
  })

  it('does not turn a signed card’s confirm button back on', () => {
    const overlay = overlayForPhase('authorized_idle', baseHold)
    const card: ConfirmationCardView = {
      runId: 'card-1',
      expectedDecisionId: 'd1',
      fingerprint: 'fp',
      what: '把广告组 测试组 的日预算从 1.00 调到 1.20（+20%）',
      account: '已登记的广告账户',
      amount: '从 1.00 调到 1.20（+20%）',
      date: '确认之后才改',
      scope: '只改这一个广告组的日预算',
      expiresLabel: '请在 11月12日 23:59（新西兰时间）前点。过了要重新出一张。',
      status: 'confirmed',
      statusLine: '有人 点了确认。这件事还没有开始做。',
      confirmEnabled: true,
      declineEnabled: true,
      blockedReason: null,
    }
    const shown = applyBudgetRaiseOverlay(card, overlay)
    expect(shown.confirmEnabled).toBe(false)
    expect(shown.declineEnabled).toBe(false)
    expect(shown.statusLine).toContain('停在已授权')
    expect(shown.statusLine).not.toContain('再点一次')
  })
})
