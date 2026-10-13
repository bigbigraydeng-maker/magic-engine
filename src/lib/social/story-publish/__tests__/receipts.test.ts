import { describe, expect, it } from 'vitest'

import { buildStoryReceipt, providerImpactFor } from '../receipts'
import { STORY_ATTEMPT_STATUSES } from '../types'
import type { StoryAttemptStatus } from '../types'

const CONTENT_HASH = 'a'.repeat(64)

const PUBLISHED_STATUSES: ReadonlySet<StoryAttemptStatus> = new Set([
  'PUBLISHED_UNVERIFIED',
  'PUBLISHED',
])

function baseInput(status: StoryAttemptStatus) {
  return {
    requestId: 'req-1',
    item: {
      client_id: 'client-1',
      pack_id: 'pack-1',
      item_id: 'item-1',
      channel: 'facebook_story' as const,
    },
    status,
    reasonCode: 'SOME_REASON',
    providerReceipt: PUBLISHED_STATUSES.has(status) ? 'provider-123' : null,
    authorizationId: 'auth-1',
    authorizationState: 'ACTIVE',
    contentHash: CONTENT_HASH,
    mode: 'LIVE' as const,
    now: new Date('2026-10-12T10:00:00.000Z'),
  }
}

describe('providerImpactFor', () => {
  it('reports STORY_PUBLISHED only for the two published statuses', () => {
    for (const status of STORY_ATTEMPT_STATUSES) {
      const expected = PUBLISHED_STATUSES.has(status) ? 'STORY_PUBLISHED' : 'NONE'
      expect(providerImpactFor(status)).toBe(expected)
    }
  })
})

describe('buildStoryReceipt', () => {
  it('builds a valid receipt for every status', () => {
    for (const status of STORY_ATTEMPT_STATUSES) {
      const mode = status === 'DRY_RUN' ? 'DRY_RUN' : 'LIVE'
      const receipt = buildStoryReceipt({ ...baseInput(status), mode })
      expect(receipt.status).toBe(status)
      expect(receipt.provider_impact).toBe(providerImpactFor(status))
      if (PUBLISHED_STATUSES.has(status)) {
        expect(receipt.provider_receipt).toBe('provider-123')
      } else {
        expect(receipt.provider_receipt).toBeNull()
      }
    }
  })

  it('sets created_at to the ISO string of now and cost_usd to 0', () => {
    const now = new Date('2026-10-12T10:00:00.000Z')
    const receipt = buildStoryReceipt({ ...baseInput('CLAIMED'), now })
    expect(receipt.created_at).toBe(now.toISOString())
    expect(receipt.cost_usd).toBe(0)
  })

  it('trims the provider receipt', () => {
    const receipt = buildStoryReceipt({
      ...baseInput('PUBLISHED'),
      providerReceipt: '  provider-123  ',
    })
    expect(receipt.provider_receipt).toBe('provider-123')
  })

  it('throws when a published status has no provider receipt', () => {
    expect(() =>
      buildStoryReceipt({ ...baseInput('PUBLISHED'), providerReceipt: null }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({ ...baseInput('PUBLISHED_UNVERIFIED'), providerReceipt: '   ' }),
    ).toThrow()
  })

  it('throws when a non-published status carries a provider receipt', () => {
    expect(() =>
      buildStoryReceipt({ ...baseInput('CONTAINER_CREATED'), providerReceipt: 'container-1' }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({ ...baseInput('FAILED_FINAL'), providerReceipt: 'provider-123' }),
    ).toThrow()
  })

  it('throws when status DRY_RUN is not paired with mode DRY_RUN', () => {
    expect(() =>
      buildStoryReceipt({ ...baseInput('DRY_RUN'), mode: 'LIVE' }),
    ).toThrow()
  })

  it('throws when mode DRY_RUN has a published status', () => {
    expect(() =>
      buildStoryReceipt({ ...baseInput('PUBLISHED'), mode: 'DRY_RUN' }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({ ...baseInput('PUBLISHED_UNVERIFIED'), mode: 'DRY_RUN' }),
    ).toThrow()
  })

  it('throws when contentHash is not 64 lowercase hex characters', () => {
    expect(() =>
      buildStoryReceipt({ ...baseInput('CLAIMED'), contentHash: 'ABC' }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({ ...baseInput('CLAIMED'), contentHash: 'A'.repeat(64) }),
    ).toThrow()
  })

  it('throws when requestId or item ids are empty', () => {
    expect(() =>
      buildStoryReceipt({ ...baseInput('CLAIMED'), requestId: '   ' }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({
        ...baseInput('CLAIMED'),
        item: { ...baseInput('CLAIMED').item, item_id: '' },
      }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({
        ...baseInput('CLAIMED'),
        item: { ...baseInput('CLAIMED').item, pack_id: '  ' },
      }),
    ).toThrow()
    expect(() =>
      buildStoryReceipt({
        ...baseInput('CLAIMED'),
        item: { ...baseInput('CLAIMED').item, client_id: '' },
      }),
    ).toThrow()
  })
})

describe('published receipts need a live authorization', () => {
  const published = ['PUBLISHED', 'PUBLISHED_UNVERIFIED'] as const

  it('throws when a published status has no authorization id', () => {
    for (const status of published) {
      expect(() =>
        buildStoryReceipt({ ...baseInput(status), mode: 'LIVE', authorizationId: null }),
      ).toThrow()
      expect(() =>
        buildStoryReceipt({ ...baseInput(status), mode: 'LIVE', authorizationId: '  ' }),
      ).toThrow()
    }
  })

  it('throws when a published status carries a non-ACTIVE authorization state', () => {
    for (const status of published) {
      for (const state of ['NONE', 'REVOKED', 'EXPIRED', 'FINGERPRINT_MISMATCH']) {
        expect(() =>
          buildStoryReceipt({ ...baseInput(status), mode: 'LIVE', authorizationState: state }),
        ).toThrow()
      }
    }
  })

  it('still allows non-published statuses without an authorization id', () => {
    const receipt = buildStoryReceipt({
      ...baseInput('SKIPPED_NOT_AUTHORIZED'),
      mode: 'LIVE',
      authorizationId: null,
      authorizationState: 'NONE',
    })
    expect(receipt.authorization_id).toBeNull()
  })
})
