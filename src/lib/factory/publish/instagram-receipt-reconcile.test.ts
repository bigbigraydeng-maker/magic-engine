import { describe, expect, it } from 'vitest'
import {
  INSTAGRAM_RECEIPT_KEY,
  STALE_CLAIM_MS,
  decideSweep,
  markFailed,
  markSubmitted,
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

describe('markFailed post_may_exist', () => {
  const kinds = ['other', 'account'] as const

  for (const kind of kinds) {
    it(`sets post_may_exist when mayHavePosted is true (kind ${kind})`, () => {
      const r = markFailed(baseClaim(), { error: 'x', kind, mayHavePosted: true }, NOW)
      expect(r.post_may_exist).toBe(true)
    })

    it(`leaves post_may_exist absent without mayHavePosted (kind ${kind})`, () => {
      const r = markFailed(baseClaim(), { error: 'x', kind }, NOW)
      expect(r.post_may_exist).toBeUndefined()
    })
  }

  it('is sticky: failing again without mayHavePosted keeps post_may_exist', () => {
    const first = markFailed(baseClaim(), { error: 'x', kind: 'other', mayHavePosted: true }, NOW)
    expect(first.post_may_exist).toBe(true)
    const second = markFailed(first, { error: 'y', kind: 'other' }, NOW)
    expect(second.post_may_exist).toBe(true)
  })

  it('is sticky across account failures too', () => {
    const first = markFailed(baseClaim(), { error: 'x', kind: 'other', mayHavePosted: true }, NOW)
    const second = markFailed(first, { error: 'y', kind: 'account' }, NOW)
    expect(second.post_may_exist).toBe(true)
  })
})

describe('newClaim post_may_exist', () => {
  it('carries post_may_exist from prev', () => {
    const prev = baseClaim({ post_may_exist: true })
    const r = newClaim({
      workOrderId: 'wo-1',
      clientId: 'cl-1',
      publerAccountId: 'acct-12345678',
      requestId: 'req-2',
      live: true,
      firstCommentRequested: false,
      now: NOW,
      prev,
    })
    expect(r.post_may_exist).toBe(true)
  })

  it('leaves post_may_exist absent without prev flag', () => {
    const prev = baseClaim()
    const r = newClaim({
      workOrderId: 'wo-1',
      clientId: 'cl-1',
      publerAccountId: 'acct-12345678',
      requestId: 'req-2',
      live: true,
      firstCommentRequested: false,
      now: NOW,
      prev,
    })
    expect(r.post_may_exist).toBeUndefined()
  })

  it('leaves post_may_exist absent without prev', () => {
    const r = newClaim({
      workOrderId: 'wo-1',
      clientId: 'cl-1',
      publerAccountId: 'acct-12345678',
      requestId: 'req-1',
      live: false,
      firstCommentRequested: false,
      now: NOW,
    })
    expect(r.post_may_exist).toBeUndefined()
  })
})

describe('markSubmitted clears post_may_exist', () => {
  it('clears the flag on submit', () => {
    const withFlag = baseClaim({ post_may_exist: true })
    const r = markSubmitted(
      withFlag,
      { postId: 'post-12345678', providerState: 'scheduled', scheduledAt: '2025-02-01T00:00:00.000Z' },
      NOW,
    )
    expect(r.post_may_exist).toBeUndefined()
  })
})

describe('readReceipt round-trips post_may_exist', () => {
  it('preserves post_may_exist: true', () => {
    const r = baseClaim({ post_may_exist: true })
    const out = withReceipt({}, r)
    const read = readReceipt(out)
    expect(read).not.toBeNull()
    expect(read?.post_may_exist).toBe(true)
  })

  it('does not invent post_may_exist when absent', () => {
    const r = baseClaim()
    const out = withReceipt({}, r)
    const read = readReceipt(out)
    expect(read).not.toBeNull()
    expect(read?.post_may_exist).toBeUndefined()
  })
})

describe('decideSweep post_may_exist', () => {
  const pastRetry = new Date(NOW.getTime() - 60_000).toISOString()
  const futureRetry = new Date(NOW.getTime() + 60_000).toISOString()
  const staleUpdatedAt = new Date(NOW.getTime() - STALE_CLAIM_MS - 1).toISOString()
  const freshUpdatedAt = new Date(NOW.getTime() - 60_000).toISOString()

  const cases: Array<{
    name: string
    receipt: InstagramPublishReceipt
    expected: ReturnType<typeof decideSweep>
  }> = [
    {
      name: 'failed + past retry + post_may_exist => reconcile',
      receipt: baseClaim({
        status: 'failed',
        failure_kind: 'other',
        next_retry_at: pastRetry,
        post_may_exist: true,
      }),
      expected: { action: 'reconcile' },
    },
    {
      name: 'failed + past retry without post_may_exist => run',
      receipt: baseClaim({
        status: 'failed',
        failure_kind: 'other',
        next_retry_at: pastRetry,
      }),
      expected: { action: 'run' },
    },
    {
      name: 'failed + terminal + post_may_exist => skip terminal',
      receipt: baseClaim({
        status: 'failed',
        failure_kind: 'other',
        next_retry_at: null,
        post_may_exist: true,
      }),
      expected: { action: 'skip', reason: 'terminal' },
    },
    {
      name: 'failed + future retry + post_may_exist => skip backoff',
      receipt: baseClaim({
        status: 'failed',
        failure_kind: 'other',
        next_retry_at: futureRetry,
        post_may_exist: true,
      }),
      expected: { action: 'skip', reason: 'backoff' },
    },
    {
      name: 'stale claiming + post_may_exist => reconcile',
      receipt: baseClaim({
        status: 'claiming',
        updated_at: staleUpdatedAt,
        post_may_exist: true,
      }),
      expected: { action: 'reconcile' },
    },
    {
      name: 'stale claiming without post_may_exist => run',
      receipt: baseClaim({
        status: 'claiming',
        updated_at: staleUpdatedAt,
      }),
      expected: { action: 'run' },
    },
    {
      name: 'fresh claiming + post_may_exist => skip in_flight',
      receipt: baseClaim({
        status: 'claiming',
        updated_at: freshUpdatedAt,
        post_may_exist: true,
      }),
      expected: { action: 'skip', reason: 'in_flight' },
    },
    {
      name: 'fresh claiming without post_may_exist => skip in_flight',
      receipt: baseClaim({
        status: 'claiming',
        updated_at: freshUpdatedAt,
      }),
      expected: { action: 'skip', reason: 'in_flight' },
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(
        decideSweep({
          receipt: c.receipt,
          fbVideoState: 'PUBLISHED',
          live: false,
          now: NOW,
        }),
      ).toEqual(c.expected)
    })
  }
})

// Keep INSTAGRAM_RECEIPT_KEY referenced so the import list mirrors the module's
// public surface used by the round-trip test above.
void INSTAGRAM_RECEIPT_KEY
