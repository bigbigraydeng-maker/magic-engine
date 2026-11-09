import { describe, expect, it } from 'vitest'
import { decideStoryPublish, type StoryGateInput } from '../gates'
import {
  STORY_ATTEMPT_STATUSES,
  STORY_TERMINAL_STATUSES,
  storyItemKey,
  type StoryAuthorization,
  type StoryItemSpec,
} from '../types'
import { computeItemFingerprint, computeManifestHash } from '../fingerprint'

const NOW = new Date('2026-10-12T09:00:00.000Z')
const EXPIRES = '2026-10-19T09:00:00.000Z'

function baseItem(overrides: Partial<StoryItemSpec> = {}): StoryItemSpec {
  return {
    item_id: 'item-1',
    pack_id: 'pack-1',
    client_id: 'client-1',
    channel: 'facebook_story',
    slot_at: NOW.toISOString(),
    media_kind: 'image',
    media_url: 'https://cdn.example.com/a.png',
    media_sha256: 'a'.repeat(64),
    text_line: 'Hello',
    account_id: '55566677788',
    source_record_ids: ['rec-1'],
    website_ref: 'https://example.com/about',
    website_checked_on: '2026-10-12',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
    ...overrides,
  }
}

function makeAuth(items: StoryItemSpec[]): StoryAuthorization {
  return {
    id: 'auth-1',
    pack_id: 'pack-1',
    client_id: 'client-1',
    authorized_by_email: 'pm@example.com',
    authorized_by_user_id: 'user-1',
    authorized_at: '2026-10-11T09:00:00.000Z',
    activated_at: '2026-10-11T09:01:00.000Z',
    expires_at: EXPIRES,
    revoked_at: null,
    manifest_hash: computeManifestHash(items, EXPIRES),
    approved_item_fingerprints: Object.fromEntries(
      items.map(i => [storyItemKey(i), computeItemFingerprint(i, EXPIRES)]),
    ),
  }
}

function baseInput(overrides: Partial<StoryGateInput> = {}): StoryGateInput {
  // An overridden item is authorised as-is unless the test passes its own `auth`
  // (tamper tests pass an `auth` built from the original item).
  const item = overrides.item ?? baseItem()
  return {
    now: NOW,
    item,
    auth: {
      authorization: makeAuth([item]),
      itemAuthorizationId: 'auth-1',
      packItems: [item],
      adminEmails: new Set(['pm@example.com']),
    },
    switches: { live: true, clientIds: ['client-1'], channels: ['facebook_story'] },
    clientStatus: 'active',
    campaignStatus: 'active',
    registeredAccountId: '55566677788',
    circuit: { itemPaused: false, packChannelPaused: false },
    fileCheck: 'OK',
    assetUsage: 'UNUSED',
    priceGate: 'OK',
    replyOwnerPresent: true,
    existingAttempt: null,
    config: {
      maxLateMinutes: 30,
      earlyMinutes: 30,
      staleClaimMinutes: 15,
      stalePublishingMinutes: 10,
      maxWebsiteAgeDays: 7,
      maxRetries: 3,
    },
    ...overrides,
  }
}

/** The only allowed cast: lets a test pass an out-of-union string as a union field. */
function asFile(v: string): StoryGateInput['fileCheck'] {
  return v as StoryGateInput['fileCheck']
}
function asPrice(v: string): StoryGateInput['priceGate'] {
  return v as StoryGateInput['priceGate']
}

function withConfig(overrides: Partial<StoryGateInput['config']>): StoryGateInput {
  const base = baseInput()
  return { ...base, config: { ...base.config, ...overrides } }
}

// ─── 1. BAD_CONFIG ────────────────────────────────────────────────────────────

