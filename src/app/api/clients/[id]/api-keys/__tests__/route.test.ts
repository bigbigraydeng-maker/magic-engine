/**
 * P34.2 — MCP API key management routes (list + issue + revoke).
 * Tests focus on the three security invariants:
 *   1. List never leaks key_hash / plaintext
 *   2. Issue persists hash, returns plaintext exactly once
 *   3. Revoke filters by client_id (cross-tenant defence)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth/api-key-access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/api-key-access')>(
    '@/lib/auth/api-key-access',
  )
  return {
    ...actual,
    generateApiKey: vi.fn(() => ({
      plaintext: 'me_live_PLAINTEXTSENTINEL',
      hash: 'HASHSENTINEL',
      prefix: 'me_live_PLA',
    })),
  }
})

import { GET, POST } from '../route'
import { DELETE } from '../[keyId]/route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER_CLIENT_ID = 'bbbbbbbb-0000-0000-0000-000000000002'
const KEY_ID = 'kkkkkkkk-0000-0000-0000-000000000001'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

function grantAccess(email = 'fde@magicengine.test') {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: 'u1', email },
    role: 'admin',
    allowedClientId: null,
  } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
}

function denyAccess(status: 401 | 403 = 401) {
  mockAccess.mockResolvedValue({
    ok: false,
    status,
    error: status === 401 ? 'Unauthorized' : 'Forbidden',
  } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─────────────────────────────────────────────────────────────
// GET — list keys
// ─────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/api-keys', () => {
  it('returns 401/403 when access is denied', async () => {
    denyAccess(401)
    const res = await GET(new Request('http://x') as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('queries with explicit column allowlist that excludes key_hash', async () => {
    grantAccess()
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    mockFrom.mockReturnValue({ select } as unknown as ReturnType<typeof supabaseAdmin.from>)

    await GET(new Request('http://x') as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })

    expect(mockFrom).toHaveBeenCalledWith('client_api_keys')
    // CRITICAL: the only defence against accidental hash leakage is the
    // explicit allowlist. If anyone ever changes this to '*' the test fails.
    const selectArg = select.mock.calls[0][0] as string
    expect(selectArg).not.toContain('*')
    expect(selectArg).not.toContain('key_hash')
    expect(selectArg).toContain('key_prefix')
    expect(eq).toHaveBeenCalledWith('client_id', CLIENT_ID)
  })

  it('returns the rows under {keys: [...]}', async () => {
    grantAccess()
    const row = {
      id: KEY_ID,
      name: 'CTS desktop',
      key_prefix: 'me_live_abc',
      scopes: ['read:all'],
      last_used_at: null,
      revoked_at: null,
      created_at: '2026-06-05T00:00:00Z',
      created_by_email: 'fde@magicengine.test',
    }
    const order = vi.fn().mockResolvedValue({ data: [row], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    mockFrom.mockReturnValue({ select } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await GET(new Request('http://x') as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    const body = await res.json()
    expect(body).toEqual({ keys: [row] })
  })
})

// ─────────────────────────────────────────────────────────────
// POST — issue key
// ─────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/api-keys', () => {
  function jsonReq(body: unknown): Request {
    return new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 when access denied', async () => {
    denyAccess(401)
    const res = await POST(jsonReq({ name: 'x' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(401)
  })

  it.each([
    ['empty', { name: '' }],
    ['whitespace', { name: '   ' }],
    ['missing', {}],
    ['non-string', { name: 123 }],
    ['too long', { name: 'x'.repeat(81) }],
  ])('rejects invalid name: %s', async (_label, body) => {
    grantAccess()
    const res = await POST(jsonReq(body) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('persists hash + prefix (NOT plaintext) and returns plaintext exactly once', async () => {
    grantAccess('fde@magicengine.test')
    const single = vi.fn().mockResolvedValue({
      data: {
        id: KEY_ID,
        name: 'CTS desktop',
        key_prefix: 'me_live_PLA',
        scopes: ['read:all'],
        created_at: '2026-06-05T00:00:00Z',
      },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    mockFrom.mockReturnValue({ insert } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await POST(jsonReq({ name: 'CTS desktop' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    const body = await res.json()

    // What we INSERTED: hash + prefix + name + created_by_email — never plaintext.
    const insertedRow = insert.mock.calls[0][0]
    expect(insertedRow.key_hash).toBe('HASHSENTINEL')
    expect(insertedRow.key_prefix).toBe('me_live_PLA')
    expect(insertedRow.client_id).toBe(CLIENT_ID)
    expect(insertedRow.created_by_email).toBe('fde@magicengine.test')
    expect(insertedRow).not.toHaveProperty('plaintext')
    expect(JSON.stringify(insertedRow)).not.toContain('PLAINTEXTSENTINEL')

    // What we RETURNED: plaintext present here (only place it's ever exposed).
    expect(body.success).toBe(true)
    expect(body.key.plaintext).toBe('me_live_PLAINTEXTSENTINEL')
    expect(body.key.id).toBe(KEY_ID)
    // The response MUST NOT leak the hash.
    expect(JSON.stringify(body)).not.toContain('HASHSENTINEL')
  })
})

// ─────────────────────────────────────────────────────────────
// DELETE — revoke
// ─────────────────────────────────────────────────────────────

describe('DELETE /api/clients/[id]/api-keys/[keyId]', () => {
  function buildRevokeChain(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq2 = vi.fn().mockReturnValue({ select })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const update = vi.fn().mockReturnValue({ eq: eq1 })
    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof supabaseAdmin.from>)
    return { update, eq1, eq2 }
  }

  it('returns 401 when access denied', async () => {
    denyAccess(401)
    const res = await DELETE(new Request('http://x') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('filters by BOTH id AND client_id (cross-tenant defence)', async () => {
    grantAccess()
    const { eq1, eq2 } = buildRevokeChain({
      data: { id: KEY_ID, revoked_at: '2026-06-05T01:00:00Z' },
      error: null,
    })

    await DELETE(new Request('http://x') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })

    // Both .eq() calls must fire. Removing either is an IDOR bug.
    expect(eq1).toHaveBeenCalledWith('id', KEY_ID)
    expect(eq2).toHaveBeenCalledWith('client_id', CLIENT_ID)
  })

  it('returns 404 when the key does not exist for THIS client', async () => {
    grantAccess()
    // Simulate the cross-tenant case: keyId real, but belongs to OTHER client.
    // The combined filter returns no row.
    buildRevokeChain({ data: null, error: null })

    const res = await DELETE(new Request('http://x') as never, {
      params: Promise.resolve({ id: OTHER_CLIENT_ID, keyId: KEY_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns success with revoked_at on the happy path', async () => {
    grantAccess()
    buildRevokeChain({
      data: { id: KEY_ID, revoked_at: '2026-06-05T01:00:00Z' },
      error: null,
    })

    const res = await DELETE(new Request('http://x') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBe(KEY_ID)
    expect(body.revoked_at).toBe('2026-06-05T01:00:00Z')
  })
})
