import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { requireCatalogAdmin } from '../access'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

const mockedRequireDashboardClientAccess = vi.mocked(
  requireDashboardClientAccess,
)

function makeUser(email: string | undefined) {
  return { email } as unknown as Parameters<
    typeof requireDashboardClientAccess
  > extends never
    ? never
    : { email: string | undefined }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TOUR_CATALOG_LOCAL_TEST
})

describe('requireCatalogAdmin', () => {
  it('passes through a 401 when the caller is not logged in', async () => {
    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    })

    const result = await requireCatalogAdmin('client-1')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.response.status).toBe(401)
    await expect(result.response.json()).resolves.toEqual({
      error: 'Unauthorized',
    })
  })

  it('passes through a 403 when the caller is forbidden', async () => {
    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    })

    const result = await requireCatalogAdmin('client-1')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({
      error: 'Forbidden',
    })
  })

  it('rejects a non-admin role with 403', async () => {
    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: true,
      user: makeUser('viewer@example.com') as never,
      role: 'client-viewer',
      tier: 'paid_client',
      allowedClientId: 'client-1',
    })

    const result = await requireCatalogAdmin('client-1')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.response.status).toBe(403)
    await expect(result.response.json()).resolves.toEqual({
      error: 'Forbidden',
    })
  })

  it('allows an admin and returns the email as actor', async () => {
    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: true,
      user: makeUser('admin@example.com') as never,
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    })

    const result = await requireCatalogAdmin('client-1')

    expect(result).toEqual({ ok: true, actor: 'admin@example.com' })
  })

  it("falls back to 'unknown' when the admin has no email", async () => {
    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: true,
      user: makeUser(undefined) as never,
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    })

    const result = await requireCatalogAdmin('client-1')

    expect(result).toEqual({ ok: true, actor: 'unknown' })
  })
})

// Guard rail: no environment variable may ever switch the gate off. A local-only bypass that
// gets committed by mistake turns this red in CI (design §6.8.1 item 10).
describe('requireCatalogAdmin ignores local-test environment flags', () => {
  afterEach(() => {
    delete process.env.TOUR_CATALOG_LOCAL_TEST
  })

  it('still rejects logged-out and non-admin callers when TOUR_CATALOG_LOCAL_TEST=1', async () => {
    process.env.TOUR_CATALOG_LOCAL_TEST = '1'
    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    })

    const loggedOut = await requireCatalogAdmin('client-1')

    expect(loggedOut.ok).toBe(false)
    if (loggedOut.ok) throw new Error('expected failure')
    expect(loggedOut.response.status).toBe(401)

    mockedRequireDashboardClientAccess.mockResolvedValue({
      ok: true,
      user: makeUser('viewer@example.com') as never,
      role: 'client-viewer',
      tier: 'paid_client',
      allowedClientId: 'client-1',
    })

    const viewer = await requireCatalogAdmin('client-1')

    expect(viewer.ok).toBe(false)
    if (viewer.ok) throw new Error('expected failure')
    expect(viewer.response.status).toBe(403)
  })
})
