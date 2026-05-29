import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PLATFORM_PROVIDERS,
  CONNECTION_STATUS,
  isPlatformProvider,
  isTokenExpired,
  toConnectionSummary,
  type PlatformOAuthConnectionRow,
} from '../vocabulary'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides?: Partial<PlatformOAuthConnectionRow>): PlatformOAuthConnectionRow {
  return {
    id:                'row-uuid-1',
    client_id:         'client-uuid-1',
    provider:          'google_gbp',
    access_token_enc:  'iv.tag.cipher',
    refresh_token_enc: 'iv.tag.cipher2',
    token_expiry:      new Date(Date.now() + 3600_000).toISOString(),
    account_id:        'accounts/12345',
    location_name:     'accounts/12345/locations/67890',
    display_name:      'OzTop Brisbane GBP',
    scopes:            ['https://www.googleapis.com/auth/business.manage'],
    status:            'active',
    last_synced_at:    null,
    error_message:     null,
    created_at:        '2026-06-03T00:00:00Z',
    updated_at:        '2026-06-03T00:00:00Z',
    ...overrides,
  }
}

// ─── PLATFORM_PROVIDERS ───────────────────────────────────────────────────────

describe('PLATFORM_PROVIDERS', () => {
  it('contains all five expected providers', () => {
    expect(Object.values(PLATFORM_PROVIDERS)).toEqual(
      expect.arrayContaining(['google_gbp', 'google_gsc', 'meta', 'tiktok', 'google_ads']),
    )
  })

  it('values match DB CHECK constraint strings exactly', () => {
    expect(PLATFORM_PROVIDERS.GOOGLE_GBP).toBe('google_gbp')
    expect(PLATFORM_PROVIDERS.GOOGLE_GSC).toBe('google_gsc')
    expect(PLATFORM_PROVIDERS.META).toBe('meta')
    expect(PLATFORM_PROVIDERS.TIKTOK).toBe('tiktok')
    expect(PLATFORM_PROVIDERS.GOOGLE_ADS).toBe('google_ads')
  })
})

// ─── CONNECTION_STATUS ────────────────────────────────────────────────────────

describe('CONNECTION_STATUS', () => {
  it('contains all four expected statuses', () => {
    expect(Object.values(CONNECTION_STATUS)).toEqual(
      expect.arrayContaining(['active', 'revoked', 'expired', 'error']),
    )
  })
})

// ─── isPlatformProvider ───────────────────────────────────────────────────────

describe('isPlatformProvider', () => {
  it('returns true for valid providers', () => {
    expect(isPlatformProvider('google_gbp')).toBe(true)
    expect(isPlatformProvider('meta')).toBe(true)
    expect(isPlatformProvider('tiktok')).toBe(true)
  })

  it('returns false for invalid values', () => {
    expect(isPlatformProvider('google')).toBe(false)
    expect(isPlatformProvider('gbp')).toBe(false)
    expect(isPlatformProvider('')).toBe(false)
    expect(isPlatformProvider('GOOGLE_GBP')).toBe(false) // case-sensitive
  })
})

// ─── isTokenExpired ───────────────────────────────────────────────────────────

describe('isTokenExpired', () => {
  it('returns false when token expires well in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour ahead
    expect(isTokenExpired(future)).toBe(false)
  })

  it('returns true when token is already expired', () => {
    const past = new Date(Date.now() - 1000).toISOString() // 1 second ago
    expect(isTokenExpired(past)).toBe(true)
  })

  it('returns true when token expires within the 5-minute buffer', () => {
    const nearFuture = new Date(Date.now() + 4 * 60 * 1000).toISOString() // 4 min ahead
    expect(isTokenExpired(nearFuture)).toBe(true)
  })

  it('returns false when token expires just after the 5-minute buffer', () => {
    const justAfterBuffer = new Date(Date.now() + 6 * 60 * 1000).toISOString() // 6 min ahead
    expect(isTokenExpired(justAfterBuffer)).toBe(false)
  })
})

// ─── toConnectionSummary ──────────────────────────────────────────────────────

describe('toConnectionSummary', () => {
  it('strips encrypted token fields from the row', () => {
    const summary = toConnectionSummary(makeRow())
    expect(summary).not.toHaveProperty('access_token_enc')
    expect(summary).not.toHaveProperty('refresh_token_enc')
    expect(summary).not.toHaveProperty('token_expiry')
    expect(summary).not.toHaveProperty('client_id')
    expect(summary).not.toHaveProperty('created_at')
    expect(summary).not.toHaveProperty('updated_at')
  })

  it('includes all expected public fields', () => {
    const row = makeRow()
    const summary = toConnectionSummary(row)

    expect(summary.id).toBe(row.id)
    expect(summary.provider).toBe(row.provider)
    expect(summary.display_name).toBe(row.display_name)
    expect(summary.account_id).toBe(row.account_id)
    expect(summary.location_name).toBe(row.location_name)
    expect(summary.status).toBe(row.status)
    expect(summary.scopes).toEqual(row.scopes)
    expect(summary.last_synced_at).toBe(row.last_synced_at)
    expect(summary.error_message).toBe(row.error_message)
  })

  it('handles null location_name (non-GBP providers)', () => {
    const row = makeRow({ provider: 'meta', location_name: null })
    const summary = toConnectionSummary(row)
    expect(summary.location_name).toBeNull()
  })

  it('handles error status and error_message', () => {
    const row = makeRow({ status: 'error', error_message: 'Token refresh failed' })
    const summary = toConnectionSummary(row)
    expect(summary.status).toBe('error')
    expect(summary.error_message).toBe('Token refresh failed')
  })
})
