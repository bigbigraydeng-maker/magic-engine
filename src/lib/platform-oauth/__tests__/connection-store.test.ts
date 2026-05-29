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

// ─── upsertConnection ─────────────────────────────────────────────────────────

describe('upsertConnection', () => {
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
