import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  requireGlobalAdmin: vi.fn(),
  resolveCustomerId: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/auth/require-admin', () => ({
  requireGlobalAdmin: mocks.requireGlobalAdmin,
}))

vi.mock('@/lib/google-ads/creds-loader', () => ({
  resolveCustomerId: mocks.resolveCustomerId,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { GET, PATCH } from '../route'

const CLIENT_ID = 'client-abc'

function routeContext() {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/google-ads-customer-id`)
}

function makePatchRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/google-ads-customer-id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
  mocks.requireGlobalAdmin.mockResolvedValue({ ok: true, user: { email: 'staff@test.com' } })
})

describe('GET /api/clients/[id]/google-ads-customer-id', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('delegates to resolveCustomerId and returns its result verbatim (value + source)', async () => {
    mocks.resolveCustomerId.mockResolvedValue({ customer_id: '1234567890', source: 'clients_table' })
    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body).toEqual({ customer_id: '1234567890', source: 'clients_table' })
    expect(mocks.resolveCustomerId).toHaveBeenCalledWith(expect.anything(), CLIENT_ID)
  })
})

/**
 * `clients` stub for PATCH: the duplicate lookup (`select().eq().neq()`) and the
 * write (`update().eq()`).
 */
function clientsTable(opts: {
  otherHolders?: Array<{ id: string }>
  holdersError?: { message: string } | null
  updateError?: { message: string } | null
} = {}) {
  const eq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null })
  const update = vi.fn().mockReturnValue({ eq })
  const neq = vi.fn().mockResolvedValue({ data: opts.otherHolders ?? [], error: opts.holdersError ?? null })
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ neq }) })
  mocks.from.mockReturnValue({ update, select })
  return { update, eq, neq }
}

describe('PATCH /api/clients/[id]/google-ads-customer-id', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())
    expect(res.status).toBe(401)
  })

  it('is internal-staff-only: dashboard access to the client is not enough', async () => {
    // The stored id is the tenant boundary for every Google Ads call. A client
    // user, or a demo/scoped admin of this one client, passes the dashboard
    // check and is still refused — requireGlobalAdmin is the gate.
    mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await PATCH(makePatchRequest({ customer_id: '9999999999' }), routeContext())
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('Magic Lab')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('refuses an account already registered to another client', async () => {
    const { update, neq } = clientsTable({ otherHolders: [{ id: 'another-client' }] })
    const res = await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())
    expect(res.status).toBe(409)
    expect(neq).toHaveBeenCalledWith('id', CLIENT_ID)
    expect(update).not.toHaveBeenCalled()
  })

  it('does not write when the duplicate lookup fails', async () => {
    const { update } = clientsTable({ holdersError: { message: 'lookup down' } })
    const res = await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())
    expect(res.status).toBe(500)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects a customer_id that is not 10 digits', async () => {
    const res = await PATCH(makePatchRequest({ customer_id: '12345' }), routeContext())
    expect(res.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects more than 10 digits', async () => {
    const res = await PATCH(makePatchRequest({ customer_id: '123456789012' }), routeContext())
    expect(res.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only string as clearing the binding (not a validation error)', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) })

    const res = await PATCH(makePatchRequest({ customer_id: '   ' }), routeContext())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, customer_id: null })
  })

  it('treats a dashes-only string as clearing the binding, not as 10 zero-width digits', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) })

    const res = await PATCH(makePatchRequest({ customer_id: '---' }), routeContext())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, customer_id: null })
  })

  it('rejects non-string, non-null customer_id (e.g. a number from a sloppy caller)', async () => {
    const res = await PATCH(makePatchRequest({ customer_id: 1234567890 }), routeContext())
    expect(res.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('strips dashes/spaces before validating (accepts 123-456-7890 form)', async () => {
    clientsTable()

    const res = await PATCH(makePatchRequest({ customer_id: '123-456-7890' }), routeContext())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, customer_id: '1234567890' })
  })

  it('clears the binding when customer_id is empty/null', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    mocks.from.mockReturnValue({ update })

    const res = await PATCH(makePatchRequest({ customer_id: null }), routeContext())

    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ google_ads_customer_id: null })
  })

  it('writes the normalised value to clients.google_ads_customer_id', async () => {
    const { update, eq } = clientsTable()

    await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())

    expect(mocks.from).toHaveBeenCalledWith('clients')
    expect(update).toHaveBeenCalledWith({ google_ads_customer_id: '1234567890' })
    expect(eq).toHaveBeenCalledWith('id', CLIENT_ID)
  })

  it('returns 500 with a clear message when the DB write fails', async () => {
    clientsTable({ updateError: { message: 'db timeout' } })

    const res = await PATCH(makePatchRequest({ customer_id: '1234567890' }), routeContext())

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('db timeout')
  })
})
