import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  assemble: vi.fn(),
  conduct: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.access }))
vi.mock('@/lib/zhuge/assembler', () => ({ assembleZhugeInput: mocks.assemble }))
vi.mock('@/lib/zhuge/conductor', () => ({ conductPriorityActions: mocks.conduct }))
vi.mock('@/lib/zhuge/action-persister', () => ({ persistZhugeActions: vi.fn() }))
vi.mock('@/lib/zhuge/memory-loader', () => ({
  loadIndustryBenchmarkSummary: vi.fn(async () => ''),
  loadZhugeFeedbackSummary: vi.fn(async () => ''),
}))
vi.mock('@/lib/memory', () => ({ loadMemoryForClient: vi.fn(async () => ({})) }))

import { POST } from '../route'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'

function post(body: unknown) {
  return POST(
    new Request(`http://localhost/api/clients/${CLIENT}/zhuge/conduct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: { id: CLIENT } },
  )
}

describe('conduct cannot bypass a confirmation card', () => {
  beforeEach(() => {
    mocks.access.mockResolvedValue({
      ok: true,
      user: { email: 'opc@example.com' },
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    })
    mocks.assemble.mockReset()
    mocks.assemble.mockRejectedValue(new Error('CLIENT_NOT_FOUND'))
    mocks.conduct.mockReset()
  })

  it('refuses a spend sentence before the suggestion chain runs', async () => {
    const res = await post({ businessContext: { goals: '开投' } })
    const body = await res.json() as { error?: string }
    expect(res.status).toBe(409)
    expect(body.error).toContain('确认卡')
    expect(mocks.assemble).not.toHaveBeenCalled()
    expect(mocks.conduct).not.toHaveBeenCalled()
  })

  it('still runs the suggestion chain for an ordinary body', async () => {
    const res = await post({})
    expect(res.status).toBe(404)
    expect(mocks.assemble).toHaveBeenCalledTimes(1)
    expect(mocks.conduct).not.toHaveBeenCalled()
  })
})
