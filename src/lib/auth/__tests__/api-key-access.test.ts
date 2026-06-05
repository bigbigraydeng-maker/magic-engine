import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import {
  generateApiKey,
  sha256Hex,
  extractBearer,
  verifyApiKey,
  logMcpAccess,
  requireMeClientId,
  KEY_PREFIX,
} from '../api-key-access'
import { supabaseAdmin } from '@/lib/supabase'

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const KEY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const mockFrom = vi.mocked(supabaseAdmin.from)

/** Build a chained query mock matching the .select().eq().is().maybeSingle() shape. */
function mockLookup(
  result:
    | { data: { id: string; client_id: string; scopes: string[]; revoked_at: string | null } | null; error: null }
    | { data: null; error: { message: string } },
) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  mockFrom.mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
  return chain
}

function mockUpdateOk() {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
  }
  return chain as unknown as ReturnType<typeof supabaseAdmin.from>
}

function mockInsertOk() {
  return {
    insert: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as ReturnType<typeof supabaseAdmin.from>
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('generateApiKey', () => {
  it('produces a key starting with me_live_ and is non-trivially long', () => {
    const k = generateApiKey()
    expect(k.plaintext.startsWith(KEY_PREFIX)).toBe(true)
    expect(k.plaintext.length).toBeGreaterThan(KEY_PREFIX.length + 40)
  })

  it('produces a stable sha256 hash of the plaintext', () => {
    const k = generateApiKey()
    expect(k.hash).toBe(sha256Hex(k.plaintext))
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('exposes a 12-char display prefix that matches the plaintext head', () => {
    const k = generateApiKey()
    expect(k.prefix).toHaveLength(12)
    expect(k.plaintext.startsWith(k.prefix)).toBe(true)
  })

  it('returns different plaintexts/hashes across calls (no fixed seed)', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe('sha256Hex', () => {
  it('is deterministic for the same input', () => {
    expect(sha256Hex('me_live_test')).toBe(sha256Hex('me_live_test'))
  })

  it('differs across inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })
})

describe('extractBearer', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer me_live_xyz', 'me_live_xyz'],
    ['Bearer   spaced_token  ', 'spaced_token'],
    ['  Bearer trim_outer  ', 'trim_outer'],
  ])('extracts %s', (header, expected) => {
    expect(extractBearer(header)).toBe(expected)
  })

  it.each([null, undefined, '', 'Basic abc', 'Token abc', 'abc'])(
    'returns null for %s',
    (header) => {
      expect(extractBearer(header as string | null | undefined)).toBeNull()
    },
  )
})

describe('verifyApiKey', () => {
  it('returns missing when called with null/empty', async () => {
    expect(await verifyApiKey(null)).toEqual({ ok: false, reason: 'missing' })
    expect(await verifyApiKey('')).toEqual({ ok: false, reason: 'missing' })
  })

  it('returns malformed when prefix is wrong', async () => {
    expect(await verifyApiKey('Bearer wrong')).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyApiKey('sk_live_other')).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns not_found_or_revoked when lookup is empty', async () => {
    mockLookup({ data: null, error: null })
    const res = await verifyApiKey(`${KEY_PREFIX}nonexistent`)
    expect(res).toEqual({ ok: false, reason: 'not_found_or_revoked' })
  })

  it('returns lookup_error on DB error', async () => {
    mockLookup({ data: null, error: { message: 'db down' } })
    const res = await verifyApiKey(`${KEY_PREFIX}any`)
    expect(res).toEqual({ ok: false, reason: 'lookup_error' })
  })

  it('returns the locked client_id + keyId + scopes on success', async () => {
    // Lookup chain: succeed. touchLastUsed chain: also succeed (async, ignored).
    const lookupChain = mockLookup({
      data: {
        id: KEY_ID,
        client_id: CLIENT_ID,
        scopes: ['read:all'],
        revoked_at: null,
      },
      error: null,
    })
    mockFrom.mockReturnValueOnce(lookupChain as unknown as ReturnType<typeof supabaseAdmin.from>)
    mockFrom.mockReturnValue(mockUpdateOk())

    const res = await verifyApiKey(`${KEY_PREFIX}validtoken`)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.auth.clientId).toBe(CLIENT_ID)
      expect(res.auth.keyId).toBe(KEY_ID)
      expect(res.auth.scopes).toEqual(['read:all'])
    }
  })

  it('the lookup query filters out revoked keys (.is(revoked_at, null))', async () => {
    const chain = mockLookup({ data: null, error: null })
    await verifyApiKey(`${KEY_PREFIX}whatever`)
    // Critical for the soft-delete invariant: revoked rows must never match.
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('the lookup query matches by sha256(plaintext) and never sends plaintext to DB', async () => {
    const chain = mockLookup({ data: null, error: null })
    const plaintext = `${KEY_PREFIX}sensitive`
    await verifyApiKey(plaintext)
    const expectedHash = sha256Hex(plaintext)
    expect(chain.eq).toHaveBeenCalledWith('key_hash', expectedHash)
    // None of the chain calls should ever include the plaintext.
    const allCalls = [...chain.eq.mock.calls, ...chain.is.mock.calls].flat()
    expect(allCalls).not.toContain(plaintext)
  })

  // Semantic revoked test (魏征 review): the previous .is()-was-called check
  // only verifies the query is *constructed* with the filter. This one
  // documents the real contract — a revoked row never reaches the success
  // path. The DB enforces it via `.is('revoked_at', null)`, so when a key is
  // revoked the query returns no row and verifyApiKey must report
  // not_found_or_revoked, NOT ok:true.
  it('a revoked key (filtered out by SQL) yields not_found_or_revoked', async () => {
    // Simulate the SQL filter: revoked rows are excluded → maybeSingle empty.
    mockLookup({ data: null, error: null })
    const res = await verifyApiKey(`${KEY_PREFIX}revokedkey`)
    expect(res).toEqual({ ok: false, reason: 'not_found_or_revoked' })
  })
})

describe('requireMeClientId', () => {
  it('returns meClientId + keyId from a well-formed authInfo', () => {
    const ctx = requireMeClientId({
      extra: { meClientId: CLIENT_ID, keyId: KEY_ID },
    })
    expect(ctx).toEqual({ meClientId: CLIENT_ID, keyId: KEY_ID })
  })

  it.each([
    ['undefined authInfo', undefined],
    ['null authInfo', null],
    ['no extra', {}],
    ['empty extra', { extra: {} }],
    ['missing meClientId', { extra: { keyId: KEY_ID } }],
    ['missing keyId', { extra: { meClientId: CLIENT_ID } }],
    ['empty meClientId', { extra: { meClientId: '', keyId: KEY_ID } }],
    ['non-string meClientId', { extra: { meClientId: 123, keyId: KEY_ID } }],
  ])('throws (refuses to run) when %s', (_label, authInfo) => {
    // This is the security chokepoint: a data tool must NEVER run without a
    // locked client_id. Missing context => throw, never silent continue.
    expect(() => requireMeClientId(authInfo)).toThrow()
  })
})

describe('logMcpAccess', () => {
  it('appends a row with the right payload (fire-and-forget)', () => {
    const insertChain = mockInsertOk()
    mockFrom.mockReturnValue(insertChain)

    logMcpAccess({
      keyId: KEY_ID,
      clientId: CLIENT_ID,
      tool: 'me_ping',
      ok: true,
    })

    expect(mockFrom).toHaveBeenCalledWith('mcp_access_log')
    expect(insertChain.insert).toHaveBeenCalledWith({
      key_id: KEY_ID,
      client_id: CLIENT_ID,
      tool: 'me_ping',
      ok: true,
      error_code: null,
    })
  })

  it('records error_code when provided', () => {
    const insertChain = mockInsertOk()
    mockFrom.mockReturnValue(insertChain)

    logMcpAccess({
      keyId: KEY_ID,
      clientId: CLIENT_ID,
      tool: 'me_ping',
      ok: false,
      errorCode: 'rate_limited',
    })

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error_code: 'rate_limited' }),
    )
  })
})
