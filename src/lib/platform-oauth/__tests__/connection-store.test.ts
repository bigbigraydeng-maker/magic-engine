import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  from:         vi.fn(),
  encryptToken: vi.fn((s: string) => `enc:${s}`),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('../vocabulary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vocabulary')>()
  return { ...actual, encryptToken: mocks.encryptToken }
})

// ─── Import after mocks ────────────────────────────────────────────────────────

import {
  upsertConnection,
  listConnections,
  listSocialConnectionFacts,
  confirmSocialConnectionWrite,
  getConnectionById,
  revokeConnection,
} from '../connection-store'
import { PLATFORM_PROVIDERS, CONNECTION_STATUS } from '../vocabulary'
import type { UpsertConnectionInput, PlatformOAuthConnectionRow } from '../vocabulary'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EXPIRES_AT = new Date('2026-07-01T00:00:00Z')

const UPSERT_INPUT: UpsertConnectionInput = {
  clientId:      'client-xyz',
  provider:      PLATFORM_PROVIDERS.GOOGLE_GBP,
  accessToken:   'plain-access',
  refreshToken:  'plain-refresh',
  tokenExpiry:   EXPIRES_AT,
  accountId:     'accounts/999',
  displayName:   'OzTop GBP Account',
  scopes:        ['https://www.googleapis.com/auth/business.manage'],
}

const DB_ROW: PlatformOAuthConnectionRow = {
  id:                'conn-1',
  client_id:         'client-xyz',
  provider:          PLATFORM_PROVIDERS.GOOGLE_GBP,
  authorizing_principal_id: null,
  entitlement_revision: null,
  access_token_enc:  'enc:plain-access',
  refresh_token_enc: 'enc:plain-refresh',
  token_expiry:      EXPIRES_AT.toISOString(),
  account_id:        'accounts/999',
  location_name:     null,
  display_name:      'OzTop GBP Account',
  scopes:            ['https://www.googleapis.com/auth/business.manage'],
  status:            CONNECTION_STATUS.ACTIVE,
  last_synced_at:    null,
  error_message:     null,
  created_at:        '2026-06-03T00:00:00Z',
  updated_at:        '2026-06-03T00:00:00Z',
}

/** Fluent chain that resolves to `result` for both .upsert() and .single() */
function chainResolving(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'single', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // upsert resolves asynchronously
  chain['upsert'] = vi.fn().mockResolvedValue(result)
  // single resolves asynchronously
  ;(chain['single'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  // select + eq chain for listConnections
  ;(chain['order'] as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  // update chain for revokeConnection
  ;(chain['update'] as ReturnType<typeof vi.fn>).mockReturnValue({
    eq: vi.fn().mockResolvedValue(result),
  })
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listSocialConnectionFacts', () => {
  it('queries only safe columns, exact client, legacy purpose and supported providers', async () => {
    const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn() }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    chain.in.mockResolvedValue({ data: [], error: null })
    mocks.from.mockReturnValue(chain)
    expect(await listSocialConnectionFacts('client-xyz')).toEqual([])
    expect(mocks.from).toHaveBeenCalledWith('platform_oauth_connections')
    expect(chain.select).toHaveBeenCalledWith('id,provider,purpose,account_id,location_name,display_name,status,scopes,token_expiry,last_synced_at')
    expect(chain.eq).toHaveBeenCalledWith('client_id', 'client-xyz')
    expect(chain.eq).toHaveBeenCalledWith('purpose', 'legacy')
    expect(chain.in).toHaveBeenCalledWith('provider', ['meta', 'instagram', 'tiktok', 'google_youtube'])
    expect(mocks.encryptToken).not.toHaveBeenCalled()
  })
  it('does not collapse database failure into an empty disconnected list', async () => {
    const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn() }
    chain.select.mockReturnValue(chain)
    chain.eq.mockReturnValue(chain)
    chain.in.mockResolvedValue({ data: null, error: { message: 'private database detail' } })
    mocks.from.mockReturnValue(chain)
    await expect(listSocialConnectionFacts('client-xyz')).rejects.toThrow('Social connection facts unavailable')
  })
})

