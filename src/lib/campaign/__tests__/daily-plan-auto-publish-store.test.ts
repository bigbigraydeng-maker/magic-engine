import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutoPublishAuthorization } from '../daily-plan-auto-publish'

const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

import {
  activateAuthorization,
  findReceiptRecalledDates,
  findRecalledDates,
  getActiveAuthorization,
  insertAuthorization,
  liftRecalledTombstones,
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
  in: ReturnType<typeof vi.fn>
  lte: ReturnType<typeof vi.fn>
  or: ReturnType<typeof vi.fn>
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
  stub.in = vi.fn(self)
  stub.lte = vi.fn(self)
  stub.or = vi.fn(self)
  stub.delete = vi.fn(self)
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
  lifted_dates: [],
  max_per_day: 1,
  authorized_by_email: 'ops@example.com',
  authorized_by_user_id: 'c0000000-0000-0000-0000-000000000005',
  authorized_at: '2024-01-01T00:00:00.000Z',
  expires_at: '2024-01-15T00:00:00.000Z',
}

const storedAuth: AutoPublishAuthorization = {
  id: 'auth-1',
  ...baseRow,
  activated_at: null,
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

const CLIENT = baseRow.client_id
const PLAN = baseRow.plan_id

describe('getActiveAuthorization', () => {
  it('returns null when no active row exists', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await getActiveAuthorization(PLAN, CLIENT)).toBeNull()
  })

  it('🔴 filters by plan AND client, and only non-revoked rows', async () => {
    const chain = makeChain({ data: storedAuth, error: null })
    fromMock.mockReturnValue(chain)

    expect(await getActiveAuthorization(PLAN, CLIENT)).toEqual(storedAuth)
    expect(chain.eq).toHaveBeenCalledWith('plan_id', PLAN)
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('throws database errors', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: { code: '42P01', message: 'x' } }))
    await expect(getActiveAuthorization(PLAN, CLIENT)).rejects.toMatchObject({ code: '42P01' })
  })
})

describe('revokeAuthorization', () => {
  it('🔴 revokes only inside the given client, only if still active, and records who/why', async () => {
    const chain = makeChain({ data: { ...storedAuth, revoked_at: '2024-01-02T00:00:00.000Z' }, error: null })
    fromMock.mockReturnValue(chain)

    const result = await revokeAuthorization({
      planId: PLAN,
      clientId: CLIENT,
      byEmail: 'a@b.c',
      reason: 'because',
      now: new Date('2024-01-02T00:00:00.000Z'),
    })

    expect(result?.revoked_at).toBe('2024-01-02T00:00:00.000Z')
    expect(chain.update).toHaveBeenCalledWith({
      revoked_at: '2024-01-02T00:00:00.000Z',
      revoked_by_email: 'a@b.c',
      revoked_reason: 'because',
    })
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('🔴 with authId, revokes exactly that grant (never a newer one that replaced it)', async () => {
    const chain = makeChain({ data: storedAuth, error: null })
    fromMock.mockReturnValue(chain)

    await revokeAuthorization({ planId: PLAN, clientId: CLIENT, authId: 'auth-1', byEmail: 'a@b.c', reason: 'r' })

    expect(chain.eq).toHaveBeenCalledWith('id', 'auth-1')
  })

  it('returns null when nothing was active', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await revokeAuthorization({ planId: PLAN, clientId: CLIENT, byEmail: 'a', reason: 'r' })).toBeNull()
  })
})