describe('BAD_CONFIG', () => {
  const numericKeys: Array<keyof StoryGateInput['config']> = [
    'maxLateMinutes',
    'earlyMinutes',
    'staleClaimMinutes',
    'stalePublishingMinutes',
    'maxWebsiteAgeDays',
  ]

  for (const key of numericKeys) {
    it(`blocks NaN ${key}`, () => {
      const d = decideStoryPublish(withConfig({ [key]: Number.NaN }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
    })
    it(`blocks Infinity ${key}`, () => {
      const d = decideStoryPublish(withConfig({ [key]: Number.POSITIVE_INFINITY }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
    })
    it(`blocks -1 ${key}`, () => {
      const d = decideStoryPublish(withConfig({ [key]: -1 }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
    })
  }

  it('blocks maxRetries 1.5', () => {
    const d = decideStoryPublish(withConfig({ maxRetries: 1.5 }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
  })

  it('blocks maxRetries -1', () => {
    const d = decideStoryPublish(withConfig({ maxRetries: -1 }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
  })

  it('blocks an invalid Date now', () => {
    const d = decideStoryPublish(baseInput({ now: new Date('nope') }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
  })

  it('never PUBLISHes with NaN earlyMinutes even when the slot is a day in the future', () => {
    const future = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString()
    const d = decideStoryPublish(
      baseInput({ item: baseItem({ slot_at: future }), config: { ...baseInput().config, earlyMinutes: Number.NaN } }),
    )
    expect(d.action).not.toBe('PUBLISH')
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'BAD_CONFIG', retryable: false })
  })
})

// ─── 2. Website check ─────────────────────────────────────────────────────────

describe('website check', () => {
  for (const bad of ['2026-13-01', '2026-02-31', '2026-10-1', '', 'abc']) {
    it(`blocks website_checked_on ${JSON.stringify(bad)}`, () => {
      const d = decideStoryPublish(baseInput({ item: baseItem({ website_checked_on: bad }) }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'WEBSITE_CHECK_STALE', retryable: true })
    })
  }

  // JavaScript date parsing rolls an impossible day over to the next month
  // ('2026-02-31' -> 2026-03-03). Choose "now" so the rolled-over date would look fresh.
  for (const [bad, nowIso] of [
    ['2026-02-31', '2026-03-03T09:00:00.000Z'],
    ['2026-04-31', '2026-05-01T09:00:00.000Z'],
    ['2026-02-30', '2026-03-02T09:00:00.000Z'],
  ] as const) {
    it(`blocks the impossible date ${bad} even when its rolled-over date would look fresh`, () => {
      const now = new Date(nowIso)
      const item = baseItem({ slot_at: nowIso, website_checked_on: bad })
      const d = decideStoryPublish(baseInput({ now, item }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'WEBSITE_CHECK_STALE', retryable: true })
    })
  }

  it('passes at exactly maxWebsiteAgeDays old', () => {
    // NOW is 2026-10-12; 7 days earlier is 2026-10-05.
    const d = decideStoryPublish(baseInput({ item: baseItem({ website_checked_on: '2026-10-05' }) }))
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it('blocks one day older than maxWebsiteAgeDays', () => {
    const d = decideStoryPublish(baseInput({ item: baseItem({ website_checked_on: '2026-10-04' }) }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'WEBSITE_CHECK_STALE', retryable: true })
  })

  it('passes one day in the future', () => {
    const d = decideStoryPublish(baseInput({ item: baseItem({ website_checked_on: '2026-10-13' }) }))
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it('blocks two days in the future', () => {
    const d = decideStoryPublish(baseInput({ item: baseItem({ website_checked_on: '2026-10-14' }) }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'WEBSITE_CHECK_STALE', retryable: true })
  })
})

// ─── 3. Fail-closed on unexpected runtime values ──────────────────────────────

describe('fail-closed on unexpected runtime values', () => {
  it('fileCheck weird => BLOCKED FILE_CHANGED', () => {
    const d = decideStoryPublish(baseInput({ fileCheck: asFile('weird') }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'FILE_CHANGED', retryable: false })
  })

  it('priceGate weird => BLOCKED PRICE_GATE_BLOCKED', () => {
    const d = decideStoryPublish(baseInput({ priceGate: asPrice('weird') }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'PRICE_GATE_BLOCKED', retryable: false })
  })

  it('fileCheck UNREACHABLE => RETRYABLE FILE_UNREACHABLE retryable true', () => {
    const d = decideStoryPublish(baseInput({ fileCheck: 'UNREACHABLE' }))
    expect(d).toEqual({ action: 'RECORD', status: 'RETRYABLE', reason_code: 'FILE_UNREACHABLE', retryable: true })
  })

  it('priceGate ERROR => BLOCKED PRICE_GATE_ERROR retryable true', () => {
    const d = decideStoryPublish(baseInput({ priceGate: 'ERROR' }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'PRICE_GATE_ERROR', retryable: true })
  })
})

// ─── 4. Unknown / terminal existing statuses ──────────────────────────────────

describe('existing attempt statuses', () => {
  it('unknown status SOMETHING_NEW => BLOCKED UNKNOWN_EXISTING_STATUS', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'SOMETHING_NEW', updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 0 },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'UNKNOWN_EXISTING_STATUS', retryable: false })
  })

  it('every known status yields a defined decision', () => {
    for (const status of STORY_ATTEMPT_STATUSES) {
      const d = decideStoryPublish(
        baseInput({
          existingAttempt: { status, updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 0 },
        }),
      )
      expect(d).toBeDefined()
      expect(typeof d.action).toBe('string')
    }
  })

  it('no terminal status can yield PUBLISH', () => {
    for (const status of STORY_TERMINAL_STATUSES) {
      const d = decideStoryPublish(
        baseInput({
          existingAttempt: { status, updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 0 },
        }),
      )
      expect(d.action).not.toBe('PUBLISH')
    }
  })
})

// ─── 5. In-flight boundaries ──────────────────────────────────────────────────

describe('in-flight boundaries', () => {
  it('PUBLISHING fresh (5 min ago) => SKIP IN_PROGRESS', () => {
    const updated = new Date(NOW.getTime() - 5 * 60_000).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'PUBLISHING', updated_at: updated, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'SKIP', reason_code: 'IN_PROGRESS' })
  })

  it('PUBLISHING exactly stalePublishingMinutes ago => still SKIP', () => {
    const updated = new Date(NOW.getTime() - 10 * 60_000).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'PUBLISHING', updated_at: updated, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'SKIP', reason_code: 'IN_PROGRESS' })
  })

  it('PUBLISHING 1 ms older than stalePublishingMinutes => UNKNOWN_OUTCOME STALE_PUBLISHING', () => {
    const updated = new Date(NOW.getTime() - 10 * 60_000 - 1).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'PUBLISHING', updated_at: updated, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'UNKNOWN_OUTCOME', reason_code: 'STALE_PUBLISHING', retryable: false })
  })

  it('PUBLISHING unparseable updated_at => UNKNOWN_OUTCOME', () => {
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'PUBLISHING', updated_at: 'nope', next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'UNKNOWN_OUTCOME', reason_code: 'STALE_PUBLISHING', retryable: false })
  })

  it('CLAIMED fresh (5 min ago) => SKIP IN_PROGRESS', () => {
    const updated = new Date(NOW.getTime() - 5 * 60_000).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'CLAIMED', updated_at: updated, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'SKIP', reason_code: 'IN_PROGRESS' })
  })

  it('CLAIMED exactly staleClaimMinutes ago => still SKIP', () => {
    const updated = new Date(NOW.getTime() - 15 * 60_000).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'CLAIMED', updated_at: updated, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'SKIP', reason_code: 'IN_PROGRESS' })
  })

  it('CLAIMED 1 ms older than staleClaimMinutes => UNKNOWN_OUTCOME STALE_CLAIM', () => {
    const updated = new Date(NOW.getTime() - 15 * 60_000 - 1).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'CLAIMED', updated_at: updated, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'UNKNOWN_OUTCOME', reason_code: 'STALE_CLAIM', retryable: false })
  })

  it('CLAIMED unparseable updated_at => UNKNOWN_OUTCOME', () => {
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'CLAIMED', updated_at: 'nope', next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'UNKNOWN_OUTCOME', reason_code: 'STALE_CLAIM', retryable: false })
  })

  it('CONTAINER_CREATED any age => SKIP IN_PROGRESS', () => {
    const old = new Date(NOW.getTime() - 60 * 60_000).toISOString()
    const d = decideStoryPublish(
      baseInput({ existingAttempt: { status: 'CONTAINER_CREATED', updated_at: old, next_retry_at: null, retry_count: 0 } }),
    )
    expect(d).toEqual({ action: 'SKIP', reason_code: 'IN_PROGRESS' })
  })
})

