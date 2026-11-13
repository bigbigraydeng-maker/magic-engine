import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { overlayForPhase } from '@/lib/ads-budget-card/raise-approval-hints'
import type { BudgetHold } from '@/lib/ads-budget-card/ledger'
import { ConfirmationCard } from '../ConfirmationCard'

const base = {
  what: '记下要不要调每周预算',
  account: '测试广告账户',
  amount: '每天一百新西兰元',
  date: '下周一',
  scope: '只记这一张卡，不改广告',
  expiresLabel: '请在 10月27日 13:30（新西兰时间）前点。过了要重新出一张。',
  statusLine: '还没人点。',
  onConfirm: vi.fn(),
  onDecline: vi.fn(),
}

describe('ConfirmationCard', () => {
  it('shows the plain facts and only the two buttons', () => {
    render(<ConfirmationCard {...base} confirmEnabled declineEnabled blockedReason={null} />)
    expect(screen.getByText('记下要不要调每周预算')).toBeInTheDocument()
    expect(screen.getByText('测试广告账户')).toBeInTheDocument()
    expect(screen.getAllByText('每天一百新西兰元').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('确认时会再核对一次，条件不成立就拒绝。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '不做' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /^(确认|不做)$/ })).toHaveLength(2)
    expect(document.body.textContent ?? '').not.toContain('{')
    expect(document.body.textContent ?? '').not.toMatch(/[0-9a-f]{64}/)
  })

  it('greys out confirm and shows the reason when a hard check failed', () => {
    render(
      <ConfirmationCard
        {...base}
        confirmEnabled={false}
        declineEnabled
        blockedReason="花费：已经超了今天的上限"
      />,
    )
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '不做' })).toBeEnabled()
    expect(screen.getByText('花费：已经超了今天的上限')).toBeInTheDocument()
  })

  it('keeps confirm disabled for a signed budget raise and shows the idle copy', () => {
    const hold = {
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
    } as BudgetHold
    const overlay = overlayForPhase('authorized_idle', hold)
    render(
      <ConfirmationCard
        {...base}
        status="confirmed"
        statusLine={overlay.statusLine}
        followUpHint={overlay.followUpHint}
        confirmEnabled={overlay.confirmEnabled}
        declineEnabled={overlay.declineEnabled}
        blockedReason={null}
      />,
    )
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '不做' })).toBeDisabled()
    expect(screen.getByText(/停在已授权/)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain('再点一次')
  })
})