describe('confirmSocialConnectionWrite', () => {
  const verifiedAt = new Date('2026-10-19T00:00:00.123Z')
  const tokenExpiry = new Date('2100-01-01T00:00:00.000Z')
  const input = { clientId: 'client-xyz', provider: 'google_youtube' as const,
    accountId: 'UCmJJDRx88y0IuZXJJQuGNFw', requiredScopes: ['youtube.upload'], tokenExpiry, verifiedAt }
  const row = { id: 'grant', provider: 'google_youtube', purpose: 'legacy', account_id: input.accountId,
    status: 'active', scopes: ['youtube.upload'], token_expiry: tokenExpiry.toISOString(),
    last_synced_at: verifiedAt.toISOString() }
  function withRows(data: unknown, error: unknown = null) {
    const chain = { select: vi.fn(), eq: vi.fn(), in: vi.fn() }
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain)
    chain.in.mockResolvedValue({ data, error }); mocks.from.mockReturnValue(chain)
    return chain
  }
  it('reads back this exact client and this write without selecting credentials', async () => {
    const chain = withRows([row])
    expect(await confirmSocialConnectionWrite(input)).toBe(true)
    expect(chain.eq).toHaveBeenCalledWith('client_id', input.clientId)
    expect(chain.select).toHaveBeenCalledWith('id,provider,purpose,account_id,location_name,display_name,status,scopes,token_expiry,last_synced_at')
  })
  it.each([
    ['no row', []],
    ['another account', [{ ...row, account_id: 'another' }]],
    ['an older write', [{ ...row, last_synced_at: '2026-10-18T00:00:00Z' }]],
    ['missing scope', [{ ...row, scopes: [] }]],
    ['malformed scope array', [{ ...row, scopes: ['youtube.upload', 42] }]],
    ['expired token', [{ ...row, token_expiry: '2026-01-01T00:00:00Z' }]],
    ['ambiguous rows', [row, { ...row, account_id: 'other' }]],
  ])('does not confirm %s', async (_label, rows) => {
    withRows(rows)
    expect(await confirmSocialConnectionWrite(input)).toBe(false)
  })
  it('checks the Instagram username as well as its account ID', async () => {
    withRows([{ ...row, provider: 'instagram', account_id: '987654321', location_name: 'other' }])
    expect(await confirmSocialConnectionWrite({ ...input, provider: 'instagram',
      accountId: '987654321', locationName: 'example' })).toBe(false)
  })
  it('fails closed when the read itself fails', async () => {
    withRows(null, { message: 'private database detail' })
    await expect(confirmSocialConnectionWrite(input)).rejects.toThrow('Social connection facts unavailable')
  })
})

// ─── upsertConnection ─────────────────────────────────────────────────────────

describe('upsertConnection', () => {
  /**
   * 🔴 状态改回 active 就必须擦掉旧报错。
   *
   * 2026-09-24 实测：CTS 的 info@ 重新授权之后 `status` 是 `active`、
   * `error_message` 还挂着 9 天前那条 AADSTS65001。任何「按报错找坏连接」的
   * 排查都会被它骗一次，断线监控也会对着一条健康连接说它有病。
   */
  it('把状态写回 active 的同时清掉上次断线的报错', async () => {
    const chain = chainResolving({ error: null })
    mocks.from.mockReturnValue(chain)

    await upsertConnection(UPSERT_INPUT)

    const payload = (chain['upsert'] as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.status).toBe(CONNECTION_STATUS.ACTIVE)
    expect(payload.error_message).toBeNull()
  })

  it('encrypts both tokens before calling DB upsert', async () => {
    mocks.from.mockReturnValue(chainResolving({ error: null }))

    await upsertConnection(UPSERT_INPUT)

    expect(mocks.encryptToken).toHaveBeenCalledWith('plain-access')
    expect(mocks.encryptToken).toHaveBeenCalledWith('plain-refresh')
  })

  it('upserts with correct shape including encrypted tokens', async () => {
    const chain = chainResolving({ error: null })
    mocks.from.mockReturnValue(chain)

    await upsertConnection(UPSERT_INPUT)

    expect(chain['upsert']).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id:         'client-xyz',
        provider:          'google_gbp',
        access_token_enc:  'enc:plain-access',
        refresh_token_enc: 'enc:plain-refresh',
        account_id:        'accounts/999',
        display_name:      'OzTop GBP Account',
        status:            'active',
      }),
      expect.objectContaining({ onConflict: 'client_id,provider,account_id' }),
    )
  })

  it('uses tokenExpiry directly for token_expiry column', async () => {
    const chain = chainResolving({ error: null })
    mocks.from.mockReturnValue(chain)

    await upsertConnection(UPSERT_INPUT)

    expect(chain['upsert']).toHaveBeenCalledWith(
      expect.objectContaining({ token_expiry: EXPIRES_AT.toISOString() }),
      expect.anything(),
    )
  })

  it('passes locationName when provided', async () => {
    const chain = chainResolving({ error: null })
    mocks.from.mockReturnValue(chain)

    await upsertConnection({ ...UPSERT_INPUT, locationName: 'accounts/999/locations/123' })

    expect(chain['upsert']).toHaveBeenCalledWith(
      expect.objectContaining({ location_name: 'accounts/999/locations/123' }),
      expect.anything(),
    )
  })

  it('重新连接 Meta 时清掉这条主页的暂停，Google 连接不清', async () => {
    const chain = chainResolving({ error: null })
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const deleteChain = { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: deleteEq }) }) }
    mocks.from.mockImplementation((table: string) => (table === 'meta_page_sync_holds' ? deleteChain : chain))

    await upsertConnection(UPSERT_INPUT)
    expect(mocks.from).not.toHaveBeenCalledWith('meta_page_sync_holds')

    await upsertConnection({ ...UPSERT_INPUT, provider: PLATFORM_PROVIDERS.META, accountId: 'page-1' })
    expect(mocks.from).toHaveBeenCalledWith('meta_page_sync_holds')
    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('page_id', 'page-1')
  })

  it('throws when DB returns an error', async () => {
    mocks.from.mockReturnValue(chainResolving({ error: { message: 'DB constraint violation' } }))

    await expect(upsertConnection(UPSERT_INPUT)).rejects.toThrow(/constraint/)
  })
})

