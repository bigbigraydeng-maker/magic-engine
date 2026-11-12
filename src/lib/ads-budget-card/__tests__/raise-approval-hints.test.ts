import { describe, expect, it } from 'vitest'
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

  it('flags raises ready for a second confirm after kernel approval', () => {
    expect(budgetRaisePhase(baseHold, 'authorized')).toBe('awaiting_confirm')
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

  it('asks for a second confirm on the card after approval', () => {
    const line = statusLineForPhase('awaiting_confirm', baseHold)
    expect(line).toContain('再点一次')
    expect(followUpHintForPhase('awaiting_confirm')).toContain('确认')
    const overlay = overlayForPhase('awaiting_confirm', baseHold)
    expect(overlay.confirmEnabled).toBe(true)
  })
})
