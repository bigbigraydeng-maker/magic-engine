import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequire = vi.fn()
const mockCreateRun = vi.fn()
const mockExecuteRun = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: (...a: unknown[]) => mockRequire(...a),
}))
vi.mock('@/lib/diagnostic/runner', () => ({
  createDiagnosticRun: (...a: unknown[]) => mockCreateRun(...a),
  executeDiagnosticRun: (...a: unknown[]) => mockExecuteRun(...a),
}))

// Supabase mock: diagnostic_runs in-flight lookup + clients select/update + fde log insert.
let inFlight: { id: string } | null = null
let clientRow: { onboarding_completed_at: string | null } | null = { onboarding_completed_at: null }
const clientsSelect = vi.fn().mockImplementation(() => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: clientRow, error: null }) }) }))
const clientsUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
const fdeInsert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) })
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'diagnostic_runs') {
        return { select: () => ({ eq: () => ({ in: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: inFlight, error: null }) }) }) }) }) }
      }
      if (table === 'clients') return { select: clientsSelect, update: clientsUpdate }
      if (table === 'fde_work_logs') return { insert: fdeInsert }
      return {}
    },
  },
}))

import { POST } from '../route'

function req(body: unknown) {
  return { json: () => Promise.resolve(body) } as unknown as import('next/server').NextRequest
}

describe('POST /api/clients/[id]/onboarding/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inFlight = null
    clientRow = { onboarding_completed_at: null }
    mockRequire.mockResolvedValue({ ok: true, user: { email: 'owner@shop.co.nz' } })
    mockCreateRun.mockResolvedValue('run-1')
    mockExecuteRun.mockResolvedValue(undefined)
  })

  it('403s when access is denied (self_serve isolation upheld)', async () => {
    mockRequire.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await POST(req({}), { params: { id: 'c1' } })
    expect(res.status).toBe(403)
    expect(mockCreateRun).not.toHaveBeenCalled()
  })

  it('triggers the baseline diagnostic + stamps completion on first submit', async () => {
    const res = await POST(req({ helpRequests: [] }), { params: { id: 'c1' } })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mockCreateRun).toHaveBeenCalledOnce()
    expect(clientsUpdate).toHaveBeenCalledWith(expect.objectContaining({ onboarding_completed_at: expect.any(String) }))
  })

  it('does NOT start a second diagnostic when one is already in flight (dedup)', async () => {
    inFlight = { id: 'existing-run' }
    const res = await POST(req({}), { params: { id: 'c1' } })
    const json = await res.json()
    expect(json.diagnostic_run_id).toBe('existing-run')
    expect(mockCreateRun).not.toHaveBeenCalled() // <-- anti cost-DoS on resubmit
  })

  it('does NOT start a new diagnostic on a sequential resubmit after onboarding already completed once', async () => {
    // The first run finished (status flipped to 'completed'/'failed'), so it no
    // longer shows up as in-flight — only clients.onboarding_completed_at proves
    // this client already had its one free baseline run. A naive in-flight-only
    // dedup would re-trigger a full-price diagnostic here (P0 caught by 魏征).
    clientRow = { onboarding_completed_at: '2026-07-01T00:00:00.000Z' }
    const res = await POST(req({}), { params: { id: 'c1' } })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.diagnostic_run_id).toBeNull()
    expect(mockCreateRun).not.toHaveBeenCalled() // <-- anti cost-DoS on sequential replay
  })

  it('records a help request to the FDE log when steps are skipped', async () => {
    await POST(req({ helpRequests: ['Google Business Profile — connect on visit'] }), { params: { id: 'c1' } })
    expect(fdeInsert).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'c1',
      summary: expect.stringContaining('Google Business Profile'),
    }))
  })
})
