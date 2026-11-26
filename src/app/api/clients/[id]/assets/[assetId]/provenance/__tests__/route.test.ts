import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { PATCH } from '../route'

const CLIENT_ID = 'client-abc'
const ASSET_ID = 'asset-1'
const ctx = { params: { id: CLIENT_ID, assetId: ASSET_ID } }

const posterMeta = {
  poster: {
    recipe_id: 'tour_poster_v1',
    recipe_version: 1,
    source_asset_id: 'a1b2c3d4-0000-4000-8000-000000000001',
    has_price: true,
    text_lines: ['X'],
    cost_usd: 0.038,
    provider_request_id: null,
    created_at: '2026-11-15T00:00:00.000Z',
  },
}

interface Call { op: string; args: unknown[] }

/**
 * Supabase fake for the two chains this route runs, enumerated (穷举) from route.ts:
 *   read:   from → select → eq → eq → maybeSingle
 *   update: from → update → eq → eq → select → single
 * Every call is recorded so the test checks the client_id scope and the update payload.
 */
function installDb(readRow: unknown, calls: Call[]) {
  mocks.from.mockImplementation((table: string) => {
    calls.push({ op: 'from', args: [table] })
    const b = {
      select: (...args: unknown[]) => { calls.push({ op: 'select', args }); return b },
      eq: (...args: unknown[]) => { calls.push({ op: 'eq', args }); return b },
      update: (...args: unknown[]) => { calls.push({ op: 'update', args }); return b },
      maybeSingle: async () => ({ data: readRow, error: null }),
      single: async () => ({ data: { id: ASSET_ID, source: 'ai_generated' }, error: null }),
    }
    return b
  })
}

function patch(body: unknown) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/assets/${ASSET_ID}/provenance`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDashboardClientAccess.mockResolvedValue({
    ok: true, user: { email: 'fde@me.test' }, role: 'admin', tier: 'admin', allowedClientId: null,
  })
})

describe('PATCH provenance — poster sign-off', () => {
  it('non-admin is refused before any DB access', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true, user: { email: 'c@x' }, role: 'client-viewer', tier: 'paid_client', allowedClientId: CLIENT_ID,
    })
    const res = await PATCH(patch({ action: 'confirm_poster' }), ctx)
    expect(res.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('unknown action → 400, no DB access', async () => {
    const res = await PATCH(patch({ action: 'approve' }), ctx)
    expect(res.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('asset without poster lineage → 400, nothing updated', async () => {
    const calls: Call[] = []
    installDb({ id: ASSET_ID, vision_metadata: { scene: 'x' } }, calls)
    const res = await PATCH(patch({ action: 'confirm_poster' }), ctx)
    expect(res.status).toBe(400)
    expect(calls.some((c) => c.op === 'update')).toBe(false)
  })

  it('missing asset → 404', async () => {
    installDb(null, [])
    const res = await PATCH(patch({ action: 'confirm_poster' }), ctx)
    expect(res.status).toBe(404)
  })

  it('confirm_poster signs with the admin email and never touches source; scoped to client', async () => {
    const calls: Call[] = []
    installDb({ id: ASSET_ID, vision_metadata: posterMeta }, calls)
    const res = await PATCH(patch({ action: 'confirm_poster' }), ctx)
    expect(res.status).toBe(200)
    const update = calls.find((c) => c.op === 'update')?.args[0] as Record<string, unknown>
    expect(update.verified_by).toBe('fde@me.test')
    expect(typeof update.verified_at).toBe('string')
    expect('source' in update).toBe(false)
    expect(calls.filter((c) => c.op === 'eq').map((c) => c.args)).toEqual([
      ['id', ASSET_ID], ['client_id', CLIENT_ID], ['id', ASSET_ID], ['client_id', CLIENT_ID],
    ])
  })

  it('revoke_poster clears the signature', async () => {
    const calls: Call[] = []
    installDb({ id: ASSET_ID, vision_metadata: posterMeta }, calls)
    const res = await PATCH(patch({ action: 'revoke_poster' }), ctx)
    expect(res.status).toBe(200)
    const update = calls.find((c) => c.op === 'update')?.args[0] as Record<string, unknown>
    expect(update).toMatchObject({ verified_by: null, verified_at: null })
    expect('source' in update).toBe(false)
  })

  it('the existing { source } path still works for a normal asset', async () => {
    const calls: Call[] = []
    installDb({ id: ASSET_ID, vision_metadata: { scene: 'x' } }, calls)
    const res = await PATCH(patch({ source: 'client_verified' }), ctx)
    expect(res.status).toBe(200)
    const update = calls.find((c) => c.op === 'update')?.args[0] as Record<string, unknown>
    expect(update).toMatchObject({ source: 'client_verified', verified_by: 'fde@me.test' })
  })

  it('{ source } on a poster is refused (400), nothing updated', async () => {
    for (const source of ['client_verified', 'fde_shot', 'unknown']) {
      const calls: Call[] = []
      installDb({ id: ASSET_ID, vision_metadata: posterMeta }, calls)
      const res = await PATCH(patch({ source }), ctx)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('已对原图，确认')
      expect(calls.some((c) => c.op === 'update')).toBe(false)
    }
  })

  it('no email on the session → 403 for any sign-off, never writes "unknown"', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true, user: { email: null }, role: 'admin', tier: 'admin', allowedClientId: null,
    })
    for (const body of [{ action: 'confirm_poster' }, { source: 'client_verified' }, { source: 'fde_shot' }]) {
      const calls: Call[] = []
      installDb({ id: ASSET_ID, source: 'client_provided', vision_metadata: posterMeta }, calls)
      const res = await PATCH(patch(body), ctx)
      expect(res.status).toBe(403)
      expect(calls.some((c) => c.op === 'update')).toBe(false)
    }
  })

  it('no email is fine for a downgrade (no signature is written)', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: true, user: { email: undefined }, role: 'admin', tier: 'admin', allowedClientId: null,
    })
    const calls: Call[] = []
    installDb({ id: ASSET_ID, source: 'client_verified', vision_metadata: null }, calls)
    const res = await PATCH(patch({ source: 'client_provided' }), ctx)
    expect(res.status).toBe(200)
    expect(calls.find((c) => c.op === 'update')?.args[0]).toMatchObject({ verified_by: null })
  })

  it('an ai_generated asset (poster or not) can never be upgraded to a real-price source', async () => {
    for (const source of ['client_verified', 'fde_shot']) {
      const calls: Call[] = []
      installDb({ id: ASSET_ID, source: 'ai_generated', vision_metadata: { scene: 'x' } }, calls)
      const res = await PATCH(patch({ source }), ctx)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('AI 生成')
      expect(calls.some((c) => c.op === 'update')).toBe(false)
    }
    const calls: Call[] = []
    installDb({ id: ASSET_ID, source: 'ai_generated', vision_metadata: null }, calls)
    expect((await PATCH(patch({ source: 'unknown' }), ctx)).status).toBe(200)
  })
})
