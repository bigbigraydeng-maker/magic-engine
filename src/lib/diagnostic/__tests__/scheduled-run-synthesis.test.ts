/**
 * The weekly diagnostic must record the synthesis receipt in each client's outcome —
 * that is what cron_run_logs.summary (and the daily todo) read. A swallowed synthesis
 * failure used to leave no trace (2026-10-18).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { mockCreateRun, mockExecuteRun } = vi.hoisted(() => ({
  mockCreateRun: vi.fn(),
  mockExecuteRun: vi.fn(),
}))

vi.mock('../runner', () => ({
  createDiagnosticRun: mockCreateRun,
  executeDiagnosticRun: mockExecuteRun,
}))

import { runScheduledDiagnostics } from '../scheduled-run'

function makeSupabase(): SupabaseClient {
  const clients = [
    { id: 'c1', name: 'Client One', domain: 'one.example.nz', industry: 'travel' },
  ]
  return {
    from: (table: string) => {
      if (table === 'clients') {
        return { select: () => ({ eq: () => Promise.resolve({ data: clients, error: null }) }) }
      }
      if (table === 'diagnostic_runs') {
        return { select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateRun.mockResolvedValue('run-1')
})

describe('runScheduledDiagnostics — synthesis receipt', () => {
  it('copies a failed synthesis receipt into the client outcome', async () => {
    const receipt = {
      state: 'failed' as const,
      failed_modules: ['score_explanations'],
      errors: ['score_explanations: persist failed'],
      total_cost_usd: 0.4,
    }
    mockExecuteRun.mockResolvedValue(receipt)

    const summary = await runScheduledDiagnostics(makeSupabase(), new Date('2026-10-19T08:00:00Z'))

    expect(summary.outcomes).toHaveLength(1)
    expect(summary.outcomes[0]).toMatchObject({ clientId: 'c1', result: 'ran', runId: 'run-1', synthesis: receipt })
  })

  it('omits the synthesis field when no synthesis was attempted', async () => {
    mockExecuteRun.mockResolvedValue(null)

    const summary = await runScheduledDiagnostics(makeSupabase(), new Date('2026-10-19T08:00:00Z'))

    expect(summary.outcomes[0].result).toBe('ran')
    expect(summary.outcomes[0]).not.toHaveProperty('synthesis')
  })
})