// ─── listConnections ──────────────────────────────────────────────────────────

describe('listConnections', () => {
  it('returns summaries stripped of token fields', async () => {
    mocks.from.mockReturnValue(chainResolving({ data: [DB_ROW], error: null }))

    const results = await listConnections('client-xyz')

    expect(results).toHaveLength(1)
    expect(results[0]).not.toHaveProperty('access_token_enc')
    expect(results[0]).not.toHaveProperty('refresh_token_enc')
    expect(results[0]).toMatchObject({
      id:           DB_ROW.id,
      provider:     DB_ROW.provider,
      display_name: DB_ROW.display_name,
      account_id:   DB_ROW.account_id,
      status:       DB_ROW.status,
    })
  })

  it('returns empty array when client has no connections', async () => {
    mocks.from.mockReturnValue(chainResolving({ data: [], error: null }))

    const results = await listConnections('unknown-client')
    expect(results).toEqual([])
  })

  it('returns empty array (non-throwing) when DB errors', async () => {
    mocks.from.mockReturnValue(chainResolving({ data: null, error: { message: 'DB error' } }))

    const results = await listConnections('client-xyz')
    expect(results).toEqual([])
  })
})

// ─── getConnectionById ────────────────────────────────────────────────────────

describe('getConnectionById', () => {
  it('returns the full row when found', async () => {
    mocks.from.mockReturnValue(chainResolving({ data: DB_ROW, error: null }))

    const row = await getConnectionById('conn-1')
    expect(row).toEqual(DB_ROW)
  })

  it('returns null when DB returns error (not found)', async () => {
    mocks.from.mockReturnValue(chainResolving({ data: null, error: { message: 'not found' } }))

    const row = await getConnectionById('nonexistent')
    expect(row).toBeNull()
  })
})

// ─── revokeConnection ─────────────────────────────────────────────────────────

describe('revokeConnection', () => {
  it('updates status to revoked', async () => {
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    const fromChain = {
      update: vi.fn().mockReturnValue(updateChain),
    }
    mocks.from.mockReturnValue(fromChain)

    await revokeConnection('conn-1')

    expect(fromChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'revoked' }),
    )
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'conn-1')
  })

  it('throws when DB update fails', async () => {
    const updateChain = {
      eq: vi.fn().mockResolvedValue({ error: { message: 'permission denied' } }),
    }
    mocks.from.mockReturnValue({ update: vi.fn().mockReturnValue(updateChain) })

    await expect(revokeConnection('conn-1')).rejects.toThrow(/permission denied/)
  })
})
