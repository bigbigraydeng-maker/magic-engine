/**
 * P34.2 — MCP API key management routes (list + issue + revoke).
 * Tests focus on the security invariants:
 *   R3 List/POST never leak key_hash even if DB returns it
 *   R2 CSRF — cross-origin writes refused
 *   Y6 Admin-only — client-viewer can't list/issue/revoke
 *   Y1 DELETE is truly idempotent — re-revoking preserves original timestamp
 *   IDOR — DELETE filters by both id AND client_id
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
const SAME_ORIGIN = 'http://localhost'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

function grantAdmin(email = 'fde@magicengine.test') {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: 'u1', email },
    role: 'admin',
    allowedClientId: null,
  } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
}

function grantClientViewer() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { id: 'u2', email: 'viewer@client.test' },
    role: 'client-viewer',
    allowedClientId: CLIENT_ID,
  } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
}

function denyAccess(status: 401 | 403 = 401) {
  mockAccess.mockResolvedValue({
    ok: false,
    status,
    error: status === 401 ? 'Unauthorized' : 'Forbidden',
  } as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
}

/** Build a same-origin POST/DELETE request so the CSRF check passes. */
function sameOriginReq(method: 'POST' | 'DELETE', body?: unknown): Request {
  return new Request(`${SAME_ORIGIN}/x`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: SAME_ORIGIN,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function getReq(): Request {
  return new Request(`${SAME_ORIGIN}/x`)
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
    const res = await GET(getReq() as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for client-viewer role (admin-only)', async () => {
    grantClientViewer()
    const res = await GET(getReq() as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(403)
  })

  it('queries with explicit column allowlist that excludes key_hash', async () => {
    grantAdmin()
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    mockFrom.mockReturnValue({ select } as unknown as ReturnType<typeof supabaseAdmin.from>)

    await GET(getReq() as never, {
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
    grantAdmin()
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

    const res = await GET(getReq() as never, {
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
  it('returns 401 when access denied', async () => {
    denyAccess(401)
    const res = await POST(sameOriginReq('POST', { name: 'x' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for client-viewer (admin-only)', async () => {
    grantClientViewer()
    const res = await POST(sameOriginReq('POST', { name: 'x' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(403)
  })

  it('refuses cross-origin requests (CSRF defence)', async () => {
    grantAdmin()
    const req = new Request(`${SAME_ORIGIN}/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ name: 'x' }),
    })
    const res = await POST(req as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(403)
    // Importantly, supabase must not have been touched.
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', { name: '' }],
    ['whitespace', { name: '   ' }],
    ['missing', {}],
    ['non-string', { name: 123 }],
    ['null', { name: null }],
    ['too long', { name: 'x'.repeat(81) }],
    ['only control chars (zero-width)', { name: '​‌‍' }],
    ['only newlines', { name: '\n\r\n' }],
  ])('rejects invalid name: %s', async (_label, body) => {
    grantAdmin()
    const res = await POST(sameOriginReq('POST', body) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    expect(res.status).toBe(400)
  })

  it('strips control characters from name before persistence', async () => {
    grantAdmin()
    const single = vi.fn().mockResolvedValue({
      data: {
        id: KEY_ID,
        name: 'GBP测试',
        key_prefix: 'me_live_PLA',
        scopes: ['read:all'],
        created_at: '2026-06-05T00:00:00Z',
      },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    mockFrom.mockReturnValue({ insert } as unknown as ReturnType<typeof supabaseAdmin.from>)

    // Name contains zero-width chars that would visually impersonate "GBP测试".
    await POST(sameOriginReq('POST', { name: 'GBP​​测试' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    const insertedRow = insert.mock.calls[0][0]
    expect(insertedRow.name).toBe('GBP测试')
  })

  it('persists hash + prefix (NOT plaintext) and returns plaintext exactly once', async () => {
    grantAdmin('fde@magicengine.test')
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

    const res = await POST(sameOriginReq('POST', { name: 'CTS desktop' }) as never, {
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

  // R3 anchor (魏征): response must NOT leak key_hash even if DB returns it.
  // If a future refactor uses `{ ...data, plaintext }` instead of picking
  // fields by name, this test fails immediately.
  it('response never includes key_hash even if DB row contains one', async () => {
    grantAdmin()
    const single = vi.fn().mockResolvedValue({
      data: {
        id: KEY_ID,
        name: 'x',
        key_prefix: 'me_live_PLA',
        scopes: ['read:all'],
        created_at: '2026-06-05T00:00:00Z',
        // Simulate DB accidentally returning key_hash (e.g. someone changed
        // the .select() arg to '*'). The response builder must still drop it.
        key_hash: 'LEAKEDHASHFROMDB',
      },
      error: null,
    })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    mockFrom.mockReturnValue({ insert } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await POST(sameOriginReq('POST', { name: 'x' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('LEAKEDHASHFROMDB')
    expect(body.key).not.toHaveProperty('key_hash')
  })

  // Y2 anchor (魏征): supabase error.message must never reach the client.
  it('500 response does not leak the supabase error message', async () => {
    grantAdmin()
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "...HASHSECRET..."' },
    })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    mockFrom.mockReturnValue({ insert } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await POST(sameOriginReq('POST', { name: 'x' }) as never, {
      params: Promise.resolve({ id: CLIENT_ID }),
    })
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('HASHSECRET')
    expect(JSON.stringify(body)).not.toContain('duplicate key')
  })
})

// ─────────────────────────────────────────────────────────────
// DELETE — revoke
// ─────────────────────────────────────────────────────────────

describe('DELETE /api/clients/[id]/api-keys/[keyId]', () => {
  function buildUpdateChain(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const is = vi.fn().mockReturnValue({ select })
    const eq2 = vi.fn().mockReturnValue({ is })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const update = vi.fn().mockReturnValue({ eq: eq1 })
    return { update, eq1, eq2, is }
  }

  function buildLookupChain(result: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    return { select, eq1, eq2 }
  }

  it('returns 401 when access denied', async () => {
    denyAccess(401)
    const res = await DELETE(sameOriginReq('DELETE') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 for client-viewer (admin-only)', async () => {
    grantClientViewer()
    const res = await DELETE(sameOriginReq('DELETE') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    expect(res.status).toBe(403)
  })

  it('refuses cross-origin requests (CSRF defence)', async () => {
    grantAdmin()
    const req = new Request(`${SAME_ORIGIN}/x`, {
      method: 'DELETE',
      headers: { origin: 'http://evil.example' },
    })
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('filters by BOTH id AND client_id AND is(revoked_at, null)', async () => {
    grantAdmin()
    const { update, eq1, eq2, is } = buildUpdateChain({
      data: { id: KEY_ID, revoked_at: '2026-06-05T01:00:00Z' },
      error: null,
    })
    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof supabaseAdmin.from>)

    await DELETE(sameOriginReq('DELETE') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })

    // All three filters must fire. Dropping any is an IDOR or non-idempotent bug.
    expect(eq1).toHaveBeenCalledWith('id', KEY_ID)
    expect(eq2).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('returns 404 when the key does not exist for THIS client', async () => {
    grantAdmin()
    const { update } = buildUpdateChain({ data: null, error: null })
    const { select } = buildLookupChain({ data: null, error: null })
    mockFrom
      .mockReturnValueOnce({ update } as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce({ select } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await DELETE(sameOriginReq('DELETE') as never, {
      params: Promise.resolve({ id: OTHER_CLIENT_ID, keyId: KEY_ID }),
    })
    expect(res.status).toBe(404)
  })

  it('returns success with revoked_at on the happy path', async () => {
    grantAdmin()
    const { update } = buildUpdateChain({
      data: { id: KEY_ID, revoked_at: '2026-06-05T01:00:00Z' },
      error: null,
    })
    mockFrom.mockReturnValue({ update } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await DELETE(sameOriginReq('DELETE') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.id).toBe(KEY_ID)
    expect(body.revoked_at).toBe('2026-06-05T01:00:00Z')
    expect(body.already_revoked).toBeUndefined()
  })

  // Y1 anchor (魏征): re-revoking must NOT overwrite the original revoked_at.
  it('idempotent: re-revoking returns original revoked_at, never overwrites', async () => {
    grantAdmin()
    const ORIGINAL_REVOKED = '2026-06-01T00:00:00Z'
    // UPDATE matches 0 rows because is(revoked_at, null) filters it out.
    const { update } = buildUpdateChain({ data: null, error: null })
    // Lookup confirms the row exists but is already revoked.
    const { select } = buildLookupChain({
      data: { id: KEY_ID, revoked_at: ORIGINAL_REVOKED },
      error: null,
    })
    mockFrom
      .mockReturnValueOnce({ update } as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce({ select } as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await DELETE(sameOriginReq('DELETE') as never, {
      params: Promise.resolve({ id: CLIENT_ID, keyId: KEY_ID }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.already_revoked).toBe(true)
    // CRITICAL: must be the ORIGINAL timestamp, not now().
    expect(body.revoked_at).toBe(ORIGINAL_REVOKED)
  })
})
