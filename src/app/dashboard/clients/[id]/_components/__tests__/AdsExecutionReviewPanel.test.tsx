import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { AdsExecutionReviewPanel } from '../AdsExecutionReviewPanel'

const CLIENT = 'c0000000-0000-0000-0000-000000000002'

describe('AdsExecutionReviewPanel', () => {
  it('renders empty state when there are no executed cards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        panel: { client_id: CLIENT, limit: 15, generated_at: '2026-11-10T00:00:00.000Z', items: [] },
      }),
    }))

    render(<AdsExecutionReviewPanel clientId={CLIENT} />)
    await waitFor(() => {
      expect(screen.getByText(/还没有已执行的调预算或暂停记录/)).toBeTruthy()
    })
    vi.unstubAllGlobals()
  })
})
