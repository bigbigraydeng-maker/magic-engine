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
import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'

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

  it.each(['google_gsc', 'google_ga4', 'google_gtm'] as const)(
    'routes %s through the Google refresh endpoint, not the "not yet implemented" error',
    async (provider) => {
      const row   = { ...VALID_ROW, provider }
      const chain = chainResolving({ data: row, error: null })
      mocks.from.mockReturnValue(chain)

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }),
          { status: 200 },
        ),
      )

      const token = await getValidToken('client-1', provider)
      expect(token).toBe('new-access-token')
    },
  )

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

// ─── 刷新请求里带不带 scope：这是 2026-09-24 那次 9 天事故的真正根因 ──────────

/**
 * 🔴 **改这两条断言之前，先读 `docs/PITFALLS.md` F11。**
 *
 * 微软刷新时**必须重放**整份 scope 清单（漏掉会悄悄降权，读信时才 403）；
 * 谷歌刷新时**必须不带** scope（带上客户没同意过的新权限会直接被拒，
 * 已有连接当场死 —— 这正是 `MICROSOFT_MAIL_SCOPES` 那次改动弄死 CTS 两个邮箱的
 * 机制）。谁哪天觉得「两边写法统一一下更规范」，就会原样复制一次那场事故。
 *
 * 钉住 `*_SCOPES` 清单的那道闸（`scope-change-gate.test.ts`）挡的是「改清单」，
 * 这两条挡的是「改行为」—— 后者更接近根因。
 */
describe('刷新请求的形状（根因闸门，改之前先读 PITFALLS F11）', () => {
  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = 'ms-client'
    process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret'
  })

  async function refreshBodyFor(provider: string): Promise<URLSearchParams> {
    // 上一个 describe 里留下的 mockReturnValueOnce 队列不会被 clearAllMocks 清掉，
    // 不 reset 的话第一次调用会拿到别人排好的那个返回值。
    mocks.from.mockReset()
    mocks.isTokenExpired.mockReturnValue(true)
    mocks.from.mockReturnValue(chainResolving({ data: { ...VALID_ROW, provider }, error: null }))
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await getValidToken('client-1', provider as never)
    vi.unstubAllGlobals()
    return new URLSearchParams(fetchSpy.mock.calls[0][1].body as string)
  }

  it('谷歌：刷新请求里绝不能带 scope（带了 = 加新权限会弄死已有连接）', async () => {
    const body = await refreshBodyFor('google_gsc')
    expect(body.get('scope')).toBeNull()
    expect(body.get('grant_type')).toBe('refresh_token')
  })

  it('微软：刷新请求里必须带完整 scope（漏了 = 悄悄降权，读信时才 403）', async () => {
    const body = await refreshBodyFor('microsoft_mail')
    expect(body.get('scope')).toBe(MICROSOFT_MAIL_SCOPES.join(' '))
    // offline_access 少了就换不回刷新能力，下一小时安静地断
    expect(body.get('scope')).toContain('offline_access')
  })
})
