/**
 * A2.1 — CurrentValueCell tests
 *
 * Covers the 4 visual paths:
 *   1. measurement='auto'   → fetches + shows value with source label
 *   2. measurement='self_report' → shows "—" + "客户自报" hint (no fetch)
 *   3. measurement='verification' → waits for governed settlement (no fetch)
 *   4. fetch returns ok:false → shows "—" with retry link
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { CurrentValueCell } from '../CurrentValueCell'
import { GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY, type GoalRow } from '@/types/strategy'

// Silence unused-import warning while keeping React in scope for JSX
void React

function makeGoal(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: 'goal-1',
    client_id: 'client-1',
    intent: 'awareness',
    awareness_subtype: null,
    sub_type: null,
    title: 'Test goal',
    primary_metric_key: 'organic_traffic',   // auto by default
    primary_metric_label: 'Organic traffic',
    primary_metric_unit: 'sessions/mo',
    baseline_value: 1000,
    target_value: 5000,
    target_direction: 'increase',
    supporting_metrics: [],
    period_start: '2026-06-01',
    period_end: '2026-09-01',
    budget_amount: null,
    budget_currency: null,
    status: 'active',
    verdict: null,
    verdict_at: null,
    verdict_summary: null,
    fde_reasoning: null,
    is_beta: false,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    created_by: null,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CurrentValueCell', () => {
  it('shows fetched value + source for auto-measurement metrics', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        value: 3200,
        source: 'GA4 (28-day sessions)',
        snapshot_date: '2026-06-03',
        label: '3,200 sessions (6 May → 3 Jun)',
      }),
    } as Response)

    render(<CurrentValueCell goal={makeGoal({ primary_metric_key: 'organic_traffic' })} />)

    await waitFor(() => {
      expect(screen.getByText('3,200')).toBeInTheDocument()
    })
    expect(screen.getByText(/GA4 \(28-day sessions\)/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/goals/goal-1/fetch-current-value',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('shows "客户自报" hint for self_report metrics, no fetch call', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    render(<CurrentValueCell goal={makeGoal({ primary_metric_key: 'orders_count' })} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/客户自报/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for governed Verification instead of auto-fetching the GEO metric', () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    render(<CurrentValueCell goal={makeGoal({
      primary_metric_key: GEO_QUALIFIED_MENTION_GOAL_METRIC_KEY,
    })} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/受治理的 Verification/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('attempts fetch for hybrid metrics + shows "FDE 补录" hint on success', async () => {
    // hybrid bug fix per 子牙 review — leads_count (acquisition default) was
    // wrongly classified as self_report and never fetched
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        value: 12,
        source: 'GA4 form submits',
        snapshot_date: '2026-06-03',
        label: '12 form submits (May)',
      }),
    } as Response)

    render(<CurrentValueCell goal={makeGoal({ primary_metric_key: 'leads_count' })} />)

    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument()
    })
    expect(screen.getByText(/FDE 补录其他渠道/)).toBeInTheDocument()
  })

  it('shows "未识别指标" for catalog-miss keys (defensive)', async () => {
    const fetchMock = vi.spyOn(global, 'fetch')

    render(<CurrentValueCell goal={makeGoal({ primary_metric_key: 'custom_made_up_key' })} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/未识别指标/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows retry link when fetch returns ok:false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        reason: 'No GA4 snapshot found — run GA4 Sync first',
      }),
    } as Response)

    render(<CurrentValueCell goal={makeGoal({ primary_metric_key: 'organic_traffic' })} />)

    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument()
    })
    expect(screen.getByText(/未获取到/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('shows network error message when fetch throws', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'))

    render(<CurrentValueCell goal={makeGoal({ primary_metric_key: 'organic_traffic' })} />)

    await waitFor(() => {
      expect(screen.getByText(/未获取到/)).toBeInTheDocument()
    })
  })
})
