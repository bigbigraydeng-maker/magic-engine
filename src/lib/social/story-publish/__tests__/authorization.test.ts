import { describe, expect, it } from 'vitest'

import { judgeStoryAuthorization } from '../authorization'
import type { StoryAuthorization, StoryItemSpec } from '../types'

const NOW = new Date('2026-10-12T12:00:00.000Z')

const ADMIN_EMAILS: ReadonlySet<string> = new Set(['admin@example.com'])

const ITEM: StoryItemSpec = {
  item_id: 'item-1',
  pack_id: 'pack-1',
  client_id: 'client-1',
  channel: 'facebook_story',
  slot_at: '2026-10-12T13:00:00.000Z',
  media_kind: 'image',
  media_url: 'https://cdn.example.com/media/abc.png',
  media_sha256: 'a'.repeat(64),
  text_line: 'One line of text',
  account_id: 'page-1',
  source_record_ids: ['rec-1'],
  website_ref: 'https://example.com/facts',
  website_checked_on: '2026-10-12',
  has_reply_cta: false,
}

const CURRENT_FINGERPRINT = 'fingerprint-current'

function makeAuthorization(
  overrides: Partial<StoryAuthorization> = {},
): StoryAuthorization {
  return {
    id: 'auth-1',
    pack_id: 'pack-1',
    client_id: 'client-1',
    authorized_by_email: 'admin@example.com',
    authorized_by_user_id: 'user-1',
    authorized_at: '2026-10-12T11:00:00.000Z',
    activated_at: '2026-10-12T11:30:00.000Z',
    expires_at: '2026-10-12T14:00:00.000Z',
    revoked_at: null,
    ...overrides,
  }
}

function judge(
  overrides: {
    authorization?: StoryAuthorization | null
    item?: StoryItemSpec
    authorizedFingerprint?: string | null
    currentFingerprint?: string
    adminEmails?: ReadonlySet<string>
    now?: Date
  } = {},
) {
  return judgeStoryAuthorization({
    authorization:
      overrides.authorization === undefined
        ? makeAuthorization()
        : overrides.authorization,
    item: overrides.item ?? ITEM,
    authorizedFingerprint:
      overrides.authorizedFingerprint === undefined
        ? CURRENT_FINGERPRINT
        : overrides.authorizedFingerprint,
    currentFingerprint: overrides.currentFingerprint ?? CURRENT_FINGERPRINT,
    adminEmails: overrides.adminEmails ?? ADMIN_EMAILS,
    now: overrides.now ?? NOW,
  })
}

describe('judgeStoryAuthorization', () => {
  it('returns ACTIVE for the fully valid case', () => {
    expect(judge()).toBe('ACTIVE')
  })

  it('returns NONE when there is no authorization', () => {
    expect(judge({ authorization: null })).toBe('NONE')
  })

  it('returns WRONG_PACK when the pack ids differ', () => {
    expect(judge({ authorization: makeAuthorization({ pack_id: 'pack-2' }) })).toBe(
      'WRONG_PACK',
    )
  })

  it('returns WRONG_CLIENT when the client ids differ', () => {
    expect(
      judge({ authorization: makeAuthorization({ client_id: 'client-2' }) }),
    ).toBe('WRONG_CLIENT')
  })

  it('returns NOT_ACTIVATED when activated_at is null', () => {
    expect(judge({ authorization: makeAuthorization({ activated_at: null }) })).toBe(
      'NOT_ACTIVATED',
    )
  })

  it('returns NOT_ACTIVATED when activated_at is unparseable', () => {
    expect(
      judge({ authorization: makeAuthorization({ activated_at: 'not-a-date' }) }),
    ).toBe('NOT_ACTIVATED')
  })

  it('returns REVOKED when revoked_at is set', () => {
    expect(
      judge({
        authorization: makeAuthorization({ revoked_at: '2026-10-12T11:45:00.000Z' }),
      }),
    ).toBe('REVOKED')
  })

  it('returns EXPIRED when expires_at is in the past', () => {
    expect(
      judge({
        authorization: makeAuthorization({ expires_at: '2026-10-12T11:00:00.000Z' }),
      }),
    ).toBe('EXPIRED')
  })

  it('returns EXPIRED when expires_at is unparseable', () => {
    expect(
      judge({ authorization: makeAuthorization({ expires_at: 'not-a-date' }) }),
    ).toBe('EXPIRED')
  })

  it('returns EXPIRED when expires_at equals now exactly', () => {
    expect(
      judge({
        authorization: makeAuthorization({ expires_at: NOW.toISOString() }),
      }),
    ).toBe('EXPIRED')
  })

  it('returns ACTIVE one millisecond before expiry', () => {
    const expiresAt = new Date(NOW.getTime() + 1).toISOString()
    expect(
      judge({ authorization: makeAuthorization({ expires_at: expiresAt }) }),
    ).toBe('ACTIVE')
  })

  it('returns AUTHORIZER_NOT_ADMIN when the authorizer is not an admin', () => {
    expect(
      judge({
        authorization: makeAuthorization({
          authorized_by_email: 'someone@example.com',
        }),
      }),
    ).toBe('AUTHORIZER_NOT_ADMIN')
  })

  it('compares admin emails case-insensitively and trims whitespace', () => {
    expect(
      judge({
        authorization: makeAuthorization({
          authorized_by_email: '  ADMIN@Example.COM  ',
        }),
      }),
    ).toBe('ACTIVE')
  })

  it('returns NO_AUTHORIZED_FINGERPRINT when the stored fingerprint is null', () => {
    expect(judge({ authorizedFingerprint: null })).toBe('NO_AUTHORIZED_FINGERPRINT')
  })

  it('returns NO_AUTHORIZED_FINGERPRINT when the stored fingerprint is empty', () => {
    expect(judge({ authorizedFingerprint: '' })).toBe('NO_AUTHORIZED_FINGERPRINT')
  })

  it('returns FINGERPRINT_MISMATCH when the fingerprints differ', () => {
    expect(judge({ authorizedFingerprint: 'fingerprint-other' })).toBe(
      'FINGERPRINT_MISMATCH',
    )
  })

  describe('precedence', () => {
    it('prefers REVOKED over EXPIRED', () => {
      expect(
        judge({
          authorization: makeAuthorization({
            revoked_at: '2026-10-12T11:45:00.000Z',
            expires_at: '2026-10-12T11:00:00.000Z',
          }),
        }),
      ).toBe('REVOKED')
    })

    it('prefers NOT_ACTIVATED over REVOKED', () => {
      expect(
        judge({
          authorization: makeAuthorization({
            activated_at: null,
            revoked_at: '2026-10-12T11:45:00.000Z',
          }),
        }),
      ).toBe('NOT_ACTIVATED')
    })

    it('prefers WRONG_PACK over REVOKED', () => {
      expect(
        judge({
          authorization: makeAuthorization({
            pack_id: 'pack-2',
            revoked_at: '2026-10-12T11:45:00.000Z',
          }),
        }),
      ).toBe('WRONG_PACK')
    })
  })
})
