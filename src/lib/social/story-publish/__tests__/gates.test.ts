import { describe, expect, it } from 'vitest'
import { decideStoryPublish, isStoryLiveFor, readStorySwitches, type StoryGateInput } from '../gates'
import { computeItemFingerprint, computeManifestHash } from '../fingerprint'
import { storyItemKey, type StoryAuthorization, type StoryChannel, type StoryItemSpec, type StorySwitches } from '../types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-12T09:00:00.000Z')
const EXPIRES = '2026-10-19T09:00:00.000Z'

/** A story item whose slot is exactly `now`, so timing gates are neutral. */
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
    website_ref: 'https://example.com/facts',
    website_checked_on: '2026-10-12',
    has_reply_cta: false,
    contains_price: false,
    names_place: false,
    ...overrides,
  }
}

/** Build a real, fully valid authorization over the given items. */
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

const LIVE_SWITCHES: StorySwitches = {
  live: true,
  clientIds: ['client-1'],
  channels: ['facebook_story'],
}

/** A baseline input where every gate is green. */
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
    switches: LIVE_SWITCHES,
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

// ─── Baseline ─────────────────────────────────────────────────────────────────

describe('decideStoryPublish baseline', () => {
  it('publishes when every gate is green and the switches are live', () => {
    expect(decideStoryPublish(baseInput())).toEqual({ action: 'PUBLISH' })
  })

  it('dry-runs when the switches are not live for the client', () => {
    const switches: StorySwitches = { live: true, clientIds: ['other'], channels: ['facebook_story'] }
    expect(decideStoryPublish(baseInput({ switches }))).toEqual({ action: 'DRY_RUN' })
  })

  it('dry-runs when the switches are not live at all', () => {
    const switches: StorySwitches = { live: false, clientIds: ['client-1'], channels: ['facebook_story'] }
    expect(decideStoryPublish(baseInput({ switches }))).toEqual({ action: 'DRY_RUN' })
  })
})

// ─── Rule (a): existing attempt ───────────────────────────────────────────────

