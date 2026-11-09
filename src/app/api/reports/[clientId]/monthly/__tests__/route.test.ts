import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/reports/monthly-aggregator', () => ({ buildMonthlyReport: vi.fn() }))

import { GET } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { buildMonthlyReport } from '@/lib/reports/monthly-aggregator'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockBuild = vi.mocked(buildMonthlyReport)

const CLIENT = '00000000-0000-0000-0000-000000000099'

describe('GET /api/reports/[clientId]/monthly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccess.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'fde@test.com' } as never,
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    })
    mockBuild.mockResolvedValue({
      client_id: CLIENT,
      period_scope_note: 'x',
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects unauthenticated access before building the report', async () => {
    mockAccess.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    })
    const res = await GET(new NextRequest('http://x'), { params: { clientId: CLIENT } })
    expect(res.status).toBe(401)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('returns report when client access passes', async () => {
    const res = await GET(new NextRequest('http://x'), { params: { clientId: CLIENT } })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT)
    expect(mockBuild).toHaveBeenCalledWith(CLIENT)
  })
})