// ─── 6. RETRYABLE ─────────────────────────────────────────────────────────────

describe('RETRYABLE', () => {
  it('retry_count 3 with maxRetries 3 => BLOCKED FILE_UNREACHABLE retryable false', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'RETRYABLE', updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 3 },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'FILE_UNREACHABLE', retryable: false })
  })

  it('next_retry_at in the future => SKIP WAITING_RETRY', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString()
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'RETRYABLE', updated_at: NOW.toISOString(), next_retry_at: future, retry_count: 1 },
      }),
    )
    expect(d).toEqual({ action: 'SKIP', reason_code: 'WAITING_RETRY' })
  })

  it('next_retry_at null => BLOCKED RETRY_STATE_INVALID (never waits forever)', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'RETRYABLE', updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 1 },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'RETRY_STATE_INVALID', retryable: false })
  })

  it('next_retry_at garbage => BLOCKED RETRY_STATE_INVALID', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'RETRYABLE', updated_at: NOW.toISOString(), next_retry_at: 'nope', retry_count: 1 },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'RETRY_STATE_INVALID', retryable: false })
  })

  it('next_retry_at equal to now => falls through to normal evaluation (PUBLISH)', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'RETRYABLE', updated_at: NOW.toISOString(), next_retry_at: NOW.toISOString(), retry_count: 1 },
      }),
    )
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it('retry_count 2 allowed (falls through to PUBLISH)', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'RETRYABLE', updated_at: NOW.toISOString(), next_retry_at: NOW.toISOString(), retry_count: 2 },
      }),
    )
    expect(d).toEqual({ action: 'PUBLISH' })
  })
})

