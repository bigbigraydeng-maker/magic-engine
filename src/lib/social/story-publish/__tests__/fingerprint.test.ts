import { describe, expect, it } from 'vitest'
import { canonicalFingerprintInput, computeItemFingerprint } from '../fingerprint'
import type { StoryItemSpec } from '../types'

const EXPIRES_AT = '2026-11-01T00:00:00.000Z'

function baseItem(): StoryItemSpec {
  return {
    item_id: 'item-0001',
    pack_id: 'pack-0001',
    client_id: '00000000-0000-0000-0000-000000000001',
    channel: 'facebook_story',
    slot_at: '2026-10-20T09:00:00.000Z',
    media_kind: 'image',
    media_url: 'https://cdn.example.com/story/item-0001.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Did you know this?',
    account_id: 'page-1234567890',
    source_record_ids: ['record-a', 'record-b'],
    website_ref: 'https://example.com/facts/item-0001',
    website_checked_on: '2026-10-10',
    has_reply_cta: false,
  }
}

const HEX_64 = /^[0-9a-f]{64}$/

describe('computeItemFingerprint', () => {
  it('returns 64 lowercase hex characters', () => {
    const hash = computeItemFingerprint(baseItem(), EXPIRES_AT)
    expect(hash).toMatch(HEX_64)
  })

  it('is stable for the same item and expiry', () => {
    const first = computeItemFingerprint(baseItem(), EXPIRES_AT)
    const second = computeItemFingerprint(baseItem(), EXPIRES_AT)
    expect(first).toBe(second)
  })

  it('does not depend on the key order of the input object', () => {
    const item = baseItem()
    const reordered: StoryItemSpec = {
      has_reply_cta: item.has_reply_cta,
      website_checked_on: item.website_checked_on,
      website_ref: item.website_ref,
      source_record_ids: item.source_record_ids,
      account_id: item.account_id,
      text_line: item.text_line,
      media_sha256: item.media_sha256,
      media_url: item.media_url,
      media_kind: item.media_kind,
      slot_at: item.slot_at,
      channel: item.channel,
      client_id: item.client_id,
      pack_id: item.pack_id,
      item_id: item.item_id,
    }

    expect(computeItemFingerprint(reordered, EXPIRES_AT)).toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
  })

  it('changes when any single field changes', () => {
    const baseHash = computeItemFingerprint(baseItem(), EXPIRES_AT)

    const mutations: Array<{ name: string; mutate: (item: StoryItemSpec) => StoryItemSpec }> = [
      { name: 'item_id', mutate: (i) => ({ ...i, item_id: i.item_id + 'x' }) },
      { name: 'pack_id', mutate: (i) => ({ ...i, pack_id: i.pack_id + 'x' }) },
      { name: 'client_id', mutate: (i) => ({ ...i, client_id: i.client_id + 'x' }) },
      {
        name: 'channel',
        mutate: (i) => ({
          ...i,
          channel: i.channel === 'facebook_story' ? 'instagram_story' : 'facebook_story',
        }),
      },
      { name: 'slot_at', mutate: (i) => ({ ...i, slot_at: i.slot_at + 'x' }) },
      {
        name: 'media_kind',
        mutate: (i) => ({ ...i, media_kind: i.media_kind === 'image' ? 'video' : 'image' }),
      },
      { name: 'media_url', mutate: (i) => ({ ...i, media_url: i.media_url + 'x' }) },
      { name: 'media_sha256', mutate: (i) => ({ ...i, media_sha256: i.media_sha256 + 'x' }) },
      { name: 'text_line', mutate: (i) => ({ ...i, text_line: i.text_line + 'x' }) },
      { name: 'account_id', mutate: (i) => ({ ...i, account_id: i.account_id + 'x' }) },
      {
        name: 'source_record_ids',
        mutate: (i) => ({ ...i, source_record_ids: [...i.source_record_ids, 'record-c'] }),
      },
      { name: 'website_ref', mutate: (i) => ({ ...i, website_ref: i.website_ref + 'x' }) },
      {
        name: 'website_checked_on',
        mutate: (i) => ({ ...i, website_checked_on: i.website_checked_on + 'x' }),
      },
      { name: 'has_reply_cta', mutate: (i) => ({ ...i, has_reply_cta: !i.has_reply_cta }) },
    ]

    const hashes = mutations.map(({ name, mutate }) => {
      const hash = computeItemFingerprint(mutate(baseItem()), EXPIRES_AT)
      expect(hash, `mutation of ${name} should change the hash`).not.toBe(baseHash)
      return hash
    })

    // Every mutation must also be distinct from every other mutation.
    expect(new Set(hashes).size).toBe(hashes.length)
  })

  it('is insensitive to the order of source_record_ids but sensitive to their content', () => {
    const item = baseItem()
    const reversed: StoryItemSpec = { ...item, source_record_ids: ['record-b', 'record-a'] }
    const changed: StoryItemSpec = { ...item, source_record_ids: ['record-a', 'record-c'] }

    expect(computeItemFingerprint(reversed, EXPIRES_AT)).toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
    expect(computeItemFingerprint(changed, EXPIRES_AT)).not.toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
  })

  it('changes when expiresAt changes', () => {
    const item = baseItem()
    expect(computeItemFingerprint(item, '2026-11-02T00:00:00.000Z')).not.toBe(
      computeItemFingerprint(item, EXPIRES_AT),
    )
  })

  it('does not mutate the input item', () => {
    const item = baseItem()
    const clone: StoryItemSpec = { ...item, source_record_ids: [...item.source_record_ids] }

    computeItemFingerprint(item, EXPIRES_AT)

    expect(item).toEqual(clone)
  })
})

describe('canonicalFingerprintInput', () => {
  it('serialises the fields in the fixed canonical order', () => {
    const item = baseItem()
    const parsed = JSON.parse(canonicalFingerprintInput(item, EXPIRES_AT)) as Record<string, unknown>

    expect(Object.keys(parsed)).toEqual([
      'item_id',
      'pack_id',
      'client_id',
      'channel',
      'slot_at',
      'media_kind',
      'media_url',
      'media_sha256',
      'text_line',
      'account_id',
      'source_record_ids',
      'website_ref',
      'website_checked_on',
      'has_reply_cta',
      'expires_at',
    ])
  })

  it('sorts source_record_ids without mutating the input array', () => {
    const item = baseItem()
    const original = [...item.source_record_ids]

    const parsed = JSON.parse(canonicalFingerprintInput(item, EXPIRES_AT)) as {
      source_record_ids: string[]
    }

    expect(parsed.source_record_ids).toEqual([...original].sort())
    expect(item.source_record_ids).toEqual(original)
  })
})
