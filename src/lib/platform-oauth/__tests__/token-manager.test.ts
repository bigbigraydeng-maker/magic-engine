import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  from:         vi.fn(),
  encryptToken: vi.fn((s: string) => `enc:${s}`),
  decryptToken: vi.fn((s: string) => s.replace(/^enc:/, '')),
  isTokenExpired: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('../vocabulary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vocabulary')>()
  return {
    ...actual,
    encryptToken:   mocks.encryptToken,
    decryptToken:   mocks.decryptToken,
    isTokenExpired: mocks.isTokenExpired,
  }
})

// ─── Import after mocks ────────────────────────────────────────────────────────

import {
  getValidToken,
  PlatformConnectionNotFoundError,
  PlatformTokenRefreshError,
} from '../token-manager'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ROW = {
  id:                'conn-1',
  client_id:         'client-1',
  provider:          'google_gbp',
  access_token_enc:  'enc:access-abc',
  refresh_token_enc: 'enc:refresh-xyz',
  token_expiry:      new Date(Date.now() + 3600_000).toISOString(),
  account_id:        'accounts/123',
  location_name:     'accounts/123/locations/456',
  display_name:      'OzTop Brisbane GBP',
  scopes:            ['https://www.googleapis.com/auth/business.manage'],
  status:            'active',
  last_synced_at:    null,
  error_message:     null,
  created_at:        '2026-06-03T00:00:00Z',
  updated_at:        '2026-06-03T00:00:00Z',
}

/** Build a fluent Supabase query chain that resolves to `result`. */
function chainResolving(result: unknown) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'order', 'limit', 'single', 'update']
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  ;(chain['single'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  ;(chain['update'] as ReturnType<typeof vi.fn>).mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_CLIENT_ID     = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
})

// ─── getValidToken ─────────────────────────────────────────────────────────────

describe('getValidToken — fast path (token not expired)', () => {
  it('returns the decrypted access_token without calling fetch', async () => {
    mocks.isTokenExpired.mockReturnValue(false)
    mocks.from.mockReturnValue(chainResolving({ data: VALID_ROW, error: null }))

    const token = await getValidToken('client-1', 'google_gbp')

    expect(token).toBe('access-abc')           // decryptToken strips 'enc:' prefix
    expect(mocks.decryptToken).toHaveBeenCalledWith('enc:access-abc')
    expect(mocks.isTokenExpired).toHaveBeenCalledWith(VALID_ROW.token_expiry)
  })

  it('does NOT call the OAuth refresh endpoint on the fast path', async () => {
    mocks.isTokenExpired.mockReturnValue(false)
    mocks.from.mockReturnValue(chainResolving({ data: VALID_ROW, error: null }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await getValidToken('client-1', 'google_gbp')

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('getValidToken — slow path (token expired, refresh succeeds)', () => {
  beforeEach(() => {
    mocks.isTokenExpired.mockReturnValue(true)
  })

  it('calls Google OAuth endpoint with correct params and returns new token', async () => {
    const chain = chainResolving({ data: VALID_ROW, error: null })
    mocks.from.mockReturnValue(chain)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }),
        { status: 200 },
      ),
    )

    const token = await getValidToken('client-1', 'google_gbp')

    expect(token).toBe('new-access-token')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('re-encrypts and persists the new access_token to DB', async () => {
    const chain = chainResolving({ data: VALID_ROW, error: null })
    mocks.from.mockReturnValue(chain)

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: 'refreshed-token', expires_in: 3600 }),
        { status: 200 },
      ),
    )

    await getValidToken('client-1', 'google_gbp')

    expect(mocks.encryptToken).toHaveBeenCalledWith('refreshed-token')
  })

  it('uses the refresh_token (not the access_token) for the refresh call', async () => {
    const chain = chainResolving({ data: VALID_ROW, error: null })
    mocks.from.mockReturnValue(chain)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
    )

    await getValidToken('client-1', 'google_gbp')

    const [, init] = fetchSpy.mock.calls[0]
    const bodyStr  = (init as RequestInit).body as string
    expect(bodyStr).toContain('refresh_token=refresh-xyz')
    expect(bodyStr).toContain('grant_type=refresh_token')
  })
})

describe('getValidToken — error cases', () => {
  it('throws PlatformConnectionNotFoundError when DB returns no row', async () => {
    const chain = chainResolving({ data: null, error: { message: 'not found' } })
    mocks.from.mockReturnValue(chain)

    await expect(getValidToken('client-1', 'google_gbp')).rejects.toBeInstanceOf(
      PlatformConnectionNotFoundError,
    )
  })

  it('throws PlatformTokenRefreshError and marks connection error when Google returns 400', async () => {
    mocks.isTokenExpired.mockReturnValue(true)
    const chain = chainResolving({ data: VALID_ROW, error: null })
    mocks.from.mockReturnValue(chain)

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired' }),
        { status: 400 },
      ),
    )

    await expect(getValidToken('client-1', 'google_gbp')).rejects.toBeInstanceOf(
      PlatformTokenRefreshError,
    )
  })

  it('throws PlatformTokenRefreshError when GOOGLE_CLIENT_ID is missing', async () => {
    mocks.isTokenExpired.mockReturnValue(true)
    delete process.env.GOOGLE_CLIENT_ID
    const chain = chainResolving({ data: VALID_ROW, error: null })
    mocks.from.mockReturnValue(chain)

    await expect(getValidToken('client-1', 'google_gbp')).rejects.toThrow(
      /GOOGLE_CLIENT_ID/,
    )
  })

  it('throws PlatformTokenRefreshError for unimplemented provider (meta)', async () => {
    mocks.isTokenExpired.mockReturnValue(true)
    const metaRow = { ...VALID_ROW, provider: 'meta' }
    const chain   = chainResolving({ data: metaRow, error: null })
    mocks.from.mockReturnValue(chain)

    await expect(getValidToken('client-1', 'meta')).rejects.toThrow(
      /not yet implemented/,
    )
  })

  it('does not throw when DB persist of refreshed token fails (non-fatal)', async () => {
    mocks.isTokenExpired.mockReturnValue(true)

    // Simulate refresh succeeds but DB update errors
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: VALID_ROW, error: null }),
    }
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: { message: 'DB timeout' } }),
    }
    mocks.from
      .mockReturnValueOnce(selectChain)   // first call: fetch row
      .mockReturnValueOnce({ update: vi.fn().mockReturnValue(updateChain) })  // persist
      .mockReturnValueOnce({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) }) // markError (not called on success)

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'new-tok', expires_in: 3600 }), { status: 200 }),
    )

    // Should resolve, not reject
    const token = await getValidToken('client-1', 'google_gbp')
    expect(token).toBe('new-tok')
  })
})