// ─── 7. ACCOUNT_MISMATCH ──────────────────────────────────────────────────────

describe('ACCOUNT_MISMATCH', () => {
  it('registeredAccountId null => BLOCKED ACCOUNT_MISMATCH', () => {
    const d = decideStoryPublish(baseInput({ registeredAccountId: null }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'ACCOUNT_MISMATCH', retryable: false })
  })

  it("registeredAccountId '' => BLOCKED ACCOUNT_MISMATCH", () => {
    const d = decideStoryPublish(baseInput({ registeredAccountId: '' }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'ACCOUNT_MISMATCH', retryable: false })
  })

  it('registeredAccountId different => BLOCKED ACCOUNT_MISMATCH', () => {
    const d = decideStoryPublish(baseInput({ registeredAccountId: '99999999999' }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'ACCOUNT_MISMATCH', retryable: false })
  })

  it('unauthorised item with mismatching account reports SKIPPED_NOT_AUTHORIZED first', () => {
    const item = baseItem()
    const d = decideStoryPublish(
      baseInput({
        item,
        auth: {
          authorization: makeAuth([item]),
          itemAuthorizationId: null,
          packItems: [item],
          adminEmails: new Set(['pm@example.com']),
        },
        registeredAccountId: '99999999999',
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'SKIPPED_NOT_AUTHORIZED', reason_code: 'AUTHORIZATION_ID_MISMATCH', retryable: false })
  })
})

// ─── 8. REPLY_CTA_UNDECLARED ──────────────────────────────────────────────────

describe('REPLY_CTA_UNDECLARED', () => {
  it("text_line 'Reply for details' with has_reply_cta false => BLOCKED", () => {
    const d = decideStoryPublish(baseInput({ item: baseItem({ text_line: 'Reply for details' }) }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'REPLY_CTA_UNDECLARED', retryable: false })
  })

  it('with has_reply_cta true and replyOwnerPresent true => PUBLISH', () => {
    const d = decideStoryPublish(
      baseInput({ item: baseItem({ text_line: 'Reply for details', has_reply_cta: true }), replyOwnerPresent: true }),
    )
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it("'Replying' alone does not match", () => {
    const d = decideStoryPublish(baseInput({ item: baseItem({ text_line: 'Replying to everyone' }) }))
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it("'DM us' matches", () => {
    const d = decideStoryPublish(baseInput({ item: baseItem({ text_line: 'DM us for a quote' }) }))
    expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'REPLY_CTA_UNDECLARED', retryable: false })
  })
})

// ─── 9. Authorization freshness ───────────────────────────────────────────────

describe('authorization freshness', () => {
  it('changing the item text after authorisation => FINGERPRINT_MISMATCH', () => {
    const approved = baseItem()
    const auth = makeAuth([approved])
    const changed = baseItem({ text_line: 'Changed after approval' })
    const d = decideStoryPublish(
      baseInput({
        item: changed,
        auth: { authorization: auth, itemAuthorizationId: 'auth-1', packItems: [approved], adminEmails: new Set(['pm@example.com']) },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'SKIPPED_NOT_AUTHORIZED', reason_code: 'FINGERPRINT_MISMATCH', retryable: false })
  })

  it('authorization expires_at changed (renewal) => FINGERPRINT_MISMATCH', () => {
    const item = baseItem()
    const auth = makeAuth([item])
    const renewed: StoryAuthorization = { ...auth, expires_at: '2026-10-26T09:00:00.000Z' }
    const d = decideStoryPublish(
      baseInput({
        item,
        auth: { authorization: renewed, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'SKIPPED_NOT_AUTHORIZED', reason_code: 'FINGERPRINT_MISMATCH', retryable: false })
  })

  it('sibling changed => MANIFEST_MISMATCH', () => {
    const item = baseItem()
    const sibling = baseItem({ item_id: 'item-2' })
    const auth = makeAuth([item, sibling])
    const changedSibling = baseItem({ item_id: 'item-2', text_line: 'Sibling changed' })
    const d = decideStoryPublish(
      baseInput({
        item,
        auth: {
          authorization: auth,
          itemAuthorizationId: 'auth-1',
          packItems: [item, changedSibling],
          adminEmails: new Set(['pm@example.com']),
        },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'SKIPPED_NOT_AUTHORIZED', reason_code: 'MANIFEST_MISMATCH', retryable: false })
  })

  it('itemAuthorizationId null => AUTHORIZATION_ID_MISMATCH', () => {
    const item = baseItem()
    const d = decideStoryPublish(
      baseInput({
        item,
        auth: { authorization: makeAuth([item]), itemAuthorizationId: null, packItems: [item], adminEmails: new Set(['pm@example.com']) },
      }),
    )
    expect(d).toEqual({ action: 'RECORD', status: 'SKIPPED_NOT_AUTHORIZED', reason_code: 'AUTHORIZATION_ID_MISMATCH', retryable: false })
  })
})

// ─── 10. DRY_RUN / non-blocking existing attempts fall through ────────────────

describe('non-blocking existing attempts fall through', () => {
  it('existing DRY_RUN + live switches => PUBLISH', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'DRY_RUN', updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 0 },
      }),
    )
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it('existing BLOCKED falls through => PUBLISH', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'BLOCKED', updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 0 },
      }),
    )
    expect(d).toEqual({ action: 'PUBLISH' })
  })

  it('existing SKIPPED_NOT_AUTHORIZED falls through => PUBLISH', () => {
    const d = decideStoryPublish(
      baseInput({
        existingAttempt: { status: 'SKIPPED_NOT_AUTHORIZED', updated_at: NOW.toISOString(), next_retry_at: null, retry_count: 0 },
      }),
    )
    expect(d).toEqual({ action: 'PUBLISH' })
  })
})

