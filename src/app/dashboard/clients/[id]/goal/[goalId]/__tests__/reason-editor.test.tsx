import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GoalRow } from '@/types/strategy'

void React

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: 'client-1', goalId: 'goal-1' }),
}))

vi.mock('../_components/InitiativeList', () => ({ InitiativeList: () => null }))
vi.mock('../_components/BacklogMigrator', () => ({ BacklogMigrator: () => null }))
vi.mock('../_components/VerdictPanel', () => ({ VerdictPanel: () => null }))
vi.mock('../_components/ExecutionSummaryBar', () => ({ ExecutionSummaryBar: () => null }))
vi.mock('../_components/CurrentValueCell', () => ({ CurrentValueCell: () => null }))

import { GoalDetailClient } from '../_client'

function makeGoal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: 'goal-1',
    client_id: 'client-1',
    intent: 'sales',
    awareness_subtype: null,
    sub_type: null,
    title: '三月成交',
    primary_metric_key: 'signups_count',
    primary_metric_label: '报名/预订数',
    primary_metric_unit: 'count',
    baseline_value: 0,
    target_value: 4,
    target_direction: 'increase',
    supporting_metrics: [],
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    budget_amount: null,
    budget_currency: 'AUD',
    status: 'draft',
    verdict: null,
    verdict_at: null,
    verdict_summary: null,
    recurrence: null,
    fde_reasoning: null,
    is_beta: true,
    current_value: null,
    current_value_fetched_at: null,
    current_value_source: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    created_by: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('draft reason editor', () => {
  it('lets a refused draft save a reason in place', async () => {
    const goal = makeGoal()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ goal }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ goal: { ...goal, fde_reasoning: '本周期以成交笔数验收，不拿点击当结果。' } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<GoalDetailClient />)
    const box = await screen.findByRole('textbox', { name: '理由（必填）' })
    expect(screen.getByRole('button', { name: '保存理由' })).toBeDisabled()

    fireEvent.change(box, { target: { value: '本周期以成交笔数验收，不拿点击当结果。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存理由' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/goals/goal-1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ fde_reasoning: '本周期以成交笔数验收，不拿点击当结果。' }),
      }))
    })
  })

  it('keeps the reason read-only after the goal leaves draft', async () => {
    const goal = makeGoal({
      status: 'active',
      fde_reasoning: '本周期以成交笔数验收，不拿点击当结果。',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ goal }),
    }))

    render(<GoalDetailClient />)
    expect(await screen.findByText('本周期以成交笔数验收，不拿点击当结果。')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '理由（必填）' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存理由' })).toBeNull()
  })
})