describe('rule (a): existing attempt', () => {
  it('skips a terminal attempt', () => {
    const existingAttempt = {
      status: 'PUBLISHED',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({
      action: 'SKIP',
      reason_code: 'ALREADY_TERMINAL',
    })
  })

  it('records a stale claim as an unknown outcome', () => {
    const updated_at = new Date(NOW.getTime() - 60 * 60_000).toISOString()
    const existingAttempt = { status: 'CLAIMED', updated_at, next_retry_at: null, retry_count: 0 }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({
      action: 'RECORD',
      status: 'UNKNOWN_OUTCOME',
      reason_code: 'STALE_CLAIM',
      retryable: false,
    })
  })

  it('records an unparseable claim timestamp as an unknown outcome', () => {
    const existingAttempt = {
      status: 'CLAIMED',
      updated_at: 'not-a-date',
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({
      action: 'RECORD',
      status: 'UNKNOWN_OUTCOME',
      reason_code: 'STALE_CLAIM',
      retryable: false,
    })
  })

  it('skips a fresh claim as in progress', () => {
    const existingAttempt = {
      status: 'CLAIMED',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({
      action: 'SKIP',
      reason_code: 'IN_PROGRESS',
    })
  })

  it('skips a container-created attempt as in progress', () => {
    const existingAttempt = {
      status: 'CONTAINER_CREATED',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({
      action: 'SKIP',
      reason_code: 'IN_PROGRESS',
    })
  })

  it('skips a publishing attempt as in progress', () => {
    const existingAttempt = {
      status: 'PUBLISHING',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({
      action: 'SKIP',
      reason_code: 'IN_PROGRESS',
    })
  })

  it('re-evaluates a dry-run attempt', () => {
    const existingAttempt = {
      status: 'DRY_RUN',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({ action: 'PUBLISH' })
  })

  it('re-evaluates a blocked attempt', () => {
    const existingAttempt = {
      status: 'BLOCKED',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({ action: 'PUBLISH' })
  })

  it('re-evaluates a skipped-not-authorized attempt', () => {
    const existingAttempt = {
      status: 'SKIPPED_NOT_AUTHORIZED',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    expect(decideStoryPublish(baseInput({ existingAttempt }))).toEqual({ action: 'PUBLISH' })
  })
})

// ─── Rule (b): due window ─────────────────────────────────────────────────────

describe('rule (b): due window', () => {
  it('skips when the slot is too far in the future', () => {
    const item = baseItem({ slot_at: new Date(NOW.getTime() + 60 * 60_000).toISOString() })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'SKIP',
      reason_code: 'NOT_DUE',
    })
  })

  it('records a bad slot as a permanent block', () => {
    const item = baseItem({ slot_at: 'not-a-date' })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'BAD_SLOT',
      retryable: false,
    })
  })
})

// ─── Rules (c) and (k): context ───────────────────────────────────────────────

describe('rules (c) and (k): context', () => {
  it('blocks when the client is not active', () => {
    expect(decideStoryPublish(baseInput({ clientStatus: 'paused' }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'CLIENT_NOT_ACTIVE',
      retryable: false,
    })
  })

  it('blocks when the campaign is not active', () => {
    expect(decideStoryPublish(baseInput({ campaignStatus: 'paused' }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'CAMPAIGN_NOT_ACTIVE',
      retryable: false,
    })
  })

  it('blocks when the source records are missing', () => {
    const item = baseItem({ source_record_ids: [] })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'SOURCE_MISSING',
      retryable: false,
    })
  })
})

// ─── Rule (d): authorization ──────────────────────────────────────────────────

describe('rule (d): authorization', () => {
  it('records a revoked authorization', () => {
    const item = baseItem()
    const authorization = { ...makeAuth([item]), revoked_at: '2026-10-12T08:00:00.000Z' }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    expect(decideStoryPublish(baseInput({ auth }))).toEqual({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'REVOKED',
      retryable: false,
    })
  })

  it('records an expired authorization', () => {
    const item = baseItem()
    const authorization = { ...makeAuth([item]), expires_at: '2026-10-12T08:00:00.000Z' }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    expect(decideStoryPublish(baseInput({ auth }))).toEqual({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'EXPIRED',
      retryable: false,
    })
  })

  it('records a not-activated authorization', () => {
    const item = baseItem()
    const authorization = { ...makeAuth([item]), activated_at: null }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    expect(decideStoryPublish(baseInput({ auth }))).toEqual({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'NOT_ACTIVATED',
      retryable: false,
    })
  })

  it('records an authorizer who is no longer an admin', () => {
    const item = baseItem()
    const auth = {
      authorization: makeAuth([item]),
      itemAuthorizationId: 'auth-1',
      packItems: [item],
      adminEmails: new Set<string>(),
    }
    expect(decideStoryPublish(baseInput({ auth }))).toEqual({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'AUTHORIZER_NOT_ADMIN',
      retryable: false,
    })
  })
})

// ─── Rule (e): circuit ────────────────────────────────────────────────────────

describe('rule (e): circuit', () => {
  it('blocks when the item is paused', () => {
    const circuit = { itemPaused: true, packChannelPaused: false }
    expect(decideStoryPublish(baseInput({ circuit }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'CIRCUIT_PAUSED',
      retryable: false,
    })
  })

  it('blocks when the pack/channel is paused', () => {
    const circuit = { itemPaused: false, packChannelPaused: true }
    expect(decideStoryPublish(baseInput({ circuit }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'CIRCUIT_PAUSED',
      retryable: false,
    })
  })
})

// ─── Rule (f): lateness ───────────────────────────────────────────────────────

describe('rule (f): lateness', () => {
  it('records a missed window when the slot is too far in the past', () => {
    const item = baseItem({ slot_at: new Date(NOW.getTime() - 60 * 60_000).toISOString() })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'MISSED_WINDOW',
      reason_code: 'SLOT_PASSED',
      retryable: false,
    })
  })
})

// ─── Rule (g): file check ─────────────────────────────────────────────────────

describe('rule (g): file check', () => {
  it('blocks when the file changed', () => {
    expect(decideStoryPublish(baseInput({ fileCheck: 'CHANGED' }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'FILE_CHANGED',
      retryable: false,
    })
  })

  it('blocks retryably when the file is unreachable', () => {
    expect(decideStoryPublish(baseInput({ fileCheck: 'UNREACHABLE' }))).toEqual({
      action: 'RECORD',
      status: 'RETRYABLE',
      reason_code: 'FILE_UNREACHABLE',
      retryable: true,
    })
  })
})

// ─── Rule (h): price gate ─────────────────────────────────────────────────────

describe('rule (h): price gate', () => {
  it('blocks when the price gate is blocked', () => {
    expect(decideStoryPublish(baseInput({ priceGate: 'BLOCKED' }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'PRICE_GATE_BLOCKED',
      retryable: false,
    })
  })

  it('blocks retryably when the price gate errors', () => {
    expect(decideStoryPublish(baseInput({ priceGate: 'ERROR' }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'PRICE_GATE_ERROR',
      retryable: true,
    })
  })
})

// ─── Rule (i): reply owner ────────────────────────────────────────────────────

describe('rule (i): reply owner', () => {
  it('blocks retryably when a reply CTA has no owner', () => {
    const item = baseItem({ has_reply_cta: true })
    expect(decideStoryPublish(baseInput({ item, replyOwnerPresent: false }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'NO_REPLY_OWNER',
      retryable: true,
    })
  })

  it('passes when a reply CTA has an owner', () => {
    const item = baseItem({ has_reply_cta: true })
    expect(decideStoryPublish(baseInput({ item, replyOwnerPresent: true }))).toEqual({
      action: 'PUBLISH',
    })
  })
})

// ─── Rule (j): website check ──────────────────────────────────────────────────

describe('rule (j): website check', () => {
  it('blocks when the website ref is not https', () => {
    const item = baseItem({ website_ref: 'http://example.com/facts' })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'WEBSITE_CHECK_STALE',
      retryable: true,
    })
  })

  it('blocks when the check date is malformed', () => {
    const item = baseItem({ website_checked_on: '12/10/2026' })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'WEBSITE_CHECK_STALE',
      retryable: true,
    })
  })

  it('blocks when the check date is too old', () => {
    const item = baseItem({ website_checked_on: '2026-09-01' })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'WEBSITE_CHECK_STALE',
      retryable: true,
    })
  })

  it('blocks when the check date is far in the future', () => {
    const item = baseItem({ website_checked_on: '2026-11-01' })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'WEBSITE_CHECK_STALE',
      retryable: true,
    })
  })

  it('passes when the check date is one day in the future', () => {
    const item = baseItem({ website_checked_on: '2026-10-13' })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({ action: 'PUBLISH' })
  })
})