// ─── 11. Asset usage (Facebook refuses a Story from an already-published file) ──

describe('asset usage gate', () => {
  it('blocks a Facebook story whose file was already used', () => {
    expect(decideStoryPublish(baseInput({ assetUsage: 'USED' }))).toEqual({
      action: 'RECORD', status: 'BLOCKED', reason_code: 'ASSET_ALREADY_USED', retryable: false,
    })
  })

  it('blocks a Facebook story whose usage is unknown (a missing record never passes)', () => {
    expect(decideStoryPublish(baseInput({ assetUsage: 'UNKNOWN' }))).toEqual({
      action: 'RECORD', status: 'BLOCKED', reason_code: 'ASSET_USAGE_UNKNOWN', retryable: false,
    })
  })

  it('blocks any unexpected runtime value on Facebook', () => {
    const weird = 'maybe' as StoryGateInput['assetUsage']
    const d = decideStoryPublish(baseInput({ assetUsage: weird }))
    expect(d.action).toBe('RECORD')
  })

  it('does not apply the rule to Instagram stories', () => {
    const item = baseItem({ channel: 'instagram_story' })
    const switches = { live: true, clientIds: ['client-1'], channels: ['instagram_story' as const] }
    for (const assetUsage of ['USED', 'UNKNOWN'] as const) {
      expect(decideStoryPublish(baseInput({ item, assetUsage, switches }))).toEqual({ action: 'PUBLISH' })
    }
  })

  it('passes a Facebook story with an unused file', () => {
    expect(decideStoryPublish(baseInput({ assetUsage: 'UNUSED' }))).toEqual({ action: 'PUBLISH' })
  })
})

