import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireDashboardClientAccess, requirePaidClientAccess, requireOnboardingClientAccess } from '../client-access'
import { requireSession } from '../require-session'
import { supabaseAdmin } from '@/lib/supabase'
import type { AccessType } from '../access-types'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_CLIENT_ID = '22222222-2222-4222-8222-222222222222'
const KEYS = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'CLIENT_VIEWERS'] as const

const mockRequireSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

function mockUser(email: string) {
  mockRequireSession.mockResolvedValue({
    ok: true,
    user: { id: 'user-1', email },
  } as Awaited<ReturnType<typeof requireSession>>)
}

/**
 * Mock rows from client_portal_users. Default access_type is 'dashboard'
 * to keep legacy tests (that pre-date tier support) passing unchanged.
 */
function mockPortalRows(
  rows: Array<{ client_id: string; access_type?: AccessType }>,
  error: unknown = null,
) {
  const enriched = rows.map(r => ({
    client_id: r.client_id,
    access_type: r.access_type ?? 'dashboard',
  }))
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: enriched, error }),
  }
  mockFrom.mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
  return chain
}

describe('requireDashboardClientAccess', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.resetAllMocks()
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('returns 401 when there is no Magic Link session', async () => {
    mockRequireSession.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('allows admin emails to access any client without a DB lookup', async () => {
    process.env.ADMIN_EMAILS = 'pm@magiclab.com'
    mockUser('pm@magiclab.com')

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.role).toBe('admin')
      expect(result.tier).toBe('admin')
      expect(result.allowedClientId).toBeNull()
    }
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('allows dashboard client access from client_portal_users', async () => {
    mockUser('viewer@example.com')
    mockPortalRows([{ client_id: CLIENT_ID }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.role).toBe('client-viewer')
      expect(result.tier).toBe('paid_client')
      expect(result.allowedClientId).toBe(CLIENT_ID)
    }
  })

  it('keeps backward-compatible CLIENT_VIEWERS access', async () => {
    process.env.CLIENT_VIEWERS = `viewer@example.com:${CLIENT_ID}`
    mockUser('viewer@example.com')
    mockPortalRows([])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('paid_client')
  })

  it('returns 403 when a viewer asks for another client', async () => {
    mockUser('viewer@example.com')
    mockPortalRows([{ client_id: OTHER_CLIENT_ID }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.reason).toBe('forbidden')
    }
  })

  it('fails closed when the permission lookup fails', async () => {
    mockUser('viewer@example.com')
    mockPortalRows([], { message: 'database unavailable' })

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.reason).toBe('lookup_failed')
    }
  })

  // ── Tier mapping (Phase X.S2) ────────────────────────────────────────────────

  it('maps access_type=client to tier=paid_client', async () => {
    mockUser('paid@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'client' }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('paid_client')
  })

  it('maps access_type=fde to tier=paid_client', async () => {
    mockUser('fde@magiclab.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'fde' }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('paid_client')
  })

  it('maps access_type=both to tier=paid_client', async () => {
    mockUser('legacy@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'both' }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('paid_client')
  })

  it('maps access_type=self_serve to tier=self_serve', async () => {
    mockUser('free@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'self_serve' }])

    const result = await requireDashboardClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('self_serve')
  })
})

describe('requireOnboardingClientAccess', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.resetAllMocks()
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  // The whole point of the guard: self_serve MUST pass (unlike requirePaidClientAccess,
  // which 403s it). This is the anti-regression test for the D1 fix — if someone
  // re-tightens onboarding to paid-only, this fails.
  it('ALLOWS self_serve (the D1 fix — they must onboard their own account)', async () => {
    mockUser('free@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'self_serve' }])

    const result = await requireOnboardingClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('self_serve')
  })

  it('allows paid_client and admin too', async () => {
    mockUser('paid@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'client' }])
    const paid = await requireOnboardingClientAccess(CLIENT_ID)
    expect(paid.ok).toBe(true)
    if (paid.ok) expect(paid.tier).toBe('paid_client')

    vi.resetAllMocks()
    process.env.ADMIN_EMAILS = 'pm@magiclab.com'
    mockUser('pm@magiclab.com')
    const admin = await requireOnboardingClientAccess(CLIENT_ID)
    expect(admin.ok).toBe(true)
    if (admin.ok) expect(admin.tier).toBe('admin')
  })

  // Isolation must be identical to the dashboard guard: a self_serve user can
  // never reach ANOTHER client's onboarding routes. Guards the tenant boundary.
  it('DENIES cross-client access (isolation unchanged)', async () => {
    mockUser('free@example.com')
    mockPortalRows([{ client_id: OTHER_CLIENT_ID, access_type: 'self_serve' }])

    const result = await requireOnboardingClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.reason).toBe('forbidden')
    }
  })

  it('propagates 401 when there is no session', async () => {
    mockRequireSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const result = await requireOnboardingClientAccess(CLIENT_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('fails closed (500 lookup_failed) when the permission lookup errors', async () => {
    mockUser('free@example.com')
    mockPortalRows([], { message: 'database unavailable' })

    const result = await requireOnboardingClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.reason).toBe('lookup_failed')
    }
  })
})

describe('requirePaidClientAccess', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.resetAllMocks()
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('passes paid_client through with tier preserved', async () => {
    mockUser('paid@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'client' }])

    const result = await requirePaidClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('paid_client')
  })

  it('passes admin through with tier=admin', async () => {
    process.env.ADMIN_EMAILS = 'pm@magiclab.com'
    mockUser('pm@magiclab.com')

    const result = await requirePaidClientAccess(CLIENT_ID)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tier).toBe('admin')
  })

  it('rejects self_serve with 403 reason=paid_only', async () => {
    mockUser('free@example.com')
    mockPortalRows([{ client_id: CLIENT_ID, access_type: 'self_serve' }])

    const result = await requirePaidClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.reason).toBe('paid_only')
    }
  })

  it('propagates 401 from session check (no double-checking)', async () => {
    mockRequireSession.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    })

    const result = await requirePaidClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('propagates 403 forbidden when client_id does not match user', async () => {
    mockUser('paid@example.com')
    mockPortalRows([{ client_id: OTHER_CLIENT_ID, access_type: 'client' }])

    const result = await requirePaidClientAccess(CLIENT_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.reason).toBe('forbidden')
    }
  })
})