// ─── Precedence ───────────────────────────────────────────────────────────────

describe('precedence', () => {
  it('prefers the authorization failure over a file change', () => {
    const item = baseItem()
    const authorization = { ...makeAuth([item]), revoked_at: '2026-10-12T08:00:00.000Z' }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    const decision = decideStoryPublish(baseInput({ auth, fileCheck: 'CHANGED' }))
    expect(decision).toEqual({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'REVOKED',
      retryable: false,
    })
  })

  it('prefers the circuit pause over a blocked price gate', () => {
    const circuit = { itemPaused: true, packChannelPaused: false }
    const decision = decideStoryPublish(baseInput({ circuit, priceGate: 'BLOCKED' }))
    expect(decision).toEqual({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'CIRCUIT_PAUSED',
      retryable: false,
    })
  })

  it('lets a terminal attempt beat every other failing gate', () => {
    const item = baseItem()
    const authorization = { ...makeAuth([item]), revoked_at: '2026-10-12T08:00:00.000Z' }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    const existingAttempt = {
      status: 'PUBLISHED',
      updated_at: NOW.toISOString(),
      next_retry_at: null,
      retry_count: 0,
    }
    const decision = decideStoryPublish(
      baseInput({
        auth,
        existingAttempt,
        fileCheck: 'CHANGED',
        priceGate: 'BLOCKED',
        clientStatus: 'paused',
      }),
    )
    expect(decision).toEqual({ action: 'SKIP', reason_code: 'ALREADY_TERMINAL' })
  })

  it('lets NOT_DUE beat a not-authorized state', () => {
    const item = baseItem({ slot_at: new Date(NOW.getTime() + 60 * 60_000).toISOString() })
    const authorization = { ...makeAuth([item]), revoked_at: '2026-10-12T08:00:00.000Z' }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    const decision = decideStoryPublish(baseInput({ item, auth }))
    expect(decision).toEqual({ action: 'SKIP', reason_code: 'NOT_DUE' })
  })
})

// ─── Never publish unless every gate is green ─────────────────────────────────

describe('never publishes unless every gate is green', () => {
  const failingInputs: Array<[string, Partial<StoryGateInput>]> = [
    [
      'terminal attempt',
      {
        existingAttempt: {
          status: 'PUBLISHED',
          updated_at: NOW.toISOString(),
          next_retry_at: null,
          retry_count: 0,
        },
      },
    ],
    [
      'in-progress attempt',
      {
        existingAttempt: {
          status: 'CLAIMED',
          updated_at: NOW.toISOString(),
          next_retry_at: null,
          retry_count: 0,
        },
      },
    ],
    ['not due', { item: baseItem({ slot_at: new Date(NOW.getTime() + 60 * 60_000).toISOString() }) }],
    ['bad slot', { item: baseItem({ slot_at: 'not-a-date' }) }],
    ['client not active', { clientStatus: 'paused' }],
    ['campaign not active', { campaignStatus: 'paused' }],
    ['source missing', { item: baseItem({ source_record_ids: [] }) }],
    ['circuit paused', { circuit: { itemPaused: true, packChannelPaused: false } }],
    ['slot passed', { item: baseItem({ slot_at: new Date(NOW.getTime() - 60 * 60_000).toISOString() }) }],
    ['file changed', { fileCheck: 'CHANGED' }],
    ['file unreachable', { fileCheck: 'UNREACHABLE' }],
    ['price blocked', { priceGate: 'BLOCKED' }],
    ['price error', { priceGate: 'ERROR' }],
    ['no reply owner', { item: baseItem({ has_reply_cta: true }), replyOwnerPresent: false }],
    ['website not https', { item: baseItem({ website_ref: 'http://example.com/facts' }) }],
    ['website stale', { item: baseItem({ website_checked_on: '2026-09-01' }) }],
  ]

  it.each(failingInputs)('does not publish when %s', (_label, overrides) => {
    expect(decideStoryPublish(baseInput(overrides)).action).not.toBe('PUBLISH')
  })
})

