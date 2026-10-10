import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_RETRY_MINUTES,
  INSTAGRAM_RECEIPT_KEY,
  MAX_OTHER_ATTEMPTS,
  OTHER_BACKOFF_MINUTES,
  STALE_CLAIM_MS,
  decideSweep,
  markCreating,
  markFailed,
  markSubmitted,
  needsHuman,
  newClaim,
  readReceipt,
  withReceipt,
  type InstagramPublishReceipt,
} from './instagram-receipt'

const NOW = new Date('2025-01-01T00:00:00.000Z')

function baseClaim(overrides: Partial<InstagramPublishReceipt> = {}): InstagramPublishReceipt {
  return {
    schema_version: 1,
    status: 'claiming',
    work_order_id: 'wo-1',
    client_id: 'cl-1',
    publer_account_id: 'acct-12345678',
    request_id: 'req-1',
    attempts: 0,
    first_comment_requested: false,
    no_publish: false,
    authorization: 'AUTHORIZED',
    cost_usd: 0,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  }
}

describe('readReceipt', () => {
  it('returns null for non-object output', () => {
    expect(readReceipt(null)).toBeNull()
    expect(readReceipt('nope')).toBeNull()
    expect(readReceipt(42)).toBeNull()
    expect(readReceipt([])).toBeNull()
  })

  it('returns null when key missing', () => {
    expect(readReceipt({ other: 1 })).toBeNull()
  })

  it('rejects wrong schema_version', () => {
    expect(readReceipt({ [INSTAGRAM_RECEIPT_KEY]: { schema_version: 2 } })).toBeNull()
  })

  it('rejects missing required field', () => {
    const r = baseClaim()
    const { work_order_id: _drop, ...rest } = r
    expect(readReceipt({ [INSTAGRAM_RECEIPT_KEY]: rest })).toBeNull()
  })

  it('rejects invalid status', () => {
    expect(
      readReceipt({ [INSTAGRAM_RECEIPT_KEY]: { ...baseClaim(), status: 'bogus' } }),
    ).toBeNull()
  })

  it('accepts a receipt written by withReceipt', () => {
    const r = baseClaim()
    const out = withReceipt({ sibling: 'keep' }, r)
    expect(readReceipt(out)).toEqual(r)
  })
})

describe('withReceipt', () => {
  it('preserves sibling keys and does not mutate input', () => {
    const input = { a: 1, b: { c: 2 } }
    const r = baseClaim()
    const out = withReceipt(input, r)
    expect(out.a).toBe(1)
    expect(out.b).toEqual({ c: 2 })
    expect(out[INSTAGRAM_RECEIPT_KEY]).toEqual(r)
    expect(input).toEqual({ a: 1, b: { c: 2 } })
  })

  it('treats non-object output as empty object', () => {
    const r = baseClaim()
    const out = withReceipt(null, r)
    expect(out).toEqual({ [INSTAGRAM_RECEIPT_KEY]: r })
  })
})

describe('newClaim', () => {
  it('carries attempts and media_id from prev but not error', () => {
    const prev = baseClaim({
      attempts: 2,
      media_id: 'media-12345678',
      error: 'boom',
      failure_kind: 'other',
      next_retry_at: null,
      event_ids: ['e1'],
    })
    const r = newClaim({
      workOrderId: 'wo-1',
      clientId: 'cl-1',
      publerAccountId: 'acct-12345678',
      requestId: 'req-2',
      live: true,
      firstCommentRequested: true,
      now: NOW,
      prev,
    })
    expect(r.status).toBe('claiming')
    expect(r.attempts).toBe(2)
    expect(r.media_id).toBe('media-12345678')
    expect(r.error).toBeUndefined()
    expect(r.failure_kind).toBeUndefined()
    expect(r.next_retry_at).toBeUndefined()
    expect(r.event_ids).toBeUndefined()
    expect(r.created_at).toBe(prev.created_at)
    expect(r.updated_at).toBe(NOW.toISOString())
    expect(r.no_publish).toBe(false)
    expect(r.authorization).toBe('AUTHORIZED')
  })

  it('defaults attempts to 0 and created_at to now without prev', () => {
    const r = newClaim({
      workOrderId: 'wo-1',
      clientId: 'cl-1',
      publerAccountId: 'acct-12345678',
      requestId: 'req-1',
      live: false,
      firstCommentRequested: false,
      now: NOW,
    })
    expect(r.attempts).toBe(0)
    expect(r.created_at).toBe(NOW.toISOString())
    expect(r.no_publish).toBe(true)
    expect(r.authorization).toBe('DRAFT_ONLY')
  })
})

