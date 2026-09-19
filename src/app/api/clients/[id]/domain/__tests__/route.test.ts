/**
 * AD-SEC-4 — the onboarding domain route must not let a client member pick a
 * domain that has a staff-provisioned Meta token (another client's, or one whose
 * client moved away): the domain decides which token getMetaTokenForClient uses.
 * Every other domain keeps working for self-serve onboarding.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireOnboardingClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))
const { update } = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      update: (payload: unknown) => {
        update(payload)
        const chain = { eq: () => chain, select: () => chain, single: async () => ({ data: { id: 'c1', ...(payload as object) }, error: null }) }
        return chain
      },
    }),
  },
}))

import { PATCH } from '../route'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'

const mockMember = vi.mocked(requireOnboardingClientAccess)
const mockStaff = vi.mocked(requireGlobalAdmin)
const TOKEN_VAR = 'META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ'
let saved: string | undefined

const req = (domain: unknown) =>
  new NextRequest('http://localhost:3001/api/clients/c1/domain', {
    method: 'PATCH', body: JSON.stringify({ domain }), headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  saved = process.env[TOKEN_VAR]
  process.env[TOKEN_VAR] = 'cts-token'
  mockMember.mockResolvedValue({ ok: true, user: { email: 'owner@newclient.example' } } as never)
  mockStaff.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
})

afterEach(() => {
  if (saved === undefined) delete process.env[TOKEN_VAR]
  else process.env[TOKEN_VAR] = saved
  vi.clearAllMocks()
})

describe('domain — reserved (token-carrying) domains', () => {
  it.each(['ctstours.co.nz', 'https://www.CTSTOURS.co.nz/tours'])('client member setting %j → 409, nothing written', async (domain) => {
    const res = await PATCH(req(domain), { params: { id: 'c1' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'domain_reserved' })
    expect(update).not.toHaveBeenCalled()
  })

  it('internal staff may set it', async () => {
    mockStaff.mockResolvedValue({ ok: true, user: { email: 'fde@magiclab.example' } } as never)
    const res = await PATCH(req('ctstours.co.nz'), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ domain: 'ctstours.co.nz' })
  })

  it('an ordinary domain is unaffected and does not even ask whether the caller is staff', async () => {
    const res = await PATCH(req('newclient.co.nz'), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ domain: 'newclient.co.nz' })
    expect(mockStaff).not.toHaveBeenCalled()
  })
})