// ─── readStorySwitches ────────────────────────────────────────────────────────

describe('readStorySwitches', () => {
  it.each(['TRUE', '1', ' true', 'yes', undefined])('treats %s as not live', value => {
    expect(readStorySwitches({ STORY_AUTO_PUBLISH_LIVE: value }).live).toBe(false)
  })

  it('treats the exact string true as live', () => {
    expect(readStorySwitches({ STORY_AUTO_PUBLISH_LIVE: 'true' }).live).toBe(true)
  })

  it('trims and lowercases the client list', () => {
    const switches = readStorySwitches({ STORY_AUTO_PUBLISH_CLIENTS: ' Client-1 , CLIENT-2 ,, ' })
    expect(switches.clientIds).toEqual(['client-1', 'client-2'])
  })

  it('drops unknown channels', () => {
    const switches = readStorySwitches({
      STORY_AUTO_PUBLISH_CHANNELS: 'facebook_story, tiktok_story, INSTAGRAM_STORY',
    })
    expect(switches.channels).toEqual(['facebook_story', 'instagram_story'])
  })

  it('returns empty lists when the env vars are absent', () => {
    const switches = readStorySwitches({})
    expect(switches).toEqual({ live: false, clientIds: [], channels: [] })
  })
})

// ─── isStoryLiveFor ───────────────────────────────────────────────────────────

describe('isStoryLiveFor', () => {
  it('is false when the feature is not live', () => {
    const switches: StorySwitches = { live: false, clientIds: ['client-1'], channels: ['facebook_story'] }
    expect(isStoryLiveFor(switches, 'client-1', 'facebook_story')).toBe(false)
  })

  it('is false when the client is not in the list', () => {
    expect(isStoryLiveFor(LIVE_SWITCHES, 'client-2', 'facebook_story')).toBe(false)
  })

  it('is false when the channel is not in the list', () => {
    expect(isStoryLiveFor(LIVE_SWITCHES, 'client-1', 'instagram_story')).toBe(false)
  })

  it('is true when all three switches agree', () => {
    expect(isStoryLiveFor(LIVE_SWITCHES, 'CLIENT-1', 'facebook_story')).toBe(true)
  })
})

// ─── Per-channel enablement ───────────────────────────────────────────────────

describe('per-channel enablement', () => {
  it('dry-runs an Instagram item while Facebook is enabled', () => {
    const item = baseItem({ channel: 'instagram_story' as StoryChannel })
    expect(decideStoryPublish(baseInput({ item }))).toEqual({ action: 'DRY_RUN' })
  })

  it('publishes a Facebook item while Instagram is disabled', () => {
    const switches: StorySwitches = {
      live: true,
      clientIds: ['client-1'],
      channels: ['facebook_story'],
    }
    expect(decideStoryPublish(baseInput({ switches }))).toEqual({ action: 'PUBLISH' })
  })
})

// ─── Source check ordering ────────────────────────────────────────────────────

describe('source check ordering', () => {
  it('reports not-authorized before a missing source when both apply', () => {
    const item = baseItem({ source_record_ids: [] })
    const authorization = { ...makeAuth([item]), revoked_at: '2026-10-12T08:00:00.000Z' }
    const auth = { authorization, itemAuthorizationId: 'auth-1', packItems: [item], adminEmails: new Set(['pm@example.com']) }
    const input = baseInput({ auth, item })
    expect(decideStoryPublish(input)).toMatchObject({
      action: 'RECORD',
      status: 'SKIPPED_NOT_AUTHORIZED',
      reason_code: 'REVOKED',
    })
  })

  it('blocks an authorised item that has no source records', () => {
    const input = baseInput({ item: baseItem({ source_record_ids: [] }) })
    expect(decideStoryPublish(input)).toMatchObject({
      action: 'RECORD',
      status: 'BLOCKED',
      reason_code: 'SOURCE_MISSING',
    })
  })
})
