import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOperatorAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { GET } from '../route'

const denied = { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' }
const operator = {
  ok: true,
  role: 'admin',
  tier: 'admin',
  allowedClientId: null,
  user: { id: 'u', email: 'pm@magiclab.com' },
}

function query(data: unknown[]) {
  const builder = {
    select() { return builder },
    eq() { return builder },
    order() { return builder },
    limit() { return Promise.resolve({ data, error: null }) },
  }
  return builder
}

describe('GET /memory/list', () => {
  beforeEach(() => vi.clearAllMocks())

  it('客户角色 403，不读记忆表', async () => {
    mocks.access.mockResolvedValue(denied)
    const res = await GET(new NextRequest('http://localhost/api/clients/c1/memory/list'), { params: { id: 'c1' } })
    expect(res.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('内部账号拿到四张表', async () => {
    mocks.access.mockResolvedValue(operator)
    mocks.from.mockImplementation(() => query([{ id: 'row-1' }]))
    const res = await GET(new NextRequest('http://localhost/api/clients/c1/memory/list'), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual({
      preferences: 1,
      proven_patterns: 1,
      failed_experiments: 1,
      decision_history: 1,
    })
    expect(body.preferences).toEqual([{ id: 'row-1' }])
  })
})
