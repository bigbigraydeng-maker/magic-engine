import { describe, it, expect, vi, beforeEach } from 'vitest'
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
