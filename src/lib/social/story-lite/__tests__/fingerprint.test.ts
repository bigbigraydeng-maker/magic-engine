import { describe, expect, it } from 'vitest'

import { computeItemFingerprint, computePackContentHash } from '../fingerprint'
import type { LiteItem } from '../types'

type Fingerprinted = Pick<
  LiteItem,
  'item_id' | 'channel' | 'slot_at' | 'media_kind' | 'media_url' | 'media_sha256' | 'text_line' | 'account_id' | 'source_ref'
>

function base(): Fingerprinted {
  return {
    item_id: 'item-1',
    channel: 'facebook_story',
    slot_at: '2026-10-13T09:00:00.000Z',
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello',
    account_id: '1234567890',
    source_ref: 'https://example.com/claim',
  }
}

describe('computeItemFingerprint', () => {
  it('is 64 lowercase hex and stable', () => {
    const first = computeItemFingerprint(base())
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(computeItemFingerprint(base())).toBe(first)
  })

  it('changes when any decisive field changes', () => {
    const original = computeItemFingerprint(base())
    const mutations: Array<[string, Partial<Fingerprinted>]> = [
      ['item_id', { item_id: 'item-2' }],
      ['channel', { channel: 'instagram_story' }],
      ['slot_at', { slot_at: '2026-10-13T09:00:01.000Z' }],
      ['media_kind', { media_kind: 'video' }],
      ['media_url', { media_url: 'https://cdn.example.com/b.png' }],
      ['media_sha256', { media_sha256: 'b'.repeat(64) }],
      ['text_line', { text_line: 'Goodbye' }],
      ['account_id', { account_id: '0987654321' }],
      ['source_ref', { source_ref: 'https://example.com/other' }],
    ]
    for (const [field, patch] of mutations) {
      const changed = computeItemFingerprint({ ...base(), ...patch })
      expect(changed, `field ${field} should change the fingerprint`).not.toBe(original)
    }
  })

  it('treats the same instant in different spellings as equal', () => {
    const z = computeItemFingerprint({ ...base(), slot_at: '2026-10-13T09:00:00Z' })
    const millis = computeItemFingerprint({ ...base(), slot_at: '2026-10-13T09:00:00.000Z' })
    const offset = computeItemFingerprint({ ...base(), slot_at: '2026-10-13T09:00:00+00:00' })
    expect(millis).toBe(z)
    expect(offset).toBe(z)
  })

  it('never equates an unreadable slot with a real one', () => {
    const real = computeItemFingerprint(base())
    const broken = computeItemFingerprint({ ...base(), slot_at: 'not-a-date' })
    expect(broken).not.toBe(real)
    expect(broken).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('computePackContentHash', () => {
  it('is order independent', () => {
    const a = base()
    const b = { ...base(), item_id: 'item-2' }
    expect(computePackContentHash([a, b], 7)).toBe(computePackContentHash([b, a], 7))
  })

  it('changes when any item changes', () => {
    const a = base()
    const b = { ...base(), item_id: 'item-2' }
    const original = computePackContentHash([a, b], 7)
    const changed = computePackContentHash([a, { ...b, text_line: 'Goodbye' }], 7)
    expect(changed).not.toBe(original)
  })

  it('changes with lifetimeDays', () => {
    const a = base()
    expect(computePackContentHash([a], 7)).not.toBe(computePackContentHash([a], 8))
  })

  it('throws on a duplicate item id', () => {
    const a = base()
    expect(() => computePackContentHash([a, { ...a }], 7)).toThrow('duplicate item id')
  })
})
