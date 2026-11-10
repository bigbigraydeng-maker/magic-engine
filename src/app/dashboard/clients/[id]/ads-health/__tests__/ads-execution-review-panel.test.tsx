import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { AdsExecutionReviewPanel } from '../ads-execution-review-panel'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('AdsExecutionReviewPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('renders items when the API succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        panel: {
          client_id: CLIENT,
          limit: 12,
          generated_at: '2026-02-01T00:00:00.000Z',
          items: [
            {
              id: 'budget-1',
              kind: 'budget',
              kind_label: '调日预算',
              unit_label: '示例广告组',
              executed_at: '2026-01-01T00:00:00.000Z',
              executed_at_display: '2026/01/01 13:00',
              what_done: '日预算从 $50.00 调到 $40.00。',
              pending_label: '第 3 天出结论',
              verdict: null,
              verdict_label: null,
              reason: null,
              summary: null,
              metrics: null,
            },
          ],
        },
      }),
    } as Response)

    render(<AdsExecutionReviewPanel clientId={CLIENT} />)
    await waitFor(() => expect(screen.getByText('改后结论')).toBeInTheDocument())
    expect(screen.getByText('第 3 天出结论')).toBeInTheDocument()
    expect(screen.getByText(/日预算从/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no items', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        panel: { client_id: CLIENT, limit: 12, generated_at: '2026-02-01T00:00:00.000Z', items: [] },
      }),
    } as Response)

    render(<AdsExecutionReviewPanel clientId={CLIENT} />)
    await waitFor(() => expect(screen.getByText(/还没有已执行完/)).toBeInTheDocument())
  })
})
