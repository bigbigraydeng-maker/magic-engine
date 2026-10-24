import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))

import { closeStaleWebIntelligenceRuns, planStaleRunCloseout, STALE_RUN_TIMEOUT_MS } from '../stale-runs'

const now = new Date('2026-10-24T00:00:00.000Z')
const old = new Date(now.getTime() - STALE_RUN_TIMEOUT_MS - 1000).toISOString()
const fresh = new Date(now.getTime() - 60_000).toISOString()

function run(overrides: Record<string, unknown> = {}) {
  return {
    status: 'reconciliation', updated_at: old, accounted_nzd: null,
    capture_claimed: true, interpretation_claimed: false, provider_run_id: null,
    capture_cost_usd: null, interpretation_cost_usd: null, capture_limit_usd: 0.1,
    error_code: 'capture_start_unknown', ...overrides,
  }
}

describe('stale web intelligence closeout', () => {
  it('charges an unknown claimed capture at the reservation ceiling and keeps the old error', () => {
    expect(planStaleRunCloseout(run(), now)).toEqual({
      action: 'close', capture_cost_usd: 0.1, interpretation_cost_usd: 0, error_code: 'stale_run_timeout:capture_start_unknown',
    })
  })

  it('uses zero cost when capture was never claimed', () => {
    expect(planStaleRunCloseout(run({ status: 'reserved', capture_claimed: false, error_code: null }), now)).toMatchObject({
      action: 'close', capture_cost_usd: 0, interpretation_cost_usd: 0, error_code: 'stale_run_timeout',
    })
  })

  it('leaves a fresh or already terminal run alone', () => {
    expect(planStaleRunCloseout(run({ updated_at: fresh }), now)).toMatchObject({ action: 'skip', reason: 'fresh' })
    expect(planStaleRunCloseout(run({ status: 'failed' }), now)).toMatchObject({ action: 'skip', reason: 'terminal' })
  })

  it('does not invent a settlement that would exceed the reservation', () => {
    expect(planStaleRunCloseout(run({ capture_cost_usd: 2, interpretation_cost_usd: 0 }), now)).toMatchObject({
      action: 'skip', reason: 'cost_would_exceed_reservation',
    })
  })

  it('treats a missing database function as unavailable instead of failing the daily runner', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'web_intelligence_close_stale_runs' } })
    await expect(closeStaleWebIntelligenceRuns('11111111-1111-4111-8111-111111111111')).resolves.toEqual({ closed: [], skipped: 0, unavailable: true })
  })
})