describe('markCreating', () => {
  it('sets status creating and media_id', () => {
    const r = markCreating(baseClaim(), 'media-12345678', NOW)
    expect(r.status).toBe('creating')
    expect(r.media_id).toBe('media-12345678')
    expect(r.updated_at).toBe(NOW.toISOString())
  })
})

describe('markSubmitted', () => {
  it('draft flips no_publish/authorization', () => {
    const r = markSubmitted(
      baseClaim(),
      { postId: 'post-12345678', providerState: 'draft' },
      NOW,
    )
    expect(r.status).toBe('draft')
    expect(r.no_publish).toBe(true)
    expect(r.authorization).toBe('DRAFT_ONLY')
    expect(r.post_id).toBe('post-12345678')
    expect(r.provider_state).toBe('draft')
  })

  it('scheduled flips no_publish/authorization and keeps scheduled_at', () => {
    const r = markSubmitted(
      baseClaim(),
      {
        postId: 'post-12345678',
        providerState: 'scheduled',
        scheduledAt: '2025-02-01T00:00:00.000Z',
        permalink: 'https://example.com/p',
      },
      NOW,
    )
    expect(r.status).toBe('scheduled')
    expect(r.no_publish).toBe(false)
    expect(r.authorization).toBe('AUTHORIZED')
    expect(r.scheduled_at).toBe('2025-02-01T00:00:00.000Z')
    expect(r.permalink).toBe('https://example.com/p')
  })

  it('clears error/failure_kind/next_retry_at', () => {
    const failed = markFailed(baseClaim(), { error: 'x', kind: 'other' }, NOW)
    const r = markSubmitted(
      failed,
      { postId: 'post-12345678', providerState: 'scheduled', scheduledAt: '2025-02-01T00:00:00.000Z' },
      NOW,
    )
    expect(r.error).toBeUndefined()
    expect(r.failure_kind).toBeUndefined()
    expect(r.next_retry_at).toBeUndefined()
  })
})

describe('markFailed', () => {
  it('account kind leaves attempts unchanged and schedules fixed retry', () => {
    const r = markFailed(baseClaim({ attempts: 2 }), { error: 'auth', kind: 'account' }, NOW)
    expect(r.status).toBe('failed')
    expect(r.attempts).toBe(2)
    expect(r.failure_kind).toBe('account')
    expect(r.next_retry_at).toBe(
      new Date(NOW.getTime() + ACCOUNT_RETRY_MINUTES * 60 * 1000).toISOString(),
    )
    expect(needsHuman(r)).toBe(true)
  })

  it('other kind increments attempts with exponential backoff', () => {
    const r1 = markFailed(baseClaim({ attempts: 0 }), { error: 'x', kind: 'other' }, NOW)
    expect(r1.attempts).toBe(1)
    expect(r1.next_retry_at).toBe(
      new Date(NOW.getTime() + OTHER_BACKOFF_MINUTES * 1 * 60 * 1000).toISOString(),
    )

    const r2 = markFailed(r1, { error: 'x', kind: 'other' }, NOW)
    expect(r2.attempts).toBe(2)
    expect(r2.next_retry_at).toBe(
      new Date(NOW.getTime() + OTHER_BACKOFF_MINUTES * 2 * 60 * 1000).toISOString(),
    )

    const r3 = markFailed(r2, { error: 'x', kind: 'other' }, NOW)
    expect(r3.attempts).toBe(MAX_OTHER_ATTEMPTS)
    expect(r3.next_retry_at).toBeNull()
    expect(needsHuman(r3)).toBe(true)
  })

  it('sanitizes empty error to fallback text and truncates to 200 chars', () => {
    const empty = markFailed(baseClaim(), { error: '   ', kind: 'other' }, NOW)
    expect(empty.error).toBe('发布失败(原因未记录)')

    const long = markFailed(baseClaim(), { error: 'x'.repeat(500), kind: 'other' }, NOW)
    expect(long.error?.length).toBe(200)
  })
})