// ─── 12. Chinese reply words and RETRYABLE state integrity ──────────────────────

describe('reply words in Chinese', () => {
  for (const text of ['欢迎回复了解详情', '私信我们', '留言咨询', '评论告诉我']) {
    it(`blocks undeclared reply call "${text}"`, () => {
      const d = decideStoryPublish(baseInput({ item: baseItem({ text_line: text }) }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'REPLY_CTA_UNDECLARED', retryable: false })
    })
  }
})

describe('RETRYABLE row integrity', () => {
  const retry = (over: Partial<NonNullable<StoryGateInput['existingAttempt']>>) =>
    baseInput({
      existingAttempt: {
        status: 'RETRYABLE', updated_at: NOW.toISOString(),
        next_retry_at: NOW.toISOString(), retry_count: 1, ...over,
      },
    })

  it('blocks a RETRYABLE row without a retry time instead of waiting forever', () => {
    for (const next_retry_at of [null, 'garbage']) {
      expect(decideStoryPublish(retry({ next_retry_at }))).toEqual({
        action: 'RECORD', status: 'BLOCKED', reason_code: 'RETRY_STATE_INVALID', retryable: false,
      })
    }
  })

  it('blocks a RETRYABLE row whose retry_count is not a finite number', () => {
    for (const retry_count of [NaN, Infinity]) {
      expect(decideStoryPublish(retry({ retry_count })).action).toBe('RECORD')
    }
  })
})

// ─── 13. Price in the text must be declared ─────────────────────────────────────

describe('price declared', () => {
  for (const text of ['From NZ$3,480 per person', 'Only 2,699 NZD', '4 days, 10 dollars a day', '价格 3480 元', '纽币 3,480', 'Twin share, per person']) {
    it(`blocks the undeclared price "${text}"`, () => {
      const d = decideStoryPublish(baseInput({ item: baseItem({ text_line: text, contains_price: false }) }))
      expect(d).toEqual({ action: 'RECORD', status: 'BLOCKED', reason_code: 'PRICE_UNDECLARED', retryable: false })
    })
  }

  it('lets a declared price through to the normal price gate', () => {
    const item = baseItem({ text_line: 'From NZ$3,480 per person', contains_price: true })
    expect(decideStoryPublish(baseInput({ item, priceGate: 'OK' }))).toEqual({ action: 'PUBLISH' })
    expect(decideStoryPublish(baseInput({ item, priceGate: 'BLOCKED' }))).toMatchObject({ reason_code: 'PRICE_GATE_BLOCKED' })
  })

  it('does not mistake dates or day counts for prices', () => {
    for (const text of ['Departs 18 March 2027', '10 days across 2 cities', 'Day 4: the Great Wall', '元旦出发的团', '北京到西安的块状地貌']) {
      expect(decideStoryPublish(baseInput({ item: baseItem({ text_line: text }) }))).toEqual({ action: 'PUBLISH' })
    }
  })
})
