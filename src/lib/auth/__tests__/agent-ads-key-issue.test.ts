import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sha256Hex } from '@/lib/auth/api-key-access'
import { AGENT_ADS_SCOPE } from '@/lib/auth/agent-ads-scope'

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '@/app/api/agent/ads/clients/[id]/keys/route'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const admin = vi.mocked(requireGlobalAdmin)
const from = vi.mocked(supabaseAdmin.from)

function grant() {
  admin.mockResolvedValue({
    ok: true,
    user: { id: 'u', email: 'staff@example.com' },
  } as Awaited<ReturnType<typeof requireGlobalAdmin>>)
}

function install(opts: { client?: boolean; scopes?: string[] | null; insertError?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  from.mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.client === false ? null : { id: CLIENT },
              error: null,
            }),
          }),
        }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    return {
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        const scopes = opts.scopes === undefined ? row.scopes : opts.scopes
        return {
          select: () => ({
            single: async () => ({
              data: opts.insertError ? null : {
                id: 'key-1',
                name: row.name,
                key_prefix: row.key_prefix,
                scopes,
                expires_at: row.expires_at,
                created_at: '2026-10-27T00:00:00.000Z',
              },
              error: opts.insertError ? { message: 'x' } : null,
            }),
          }),
        }
      },
      update: (patch: Record<string, unknown>) => {
        updates.push(patch)
        return { eq: () => ({ eq: async () => ({ error: null }) }) }
      },
    } as unknown as ReturnType<typeof supabaseAdmin.from>
  })
  return { inserts, updates }
}

function post(body: unknown, origin = 'http://localhost') {
  return new NextRequest('http://localhost/api/agent/ads/clients/x/keys', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  grant()
})

describe('POST /api/agent/ads/clients/[id]/keys', () => {
  it('shows the plaintext once and stores only the hash, scope, and expiry', async () => {
    const db = install()
    const res = await POST(post({ name: 'agent', expires_at: future }), { params: { id: CLIENT } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.key.plaintext.startsWith('me_live_')).toBe(true)
    expect(body.key.scopes).toEqual([AGENT_ADS_SCOPE])
    expect(body.key.expires_at).toBeTruthy()
    expect(db.inserts).toHaveLength(1)
    const row = db.inserts[0]
    expect(row.scopes).toEqual([AGENT_ADS_SCOPE])
    expect(row.expires_at).toBe(body.key.expires_at)
    expect(row.key_hash).toBe(sha256Hex(body.key.plaintext))
    expect(Object.values(row)).not.toContain(body.key.plaintext)
    expect(JSON.stringify(row)).not.toContain(body.key.plaintext)
    expect(db.updates).toEqual([])
  })

  it('refuses a missing, past, or far expiry and does not insert', async () => {
    const db = install()
    const missing = await POST(post({ name: 'agent' }), { params: { id: CLIENT } })
    const past = await POST(post({ name: 'agent', expires_at: '2000-01-01T00:00:00.000Z' }), { params: { id: CLIENT } })
    const far = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString()
    const tooFar = await POST(post({ name: 'agent', expires_at: far }), { params: { id: CLIENT } })
    expect(missing.status).toBe(400)
    expect((await missing.json()).code).toBe('missing_expiry')
    expect(past.status).toBe(400)
    expect(tooFar.status).toBe(400)
    expect(db.inserts).toEqual([])
  })

  it('does not let the caller choose the scope', async () => {
    const db = install()
    const res = await POST(post({ name: 'agent', expires_at: future, scopes: ['read:all'] }), { params: { id: CLIENT } })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('scopes_fixed')
    expect(db.inserts).toEqual([])
  })

  it('revokes and hides the plaintext if the stored scope is not exact', async () => {
    const db = install({ scopes: ['read:all'] })
    const res = await POST(post({ name: 'agent', expires_at: future }), { params: { id: CLIENT } })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.plaintext).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('me_live_')
    expect(db.updates[0]).toHaveProperty('revoked_at')
  })

  it('refuses a non-admin and a cross-origin request before inserting', async () => {
    admin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const denied = install()
    const res = await POST(post({ name: 'agent', expires_at: future }), { params: { id: CLIENT } })
    expect(res.status).toBe(403)
    expect(denied.inserts).toEqual([])

    grant()
    const cross = install()
    const blocked = await POST(
      post({ name: 'agent', expires_at: future }, 'http://evil.test'),
      { params: { id: CLIENT } },
    )
    expect(blocked.status).toBe(403)
    expect(cross.inserts).toEqual([])
  })
})