describe('needsHuman', () => {
  it('false for non-failed statuses', () => {
    expect(needsHuman(baseClaim({ status: 'claiming' }))).toBe(false)
    expect(needsHuman(baseClaim({ status: 'draft' }))).toBe(false)
  })

  it('true for account failure and terminal other failure', () => {
    expect(needsHuman(baseClaim({ status: 'failed', failure_kind: 'account' }))).toBe(true)
    expect(
      needsHuman(baseClaim({ status: 'failed', failure_kind: 'other', next_retry_at: null })),
    ).toBe(true)
  })

  it('false for other failure with a future retry', () => {
    expect(
      needsHuman(
        baseClaim({
          status: 'failed',
          failure_kind: 'other',
          next_retry_at: '2025-01-01T01:00:00.000Z',
        }),
      ),
    ).toBe(false)
  })
})

describe('decideSweep', () => {
  const cases: Array<{
    name: string
    receipt: InstagramPublishReceipt | null
    fbVideoState: 'DRAFT' | 'PUBLISHED' | undefined | null
    live: boolean
    now: Date
    expected: ReturnType<typeof decideSweep>
  }> = [
    {
      name: 'live + FB draft => skip fb_not_live',
      receipt: null,
      fbVideoState: 'DRAFT',
      live: true,
      now: NOW,
      expected: { action: 'skip', reason: 'fb_not_live' },
    },
    {
      name: 'unknown FB state => skip fb_state_unknown',
      receipt: null,
      fbVideoState: undefined,
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'fb_state_unknown' },
    },
    {
      name: 'null receipt => run',
      receipt: null,
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'run' },
    },
    {
      name: 'draft receipt => already_done',
      receipt: baseClaim({ status: 'draft' }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'already_done' },
    },
    {
      name: 'scheduled receipt => already_done',
      receipt: baseClaim({ status: 'scheduled' }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'already_done' },
    },
    {
      name: 'fresh claiming => in_flight',
      receipt: baseClaim({ status: 'claiming', updated_at: NOW.toISOString() }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'in_flight' },
    },
    {
      name: 'stale claiming => run',
      receipt: baseClaim({
        status: 'claiming',
        updated_at: new Date(NOW.getTime() - STALE_CLAIM_MS - 1).toISOString(),
      }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'run' },
    },
    {
      name: 'fresh creating => in_flight',
      receipt: baseClaim({ status: 'creating', updated_at: NOW.toISOString() }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'in_flight' },
    },
    {
      name: 'stale creating => reconcile',
      receipt: baseClaim({
        status: 'creating',
        updated_at: new Date(NOW.getTime() - STALE_CLAIM_MS - 1).toISOString(),
      }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'reconcile' },
    },
    {
      name: 'failed terminal => skip terminal',
      receipt: baseClaim({ status: 'failed', failure_kind: 'other', next_retry_at: null }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'terminal' },
    },
    {
      name: 'failed backoff future => skip backoff',
      receipt: baseClaim({
        status: 'failed',
        failure_kind: 'other',
        next_retry_at: new Date(NOW.getTime() + 60_000).toISOString(),
      }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'skip', reason: 'backoff' },
    },
    {
      name: 'failed backoff past => run',
      receipt: baseClaim({
        status: 'failed',
        failure_kind: 'other',
        next_retry_at: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'run' },
    },
    {
      name: 'unparsable updated_at on claiming => run (treated as old)',
      receipt: baseClaim({ status: 'claiming', updated_at: 'not-a-date' }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'run' },
    },
    {
      name: 'unparsable next_retry_at => run (treated as due)',
      receipt: baseClaim({ status: 'failed', failure_kind: 'other', next_retry_at: 'nope' }),
      fbVideoState: 'PUBLISHED',
      live: false,
      now: NOW,
      expected: { action: 'run' },
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(
        decideSweep({
          receipt: c.receipt,
          fbVideoState: c.fbVideoState,
          live: c.live,
          now: c.now,
        }),
      ).toEqual(c.expected)
    })
  }
})
