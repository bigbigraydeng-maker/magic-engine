import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequire = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: (...a: unknown[]) => mockRequire(...a),
}))

const tables: string[] = []
const clientsUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
const fdeInsert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) })
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      tables.push(table)
      if (table === 'clients') return { update: clientsUpdate }
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
    tables.length = 0
    mockRequire.mockResolvedValue({ ok: true, user: { email: 'owner@shop.co.nz' } })
  })

  it('403s when access is denied (self_serve isolation upheld)', async () => {
    mockRequire.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await POST(req({}), { params: { id: 'c1' } })
    expect(res.status).toBe(403)
    expect(clientsUpdate).not.toHaveBeenCalled()
  })

  it('stamps completion and does not start a diagnostic', async () => {
    const res = await POST(req({ helpRequests: [] }), { params: { id: 'c1' } })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.diagnostic_run_id).toBeNull()
    expect(tables).not.toContain('diagnostic_runs')
    expect(clientsUpdate).toHaveBeenCalledWith(expect.objectContaining({ onboarding_completed_at: expect.any(String) }))
  })

  it('records a help request to the FDE log when steps are skipped', async () => {
    await POST(req({ helpRequests: ['Google Business Profile — connect on visit'] }), { params: { id: 'c1' } })
    expect(fdeInsert).toHaveBeenCalledWith(expect.objectContaining({
      client_id: 'c1',
      summary: expect.stringContaining('Google Business Profile'),
    }))
  })
})
