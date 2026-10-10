import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoPublishAuthorization } from '../daily-plan-auto-publish'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

import {
  clearNonStickyAttempts,
  isMissingTableError,
  listFreshClaims,
  claimAttempt,
  confirmUnknownOutcome,
  finishAttempt,
  listAttempts,
  listAttemptsNeedingAttention,
  listLiveAuthorizations,
  type AttemptRecord,
} from '../daily-plan-auto-publish-worker-store'

/**
 * A chainable Supabase stub: every builder method returns the same object, and
 * the object is thenable so `await` on a non-terminal chain resolves to the
 * configured result. Terminal methods (`single`, `maybeSingle`) resolve too.
 */
interface StubResult {
  data: unknown
  error: { code?: string; message?: string } | null
}

interface ChainStub {
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  or: ReturnType<typeof vi.fn>
  not: ReturnType<typeof vi.fn>
  gte: ReturnType<typeof vi.fn>
  lte: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (resolve: (value: StubResult) => unknown) => unknown
}

function makeChain(result: StubResult): ChainStub {
  const stub = {} as ChainStub
  const self = () => stub

  stub.insert = vi.fn(self)
  stub.update = vi.fn(self)
  stub.upsert = vi.fn(self)
  stub.select = vi.fn(self)
  stub.eq = vi.fn(self)
  stub.neq = vi.fn(self)
  stub.in = vi.fn(self)
  stub.or = vi.fn(self)
  stub.not = vi.fn(self)
  stub.gte = vi.fn(self)
  stub.lte = vi.fn(self)
  stub.delete = vi.fn(self)
  stub.is = vi.fn(self)
  stub.single = vi.fn(async () => result)
  stub.maybeSingle = vi.fn(async () => result)
  stub.then = resolve => resolve(result)

  return stub
}

const CLIENT = 'c0000000-0000-0000-0000-000000000001'
const PLAN = 'c0000000-0000-0000-0000-000000000003'
const DATE = '2024-02-01'

const storedAuth: AutoPublishAuthorization = {
  id: 'auth-1',
  request_id: 'req-1',
  client_id: CLIENT,
  campaign_id: 'c0000000-0000-0000-0000-000000000002',
  plan_id: PLAN,
  plan_revision: '2024-01-01T00:00:00.000Z',
  review_revision: 'c0000000-0000-0000-0000-000000000004',
  page_id: '1234567890',
  dates: ['2024-02-01', '2024-02-02'],
  lifted_dates: [],
  max_per_day: 1,
  authorized_by_email: 'ops@example.com',
  authorized_by_user_id: 'c0000000-0000-0000-0000-000000000005',
  authorized_at: '2024-01-01T00:00:00.000Z',
  activated_at: '2024-01-01T00:00:05.000Z',
  expires_at: '2024-01-15T00:00:00.000Z',
  revoked_at: null,
  revoked_by_email: null,
  revoked_reason: null,
}

