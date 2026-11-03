import { describe, expect, it } from 'vitest'

import { judgeStoryAuthorization } from '../authorization'
import { computeItemFingerprint, computeManifestHash } from '../fingerprint'
import { storyItemKey, type StoryAuthorization, type StoryItemSpec } from '../types'

const NOW = new Date('2026-10-12T12:00:00.000Z')

const ADMIN_EMAILS: ReadonlySet<string> = new Set(['admin@example.com'])

const EXPIRES_AT = '2026-10-12T14:00:00.000Z'

function makeItem(overrides: Partial<StoryItemSpec> = {}): StoryItemSpec {
  return {
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
    contains_price: false,
    names_place: false,
    ...overrides,
  }
}

interface AuthorizedFixture {
  authorization: StoryAuthorization
  item: StoryItemSpec
  packItems: StoryItemSpec[]
  adminEmails: ReadonlySet<string>
  now: Date
}

/**
 * Builds a fully valid, self-consistent fixture: the item is present in the
 * pack, the snapshot holds the real recomputed fingerprint for the item's key,
 * and the manifest hash is the real recomputed hash over the pack.
 */
function makeAuthorizedFixture(): AuthorizedFixture {
  const item = makeItem()
  const sibling = makeItem({
    item_id: 'item-2',
    channel: 'instagram_story',
    account_id: 'ig-1',
  })
  const packItems = [item, sibling]

  const authorization: StoryAuthorization = {
    id: 'auth-1',
    pack_id: 'pack-1',
    client_id: 'client-1',
    authorized_by_email: 'admin@example.com',
    authorized_by_user_id: 'user-1',
    authorized_at: '2026-10-12T11:00:00.000Z',
    activated_at: '2026-10-12T11:30:00.000Z',
    expires_at: EXPIRES_AT,
    revoked_at: null,
    manifest_hash: computeManifestHash(packItems, EXPIRES_AT),
    approved_item_fingerprints: {
      [storyItemKey(item)]: computeItemFingerprint(item, EXPIRES_AT),
      [storyItemKey(sibling)]: computeItemFingerprint(sibling, EXPIRES_AT),
    },
  }

  return { authorization, item, packItems, adminEmails: ADMIN_EMAILS, now: NOW }
}

function judge(
  overrides: {
    authorization?: StoryAuthorization | null
    item?: StoryItemSpec
    itemAuthorizationId?: string | null
    packItems?: StoryItemSpec[]
    adminEmails?: ReadonlySet<string>
    now?: Date
  } = {},
) {
  const fixture = makeAuthorizedFixture()
  return judgeStoryAuthorization({
    authorization:
      overrides.authorization === undefined
        ? fixture.authorization
        : overrides.authorization,
    item: overrides.item ?? fixture.item,
    itemAuthorizationId:
      overrides.itemAuthorizationId === undefined
        ? fixture.authorization.id
        : overrides.itemAuthorizationId,
    packItems: overrides.packItems ?? fixture.packItems,
    adminEmails: overrides.adminEmails ?? fixture.adminEmails,
    now: overrides.now ?? fixture.now,
  })
}