describe('activateAuthorization', () => {
  it('stamps activated_at on a non-revoked grant of this client', async () => {
    const chain = makeChain({ data: { ...storedAuth, activated_at: '2024-01-01T00:00:05.000Z' }, error: null })
    fromMock.mockReturnValue(chain)

    const result = await activateAuthorization({ authId: 'auth-1', clientId: CLIENT, now: new Date('2024-01-01T00:00:05.000Z') })

    expect(result?.activated_at).toBe('2024-01-01T00:00:05.000Z')
    expect(chain.update).toHaveBeenCalledWith({ activated_at: '2024-01-01T00:00:05.000Z' })
    expect(chain.eq).toHaveBeenCalledWith('id', 'auth-1')
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('returns null when the grant was revoked in the meantime', async () => {
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await activateAuthorization({ authId: 'auth-1', clientId: CLIENT })).toBeNull()
  })
})

describe('findRecalledDates / liftRecalledTombstones', () => {
  it('finds only RECALLED blocks of this plan and client', async () => {
    const chain = makeChain({ data: [{ date: '2024-02-02' }], error: null })
    fromMock.mockReturnValue(chain)

    expect(await findRecalledDates(PLAN, CLIENT, ['2024-02-01', '2024-02-02'])).toEqual(['2024-02-02'])
    expect(fromMock).toHaveBeenCalledWith('daily_plan_auto_publish_attempts')
    expect(chain.eq).toHaveBeenCalledWith('status', 'blocked')
    expect(chain.eq).toHaveBeenCalledWith('reason_code', 'RECALLED')
    expect(chain.in).toHaveBeenCalledWith('date', ['2024-02-01', '2024-02-02'])
  })

  it('does not touch the database for an empty date list', async () => {
    expect(await findRecalledDates(PLAN, CLIENT, [])).toEqual([])
    await liftRecalledTombstones({ planId: PLAN, clientId: CLIENT, dates: [], notNewerThan: new Date() })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('🔴 lifting deletes only RECALLED blocks for the listed dates', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await liftRecalledTombstones({ planId: PLAN, clientId: CLIENT, dates: ['2024-02-02'], notNewerThan: new Date() })

    expect(chain.delete).toHaveBeenCalled()
    expect(chain.or).toHaveBeenCalledWith('and(status.eq.blocked,reason_code.eq.RECALLED),status.eq.published')
    expect(chain.in).toHaveBeenCalledWith('date', ['2024-02-02'])
  })

  it('🔴 lifting only removes blocks written at or before the moment the caller looked', async () => {
    const chain = makeChain({ data: null, error: null })
    fromMock.mockReturnValue(chain)

    await liftRecalledTombstones({ planId: PLAN, clientId: CLIENT, dates: ['2024-02-02'], notNewerThan: new Date('2024-01-03T00:00:00.000Z') })

    expect(chain.lte).toHaveBeenCalledWith('updated_at', '2024-01-03T00:00:00.000Z')
  })
})

describe('findReceiptRecalledDates', () => {
  it('reads recalled dates from the plan receipt, de-duplicated', async () => {
    const chain = makeChain({
      data: { plan_data: { publish_meta: { recalled: [{ date: '2024-02-01' }, { date: '2024-02-01' }, { date: '2024-02-03' }] } } },
      error: null,
    })
    fromMock.mockReturnValue(chain)

    expect(await findReceiptRecalledDates(PLAN, CLIENT)).toEqual(['2024-02-01', '2024-02-03'])
    expect(fromMock).toHaveBeenCalledWith('social_plans')
    expect(chain.eq).toHaveBeenCalledWith('client_id', CLIENT)
  })

  it('returns an empty list when there is no receipt or no recalls, and throws on a read error', async () => {
    fromMock.mockReturnValue(makeChain({ data: { plan_data: {} }, error: null }))
    expect(await findReceiptRecalledDates(PLAN, CLIENT)).toEqual([])
    fromMock.mockReturnValue(makeChain({ data: null, error: null }))
    expect(await findReceiptRecalledDates(PLAN, CLIENT)).toEqual([])
    fromMock.mockReturnValue(makeChain({ data: null, error: { message: 'x' } }))
    await expect(findReceiptRecalledDates(PLAN, CLIENT)).rejects.toBeTruthy()
  })
})

describe('tombstoneRecalledDates', () => {
  /** Route each table to its own stub: attempts reads/writes and the auth table. */
  function stubTables(opts: { existing?: Array<{ date: string; status: string }>; auth: AutoPublishAuthorization | null }) {
    const attempts = makeChain({ data: opts.existing ?? [], error: null })
    const auth = makeChain({ data: opts.auth, error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'daily_plan_auto_publish_attempts') return attempts
      if (table === 'daily_plan_auto_publish_auth') return auth
      throw new Error(`unexpected table ${table}`)
    })
    return { attempts, auth }
  }

  it('does nothing for an empty date list', async () => {
    expect(await tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: [] })).toEqual({ tombstoned: 0 })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('🔴 still tombstones when no grant is active (a recall after a revoke must stick)', async () => {
    const { attempts, auth } = stubTables({ auth: null })

    expect(await tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: ['2024-02-01'] })).toEqual({ tombstoned: 1 })

    const rows = attempts.upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ auth_id: null, status: 'blocked', reason_code: 'RECALLED', date: '2024-02-01', client_id: CLIENT, plan_id: PLAN })
    expect(attempts.upsert.mock.calls[0][1]).toEqual({ onConflict: 'plan_id,date' })
    expect(auth.update).not.toHaveBeenCalled()
  })

  it('with an active grant: tombstones, then trims the recalled date from the grant', async () => {
    const { attempts, auth } = stubTables({ auth: { ...storedAuth, dates: ['2024-02-01', '2024-02-02'] } })

    await tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: ['2024-02-01'] })

    const rows = attempts.upsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({ auth_id: 'auth-1', status: 'blocked', reason_code: 'RECALLED' })
    expect(auth.update).toHaveBeenCalledWith({ dates: ['2024-02-02'] })
    expect(auth.is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('revokes the grant when every authorised date was recalled', async () => {
    const { auth } = stubTables({ auth: { ...storedAuth, dates: ['2024-02-01'] } })

    await tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: ['2024-02-01'] })

    const update = auth.update.mock.calls[0][0] as Record<string, unknown>
    expect(update).toMatchObject({ revoked_by_email: 'system:recall' })
    // revokes exactly the grant that was read, never a newer one
    expect(auth.eq).toHaveBeenCalledWith('id', 'auth-1')
    expect(update.dates).toBeUndefined()
  })

  it('🔴 keeps an unknown_outcome row as-is (its "go and check the Page" signal must survive a recall)', async () => {
    const { attempts } = stubTables({
      existing: [{ date: '2024-02-01', status: 'unknown_outcome' }],
      auth: null,
    })

    await tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: ['2024-02-01', '2024-02-02'] })

    const rows = attempts.upsert.mock.calls[0][0] as Array<{ date: string }>
    expect(rows.map(r => r.date)).toEqual(['2024-02-02'])
  })

  it('🔴 refuses (throws) when a date is mid-send (claimed) instead of overwriting the claim', async () => {
    const { attempts } = stubTables({ existing: [{ date: '2024-02-01', status: 'claimed' }], auth: storedAuth })

    await expect(
      tombstoneRecalledDates({ clientId: CLIENT, planId: PLAN, dates: ['2024-02-01'] }),
    ).rejects.toThrow('TOMBSTONE_RACE_CLAIMED')
    expect(attempts.upsert).not.toHaveBeenCalled()
  })
})