const storedAttempt: AttemptRecord = {
  id: 'attempt-1',
  auth_id: 'auth-1',
  client_id: CLIENT,
  plan_id: PLAN,
  date: DATE,
  attempt_no: 1,
  status: 'claimed',
  reason_code: null,
  request_id: 'req-1',
  provider_impact: 'NONE',
  post_id: null,
  scheduled_publish_time: null,
  next_retry_at: null,
  updated_at: '2024-01-01T00:00:00.000Z',
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('listLiveAuthorizations', () => {
  it('returns the armed, non-revoked grants', async () => {
    const chain = makeChain({ data: [storedAuth], error: null })
    fromMock.mockReturnValue(chain)

    expect(await listLiveAuthorizations()).toEqual([storedAuth])
    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_auth')
    expect(chain.select).toHaveBeenCalledWith('*')
  })

  it('🔴 filters out revoked grants and grants that were never activated', async () => {
    const chain = makeChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await listLiveAuthorizations()

    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
    expect(chain.not).toHaveBeenCalledWith('activated_at', 'is', null)
  })

  it('returns an empty list when there are none', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await listLiveAuthorizations()).toEqual([])
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))
    await expect(listLiveAuthorizations()).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('listAttempts', () => {
  it('returns the rows for the plan, client and dates', async () => {
    const chain = makeChain({ data: [storedAttempt], error: null })
    fromMock.mockReturnValue(chain)

    expect(await listAttempts(PLAN, CLIENT, [DATE])).toEqual([storedAttempt])
    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('plan_id', PLAN)
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(chain.in).toHaveBeenCalledWith('date', [DATE])
  })

  it('does not touch the database for an empty date list', async () => {
    expect(await listAttempts(PLAN, CLIENT, [])).toEqual([])
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))
    await expect(listAttempts(PLAN, CLIENT, [DATE])).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('claimAttempt', () => {
  it('🔴 a fresh claim inserts a claimed row and returns true', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    const now = new Date('2024-01-01T00:00:00.000Z')
    expect(
      await claimAttempt({ authId: 'auth-1', clientId: CLIENT, planId: PLAN, date: DATE, requestId: 'req-1', attemptNo: 1, now }),
    ).toBe(true)

    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.insert).toHaveBeenCalledWith({
      auth_id: 'auth-1',
      client_id: CLIENT,
      plan_id: PLAN,
      date: DATE,
      attempt_no: 1,
      status: 'claimed',
      request_id: 'req-1',
      provider_impact: 'NONE',
      updated_at: '2024-01-01T00:00:00.000Z',
    })
  })

  it('🔴 a unique violation means another sweep claimed it first, so it returns false', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } }))

    expect(
      await claimAttempt({ authId: 'auth-1', clientId: CLIENT, planId: PLAN, date: DATE, requestId: 'req-1', attemptNo: 1, now: new Date() }),
    ).toBe(false)
  })

  it('throws on any other insert error', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))

    await expect(
      claimAttempt({ authId: 'auth-1', clientId: CLIENT, planId: PLAN, date: DATE, requestId: 'req-1', attemptNo: 1, now: new Date() }),
    ).rejects.toMatchObject({ code: '42P01' })
  })

  it('🔴 a reclaim updates only the row at the decided status, never a RECALLED block', async () => {
    const chain = makeChain({ data: { id: 'attempt-1' }, error: null })
    fromMock.mockReturnValue(chain)

    const now = new Date('2024-01-01T00:00:00.000Z')
    expect(
      await claimAttempt({
        authId: 'auth-1',
        clientId: CLIENT,
        planId: PLAN,
        date: DATE,
        requestId: 'req-2',
        attemptNo: 2,
        now,
        fromStatus: 'failed_retryable',
      }),
    ).toBe(true)

    expect(chain.update).toHaveBeenCalledWith({
      status: 'claimed',
      auth_id: 'auth-1',
      request_id: 'req-2',
      attempt_no: 2,
      reason_code: null,
      next_retry_at: null,
      post_id: null,
      scheduled_publish_time: null,
      provider_impact: 'NONE',
      updated_at: '2024-01-01T00:00:00.000Z',
    })
    expect(chain.eq).toHaveBeenCalledWith('plan_id', PLAN)
    expect(chain.eq).toHaveBeenCalledWith('date', DATE)
    expect(chain.eq).toHaveBeenCalledWith('status', 'failed_retryable')
    expect(chain.or).toHaveBeenCalledWith('reason_code.is.null,reason_code.neq.RECALLED')
    expect(chain.select).toHaveBeenCalledWith('id')
  })

  it('🔴 a reclaim that matched no row returns false', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))

    expect(
      await claimAttempt({
        authId: 'auth-1',
        clientId: CLIENT,
        planId: PLAN,
        date: DATE,
        requestId: 'req-2',
        attemptNo: 2,
        now: new Date(),
        fromStatus: 'blocked',
      }),
    ).toBe(false)
  })

  it('throws on a reclaim error', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))

    await expect(
      claimAttempt({
        authId: 'auth-1',
        clientId: CLIENT,
        planId: PLAN,
        date: DATE,
        requestId: 'req-2',
        attemptNo: 2,
        now: new Date(),
        fromStatus: 'blocked',
      }),
    ).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('finishAttempt', () => {
  it('🔴 writes the patch only onto the exact claim that made it', async () => {
    const chain = makeChain({ data: { id: 'attempt-1' }, error: null })
    fromMock.mockReturnValue(chain)

    const now = new Date('2024-01-01T00:10:00.000Z')
    expect(
      await finishAttempt({
        planId: PLAN,
        date: DATE,
        requestId: 'req-1',
        patch: { status: 'published', post_id: 'post-1', provider_impact: 'FB_SCHEDULED' },
        now,
      }),
    ).toBe(true)

    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.update).toHaveBeenCalledWith({
      status: 'published',
      post_id: 'post-1',
      provider_impact: 'FB_SCHEDULED',
      updated_at: '2024-01-01T00:10:00.000Z',
    })
    expect(chain.eq).toHaveBeenCalledWith('plan_id', PLAN)
    expect(chain.eq).toHaveBeenCalledWith('date', DATE)
    expect(chain.eq).toHaveBeenCalledWith('request_id', 'req-1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'claimed')
    expect(chain.select).toHaveBeenCalledWith('id')
  })

  it('🔴 returns false when the claim was already finished or tombstoned', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))

    expect(
      await finishAttempt({ planId: PLAN, date: DATE, requestId: 'req-1', patch: { status: 'failed_final' }, now: new Date() }),
    ).toBe(false)
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))

    await expect(
      finishAttempt({ planId: PLAN, date: DATE, requestId: 'req-1', patch: { status: 'failed_final' }, now: new Date() }),
    ).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('listAttemptsNeedingAttention', () => {
  it('🔴 selects the given date onward and only the statuses a human must look at', async () => {
    const chain = makeChain({ data: [storedAttempt], error: null })
    fromMock.mockReturnValue(chain)

    expect(await listAttemptsNeedingAttention('2024-02-01')).toEqual([storedAttempt])
    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.gte).toHaveBeenCalledWith('date', '2024-02-01')
    expect(chain.or).toHaveBeenCalledWith(
      'status.in.(failed_final,unknown_outcome,missed_window),and(status.eq.blocked,or(reason_code.is.null,reason_code.neq.RECALLED))',
    )
  })

  it('returns an empty list when nothing needs attention', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await listAttemptsNeedingAttention('2024-02-01')).toEqual([])
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))
    await expect(listAttemptsNeedingAttention('2024-02-01')).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('confirmUnknownOutcome', () => {
  it('🔴 confirming published sets published with the PM reason code', async () => {
    const chain = makeChain({ data: { ...storedAttempt, status: 'published', reason_code: 'CONFIRMED_BY_PM' }, error: null })
    fromMock.mockReturnValue(chain)

    const now = new Date('2024-01-02T00:00:00.000Z')
    const result = await confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: DATE, outcome: 'published', now })

    expect(result?.status).toBe('published')
    expect(chain.update).toHaveBeenCalledWith({
      status: 'published',
      reason_code: 'CONFIRMED_BY_PM',
      updated_at: '2024-01-02T00:00:00.000Z',
    })
    expect(chain.eq).toHaveBeenCalledWith('plan_id', PLAN)
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(chain.eq).toHaveBeenCalledWith('date', DATE)
    expect(chain.eq).toHaveBeenCalledWith('status', 'unknown_outcome')
    expect(chain.select).toHaveBeenCalledWith('*')
  })

  it('🔴 confirming not published makes it retryable with a next_retry_at', async () => {
    const chain = makeChain({ data: { ...storedAttempt, status: 'failed_retryable' }, error: null })
    fromMock.mockReturnValue(chain)

    const now = new Date('2024-01-02T00:00:00.000Z')
    await confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: DATE, outcome: 'not_published', now })

    expect(chain.update).toHaveBeenCalledWith({
      status: 'failed_retryable',
      reason_code: 'CONFIRMED_NOT_PUBLISHED_BY_PM',
      next_retry_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    })
  })

  it('🔴 returns null when the row is no longer unknown_outcome', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))

    expect(
      await confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: DATE, outcome: 'published', now: new Date() }),
    ).toBeNull()
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))

    await expect(
      confirmUnknownOutcome({ planId: PLAN, clientId: CLIENT, date: DATE, outcome: 'published', now: new Date() }),
    ).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('clearNonStickyAttempts', () => {
  it('🔴 removes only the "not yet / not this time" rows and never the ones that carry a fact about Facebook', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await clearNonStickyAttempts({ planId: 'plan-1', clientId: 'client-1', dates: ['2026-10-13'] })

    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('plan_id', 'plan-1')
    expect(chain.eq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(chain.in).toHaveBeenCalledWith('date', ['2026-10-13'])
    const filter = String(chain.or.mock.calls[0][0])
    for (const removable of ['missed_window', 'failed_final', 'failed_retryable', 'dry_run']) expect(filter).toContain(removable)
    for (const kept of ['published', 'unknown_outcome', 'claimed']) expect(filter).not.toContain(kept)
    expect(filter).toContain('reason_code.neq.RECALLED')
  })

  it('does nothing for an empty date list and throws database errors', async () => {
    await clearNonStickyAttempts({ planId: 'p', clientId: 'c', dates: [] })
    expect(fromMock).not.toHaveBeenCalled()
    fromMock.mockReturnValue(makeChain({ data: null, error: { message: 'x' } }))
    await expect(clearNonStickyAttempts({ planId: 'p', clientId: 'c', dates: ['2026-10-13'] })).rejects.toBeTruthy()
  })
})

describe('listFreshClaims', () => {
  it('reads claimed rows of this plan and client updated at or after the cut-off', async () => {
    const chain = makeChain({ data: [{ date: '2026-10-13', status: 'claimed' }], error: null })
    fromMock.mockReturnValue(chain)

    const rows = await listFreshClaims('plan-1', 'client-1', new Date('2026-10-12T00:00:00Z'))

    expect(rows).toHaveLength(1)
    expect(chain.eq).toHaveBeenCalledWith('status', 'claimed')
    expect(chain.eq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(chain.gte).toHaveBeenCalledWith('updated_at', '2026-10-12T00:00:00.000Z')
  })
})

describe('isMissingTableError', () => {
  it('recognises a missing table, and nothing else', () => {
    expect(isMissingTableError({ code: '42P01', message: 'x' })).toBe(true)
    expect(isMissingTableError({ code: 'PGRST205', message: 'x' })).toBe(true)
    expect(isMissingTableError({ message: 'Could not find the table public.x in the schema cache' })).toBe(true)
    expect(isMissingTableError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingTableError(new Error('db down'))).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})
