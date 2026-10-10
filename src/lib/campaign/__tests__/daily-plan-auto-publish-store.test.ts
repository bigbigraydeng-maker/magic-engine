import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoPublishAuthorization } from '../daily-plan-auto-publish'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

import {
  getActiveAuthorization,
  insertAuthorization,
  revokeAuthorization,
  tombstoneRecalledDates,
  type NewAutoPublishAuthorization,
} from '../daily-plan-auto-publish-store'

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
  stub.is = vi.fn(self)
  stub.single = vi.fn(async () => result)
  stub.maybeSingle = vi.fn(async () => result)
  stub.then = resolve => resolve(result)

  return stub
}

const baseRow: NewAutoPublishAuthorization = {
  request_id: 'req-1',
  client_id: 'c0000000-0000-0000-0000-000000000001',
  campaign_id: 'c0000000-0000-0000-0000-000000000002',
  plan_id: 'c0000000-0000-0000-0000-000000000003',
  plan_revision: '2024-01-01T00:00:00.000Z',
  review_revision: 'c0000000-0000-0000-0000-000000000004',
  page_id: '1234567890',
  dates: ['2024-02-01', '2024-02-02'],
  max_per_day: 1,
  authorized_by_email: 'ops@example.com',
  authorized_by_user_id: 'c0000000-0000-0000-0000-000000000005',
  authorized_at: '2024-01-01T00:00:00.000Z',
  expires_at: '2024-01-15T00:00:00.000Z',
}

const storedAuth: AutoPublishAuthorization = {
  id: 'auth-1',
  ...baseRow,
  revoked_at: null,
  revoked_by_email: null,
  revoked_reason: null,
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('insertAuthorization', () => {
  it('returns the inserted row on success', async () => {
    const chain = makeChain({ data: storedAuth, error: null })
    fromMock.mockReturnValue(chain)

    const result = await insertAuthorization(baseRow)

    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_auth')
    expect(chain.insert).toHaveBeenCalledWith(baseRow)
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(result).toEqual({ ok: true, authorization: storedAuth })
  })

  it('maps a unique violation to ALREADY_AUTHORIZED', async () => {
    const chain = makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } })
    fromMock.mockReturnValue(chain)

    const result = await insertAuthorization(baseRow)

    expect(result).toEqual({ ok: false, error: 'ALREADY_AUTHORIZED' })
  })

  it('throws on any other database error', async () => {
    const chain = makeChain({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
    fromMock.mockReturnValue(chain)

    await expect(insertAuthorization(baseRow)).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('getActiveAuthorization', () => {
  it('returns null when no active row exists', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    const result = await getActiveAuthorization(baseRow.plan_id)

    expect(result).toBeNull()
  })

  it('returns the row and filters on revoked_at is null', async () => {
    const chain = makeChain({ data: storedAuth, error: null })
    fromMock.mockReturnValue(chain)

    const result = await getActiveAuthorization(baseRow.plan_id)

    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_auth')
    expect(chain.eq).toHaveBeenCalledWith('plan_id', baseRow.plan_id)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
    expect(result).toEqual(storedAuth)
  })
})

describe('revokeAuthorization', () => {
  it('sets the revocation fields and returns the row', async () => {
    const revoked = { ...storedAuth, revoked_at: '2024-01-10T00:00:00.000Z' }
    const chain = makeChain({ data: revoked, error: null })
    fromMock.mockReturnValue(chain)

    const result = await revokeAuthorization({
      planId: baseRow.plan_id,
      byEmail: 'ops@example.com',
      reason: 'no longer needed',
      now: new Date('2024-01-10T00:00:00.000Z'),
    })

    expect(chain.update).toHaveBeenCalledWith({
      revoked_at: '2024-01-10T00:00:00.000Z',
      revoked_by_email: 'ops@example.com',
      revoked_reason: 'no longer needed',
    })
    expect(chain.eq).toHaveBeenCalledWith('plan_id', baseRow.plan_id)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
    expect(result).toEqual(revoked)
  })

  it('returns null when nothing was active', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    const result = await revokeAuthorization({
      planId: baseRow.plan_id,
      byEmail: 'ops@example.com',
      reason: 'no longer needed',
    })

    expect(result).toBeNull()
  })
})

describe('tombstoneRecalledDates', () => {
  it('does nothing when there is no active authorization', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    const result = await tombstoneRecalledDates({
      clientId: baseRow.client_id,
      planId: baseRow.plan_id,
      dates: ['2024-02-01'],
    })

    expect(result).toEqual({ tombstoned: 0 })
    expect(chain.upsert).not.toHaveBeenCalled()
  })

  it('tombstones the dates and trims them from the grant', async () => {
    const authChain = makeChain({ data: storedAuth, error: null })
    const attemptsChain = makeChain({ data: null, error: null })
    const updateChain = makeChain({ data: null, error: null })

    fromMock.mockImplementation((table: string) => {
      if (table === 'daily_plan_auto_publish_auth') {
        // First call is the active-auth read; the later call is the dates update.
        return authChain.update.mock.calls.length === 0 && authChain.select.mock.calls.length === 0
          ? authChain
          : updateChain
      }
      return attemptsChain
    })

    const result = await tombstoneRecalledDates({
      clientId: baseRow.client_id,
      planId: baseRow.plan_id,
      dates: ['2024-02-01'],
    })

    expect(result).toEqual({ tombstoned: 1 })
    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(attemptsChain.upsert).toHaveBeenCalledTimes(1)

    const [rows, options] = attemptsChain.upsert.mock.calls[0]
    expect(options).toEqual({ onConflict: 'plan_id,date' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      auth_id: storedAuth.id,
      client_id: baseRow.client_id,
      plan_id: baseRow.plan_id,
      date: '2024-02-01',
      status: 'blocked',
      reason_code: 'RECALLED',
      provider_impact: 'NONE',
    })

    expect(updateChain.update).toHaveBeenCalledWith({ dates: ['2024-02-02'] })
    expect(updateChain.eq).toHaveBeenCalledWith('id', storedAuth.id)
    expect(updateChain.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('revokes the grant when every authorized date was recalled', async () => {
    const authChain = makeChain({ data: storedAuth, error: null })
    const attemptsChain = makeChain({ data: null, error: null })
    const revokeChain = makeChain({ data: { ...storedAuth, revoked_at: '2024-01-10T00:00:00.000Z' }, error: null })

    let authCalls = 0
    fromMock.mockImplementation((table: string) => {
      if (table === 'daily_plan_auto_publish_auth') {
        authCalls += 1
        return authCalls === 1 ? authChain : revokeChain
      }
      return attemptsChain
    })

    const result = await tombstoneRecalledDates({
      clientId: baseRow.client_id,
      planId: baseRow.plan_id,
      dates: ['2024-02-01', '2024-02-02'],
    })

    expect(result).toEqual({ tombstoned: 2 })
    expect(attemptsChain.upsert).toHaveBeenCalledTimes(1)
    expect(revokeChain.update).toHaveBeenCalledWith({
      revoked_at: expect.any(String),
      revoked_by_email: 'system:recall',
      revoked_reason: 'all authorised dates were recalled',
    })
    expect(revokeChain.eq).toHaveBeenCalledWith('plan_id', baseRow.plan_id)
  })
})
