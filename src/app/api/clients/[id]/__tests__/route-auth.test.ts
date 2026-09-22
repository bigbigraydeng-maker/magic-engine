/**
 * AD-SEC-4 — client-row writes that decide Meta token ownership are internal
 * staff only. `guardAdmin` let DEMO_ADMINS (scoped to one client) rename,
 * re-domain or delete ANY client, and POST /api/clients had no auth at all while
 * creating staff-created ('fde') rows — the rows that own a domain's token.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: vi.fn(), guardAdmin: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions: vi.fn() }))
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from } }))

import { PATCH, DELETE } from '../route'
import { POST } from '../../route'
import { guardGlobalAdmin, guardAdmin } from '@/lib/auth/require-admin'

const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })
const body = (b: unknown) =>
  new NextRequest('http://localhost:3001/api/clients', { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } })

afterEach(() => vi.clearAllMocks())

describe('non-staff (incl. scoped DEMO admins) cannot write client rows', () => {
  it('PATCH /api/clients/[id] (name / domain / billing) → 403, nothing written', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(forbidden())
    vi.mocked(guardAdmin).mockResolvedValue(null) // would have passed the old guard
    const res = await PATCH(body({ domain: 'ctstours.co.nz' }), { params: { id: 'other-client' } })
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('DELETE /api/clients/[id] → 403, nothing deleted', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(forbidden())
    vi.mocked(guardAdmin).mockResolvedValue(null)
    const res = await DELETE(body({}), { params: { id: 'other-client' } })
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('POST /api/clients (anonymous) → 403, no client row created', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const res = await POST(body({ name: 'Squatter', domain: 'ctstours.co.nz' }))
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })
})