describe('judgeStoryAuthorization', () => {
  it('returns ACTIVE only for the fully valid fixture', () => {
    expect(judge()).toBe('ACTIVE')
  })

  it('returns NONE when there is no authorization', () => {
    expect(judge({ authorization: null })).toBe('NONE')
  })

  it('returns WRONG_PACK when the pack ids differ', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: { ...fixture.authorization, pack_id: 'pack-2' },
      }),
    ).toBe('WRONG_PACK')
  })

  it('returns WRONG_CLIENT when the client ids differ', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: { ...fixture.authorization, client_id: 'client-2' },
      }),
    ).toBe('WRONG_CLIENT')
  })

  it('returns NOT_ACTIVATED when activated_at is null', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({ authorization: { ...fixture.authorization, activated_at: null } }),
    ).toBe('NOT_ACTIVATED')
  })

  it('returns NOT_ACTIVATED when activated_at is unparseable', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: { ...fixture.authorization, activated_at: 'not-a-date' },
      }),
    ).toBe('NOT_ACTIVATED')
  })

  it('returns REVOKED when revoked_at is set', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          revoked_at: '2026-10-12T11:45:00.000Z',
        },
      }),
    ).toBe('REVOKED')
  })

  it('returns EXPIRED when expires_at is in the past', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          expires_at: '2026-10-12T11:00:00.000Z',
        },
      }),
    ).toBe('EXPIRED')
  })

  it('returns EXPIRED when expires_at is unparseable', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: { ...fixture.authorization, expires_at: 'not-a-date' },
      }),
    ).toBe('EXPIRED')
  })

  it('returns EXPIRED when expires_at equals now exactly', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          expires_at: NOW.toISOString(),
        },
      }),
    ).toBe('EXPIRED')
  })

  it('returns ACTIVE one millisecond before expiry', () => {
    const fixture = makeAuthorizedFixture()
    const expiresAt = new Date(NOW.getTime() + 1).toISOString()
    const item = fixture.item
    const packItems = fixture.packItems
    const authorization: StoryAuthorization = {
      ...fixture.authorization,
      expires_at: expiresAt,
      manifest_hash: computeManifestHash(packItems, expiresAt),
      approved_item_fingerprints: {
        ...fixture.authorization.approved_item_fingerprints,
        [storyItemKey(item)]: computeItemFingerprint(item, expiresAt),
      },
    }
    expect(judge({ authorization })).toBe('ACTIVE')
  })

  it('returns AUTHORIZER_NOT_ADMIN when the authorizer is not an admin', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          authorized_by_email: 'someone@example.com',
        },
      }),
    ).toBe('AUTHORIZER_NOT_ADMIN')
  })

  it('compares admin emails case-insensitively and trims whitespace', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          authorized_by_email: '  ADMIN@Example.COM  ',
        },
      }),
    ).toBe('ACTIVE')
  })

  it('returns AUTHORIZATION_ID_MISMATCH when the item row points at another authorization', () => {
    expect(judge({ itemAuthorizationId: 'auth-other' })).toBe(
      'AUTHORIZATION_ID_MISMATCH',
    )
  })

  it('returns AUTHORIZATION_ID_MISMATCH when the item row has no authorization id', () => {
    expect(judge({ itemAuthorizationId: null })).toBe('AUTHORIZATION_ID_MISMATCH')
  })

  it('returns NO_AUTHORIZED_FINGERPRINT when the key is missing from the snapshot', () => {
    const fixture = makeAuthorizedFixture()
    const snapshot = { ...fixture.authorization.approved_item_fingerprints }
    delete snapshot[storyItemKey(fixture.item)]
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          approved_item_fingerprints: snapshot,
        },
      }),
    ).toBe('NO_AUTHORIZED_FINGERPRINT')
  })

  it('returns NO_AUTHORIZED_FINGERPRINT when the stored fingerprint is empty', () => {
    const fixture = makeAuthorizedFixture()
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          approved_item_fingerprints: {
            ...fixture.authorization.approved_item_fingerprints,
            [storyItemKey(fixture.item)]: '',
          },
        },
      }),
    ).toBe('NO_AUTHORIZED_FINGERPRINT')
  })

  it('returns FINGERPRINT_MISMATCH when any item field changes after authorisation', () => {
    const fixture = makeAuthorizedFixture()
    const mutations: Array<Partial<StoryItemSpec>> = [
      { slot_at: '2026-10-12T13:30:00.000Z' },
      { media_kind: 'video' },
      { media_url: 'https://cdn.example.com/media/other.png' },
      { media_sha256: 'b'.repeat(64) },
      { text_line: 'A different line of text' },
      { account_id: 'page-2' },
      { source_record_ids: ['rec-1', 'rec-2'] },
      { website_ref: 'https://example.com/other' },
      { website_checked_on: '2026-10-11' },
      { has_reply_cta: true },
    ]

    for (const mutation of mutations) {
      const changedItem = makeItem(mutation)
      const packItems = fixture.packItems.map((candidate) =>
        storyItemKey(candidate) === storyItemKey(fixture.item)
          ? changedItem
          : candidate,
      )
      expect(judge({ item: changedItem, packItems })).toBe('FINGERPRINT_MISMATCH')
    }
  })

  it('returns FINGERPRINT_MISMATCH when only the authorization expires_at changed', () => {
    const fixture = makeAuthorizedFixture()
    const renewedExpiresAt = '2026-10-12T15:00:00.000Z'
    expect(
      judge({
        authorization: {
          ...fixture.authorization,
          expires_at: renewedExpiresAt,
        },
      }),
    ).toBe('FINGERPRINT_MISMATCH')
  })

  it('returns MANIFEST_MISMATCH when a sibling item is changed', () => {
    const fixture = makeAuthorizedFixture()
    const changedSibling = makeItem({
      item_id: 'item-2',
      channel: 'instagram_story',
      account_id: 'ig-1',
      text_line: 'Sibling changed',
    })
    const packItems = fixture.packItems.map((candidate) =>
      storyItemKey(candidate) === storyItemKey(changedSibling)
        ? changedSibling
        : candidate,
    )
    expect(judge({ packItems })).toBe('MANIFEST_MISMATCH')
  })

  it('returns MANIFEST_MISMATCH when a sibling item is added', () => {
    const fixture = makeAuthorizedFixture()
    const extra = makeItem({
      item_id: 'item-3',
      channel: 'facebook_story',
      account_id: 'page-3',
    })
    expect(judge({ packItems: [...fixture.packItems, extra] })).toBe(
      'MANIFEST_MISMATCH',
    )
  })

  it('returns MANIFEST_MISMATCH when a sibling item is removed', () => {
    const fixture = makeAuthorizedFixture()
    const packItems = fixture.packItems.filter(
      (candidate) => storyItemKey(candidate) !== 'item-2:instagram_story',
    )
    expect(judge({ packItems })).toBe('MANIFEST_MISMATCH')
  })

  it('returns MANIFEST_MISMATCH when the item itself is not in packItems', () => {
    const fixture = makeAuthorizedFixture()
    const packItems = fixture.packItems.filter(
      (candidate) => storyItemKey(candidate) !== storyItemKey(fixture.item),
    )
    expect(judge({ packItems })).toBe('MANIFEST_MISMATCH')
  })

  it('returns MANIFEST_MISMATCH when packItems contains a duplicate key', () => {
    const fixture = makeAuthorizedFixture()
    const duplicate = makeItem({
      item_id: 'item-2',
      channel: 'instagram_story',
      account_id: 'ig-1',
    })
    expect(judge({ packItems: [...fixture.packItems, duplicate] })).toBe(
      'MANIFEST_MISMATCH',
    )
  })

  it('never resolves a prototype property name as an approved fingerprint', () => {
    for (const itemId of ['__proto__', 'constructor', 'toString']) {
      const fixture = makeAuthorizedFixture()
      const protoItem = makeItem({ item_id: itemId })
      const packItems = [protoItem]
      // the snapshot has NO own entry for this item
      const authorization: StoryAuthorization = {
        ...fixture.authorization,
        manifest_hash: computeManifestHash(packItems, EXPIRES_AT),
        approved_item_fingerprints: {},
      }
      expect(judge({ authorization, item: protoItem, packItems })).toBe('NO_AUTHORIZED_FINGERPRINT')
    }
  })

  describe('precedence', () => {
    it('prefers REVOKED over EXPIRED', () => {
      const fixture = makeAuthorizedFixture()
      expect(
        judge({
          authorization: {
            ...fixture.authorization,
            revoked_at: '2026-10-12T11:45:00.000Z',
            expires_at: '2026-10-12T11:00:00.000Z',
          },
        }),
      ).toBe('REVOKED')
    })

    it('prefers NOT_ACTIVATED over REVOKED', () => {
      const fixture = makeAuthorizedFixture()
      expect(
        judge({
          authorization: {
            ...fixture.authorization,
            activated_at: null,
            revoked_at: '2026-10-12T11:45:00.000Z',
          },
        }),
      ).toBe('NOT_ACTIVATED')
    })

    it('prefers WRONG_PACK over REVOKED', () => {
      const fixture = makeAuthorizedFixture()
      expect(
        judge({
          authorization: {
            ...fixture.authorization,
            pack_id: 'pack-2',
            revoked_at: '2026-10-12T11:45:00.000Z',
          },
        }),
      ).toBe('WRONG_PACK')
    })

    it('prefers AUTHORIZATION_ID_MISMATCH over FINGERPRINT_MISMATCH', () => {
      const fixture = makeAuthorizedFixture()
      const changedItem = makeItem({ text_line: 'Changed' })
      const packItems = fixture.packItems.map((candidate) =>
        storyItemKey(candidate) === storyItemKey(fixture.item)
          ? changedItem
          : candidate,
      )
      expect(
        judge({
          item: changedItem,
          packItems,
          itemAuthorizationId: 'auth-other',
        }),
      ).toBe('AUTHORIZATION_ID_MISMATCH')
    })

    it('prefers FINGERPRINT_MISMATCH over MANIFEST_MISMATCH', () => {
      const fixture = makeAuthorizedFixture()
      const changedItem = makeItem({ text_line: 'Changed' })
      const packItems = fixture.packItems.map((candidate) =>
        storyItemKey(candidate) === storyItemKey(fixture.item)
          ? changedItem
          : candidate,
      )
      expect(judge({ item: changedItem, packItems })).toBe('FINGERPRINT_MISMATCH')
    })
  })
})
