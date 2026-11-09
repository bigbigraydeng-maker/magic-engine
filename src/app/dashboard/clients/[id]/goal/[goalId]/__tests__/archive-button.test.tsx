import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GoalRow, GoalStatus } from '@/types/strategy'

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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

void React

const ARCHIVE_CONFIRM = 'Archive this goal? You can no longer activate it.'

function makeGoal(status: GoalStatus, title = 'Spring campaign'): GoalRow {
  return {
    id: 'goal-1',
    client_id: 'client-1',
    intent: 'acquisition',
    awareness_subtype: null,
    sub_type: 'event_driven',
    title,
    primary_metric_key: 'leads_count',
    primary_metric_label: '新增线索/询盘',
    primary_metric_unit: 'count/mo',
    baseline_value: 20,
    target_value: 50,
    target_direction: 'increase',
    supporting_metrics: [],
    period_start: '2026-06-01',
    period_end: '2026-09-01',
    budget_amount: null,
    budget_currency: 'NZD',
    status,
    verdict: null,
    verdict_at: null,
    verdict_summary: null,
    recurrence: null,
    fde_reasoning: null,
    is_beta: true,
    current_value: null,
    current_value_fetched_at: null,
    current_value_source: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    created_by: null,
  }
}

function mockGoalFetch(goal: GoalRow) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/goals/goal-1/archive' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({ goal }) }
  }))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Goal detail archive control', () => {
  it.each([
    ['draft', true],
    ['active', true],
    ['archived', false],
    ['expired', false],
  ] as const)('status %s shows Archive=%s', async (status, visible) => {
    mockGoalFetch(makeGoal(status))
    render(<GoalDetailClient />)

    if (visible) {
      expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument()
    } else {
      await screen.findByRole('heading', { name: /Spring campaign/ })
      expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    }
  })

  it('keeps Activate and Delete on a normal draft, and only Archive on an active goal', async () => {
    mockGoalFetch(makeGoal('draft'))
    const { unmount } = render(<GoalDetailClient />)
    expect(await screen.findByRole('button', { name: 'Activate Goal' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
    unmount()

    mockGoalFetch(makeGoal('active'))
    render(<GoalDetailClient />)
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate Goal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('does not offer Archive on the migration placeholder draft', async () => {
    mockGoalFetch(makeGoal('draft', '[Migration] Unassigned Backlog'))
    render(<GoalDetailClient />)
    await screen.findByRole('heading', { name: /Unassigned Backlog/ })
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('asks the existing confirmation, then posts to the archive route', async () => {
    mockGoalFetch(makeGoal('draft'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<GoalDetailClient />)

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))

    expect(confirm).toHaveBeenCalledWith(ARCHIVE_CONFIRM)
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/goals/goal-1/archive', { method: 'POST' })
    })
  })

  it('does not post when the confirmation is declined', async () => {
    mockGoalFetch(makeGoal('draft'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<GoalDetailClient />)

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }))

    expect(fetch).not.toHaveBeenCalledWith('/api/goals/goal-1/archive', { method: 'POST' })
  })
})
