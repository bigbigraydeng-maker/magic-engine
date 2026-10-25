import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  AD_HEARTBEAT_PURGE_DAYS,
  heartbeatConfigProblem,
  parseHeartbeatClientIds,
  resolveHeartbeatMode,
  runAdHeartbeat,
  type HeartbeatDeps,
  type HeartbeatMode,
} from '../run'
import {
  HeartbeatTableMissingError,
  isTableMissingError,
  stateKey,
  type BoundAccount,
  type HeartbeatStore,
  type OpenAlarm,
} from '../store'
import type { HeartbeatAccountRead, HeartbeatAdsetSample } from '../read'
import type { AlarmCandidate, HeartbeatState } from '../evaluate'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-21T12:30:00Z')
const NOW_ISO = NOW.toISOString()

function healthyAdset(
  overrides: Partial<HeartbeatAdsetSample> = {},
): HeartbeatAdsetSample {
  return {
    adsetId: 'adset_1',
    campaignId: 'camp_1',
    name: 'Healthy adset',
    effectiveStatus: 'ACTIVE',
    budgetLevel: 'adset',
    dailyBudgetMinor: 7500,
    hasLifetimeBudget: false,
    createdTime: '2026-10-20T00:00:00Z',
    startTime: '2026-10-21T00:00:00Z',
    updatedTime: '2026-10-21T00:00:00Z',
    hasDeliverySchedule: false,
    isDynamicCreative: false,
    spendTodayMinor: 5000,
    impressionsToday: 1000,
    ...overrides,
  }
}

function zeroSpendAdset(
  overrides: Partial<HeartbeatAdsetSample> = {},
): HeartbeatAdsetSample {
  return healthyAdset({
    adsetId: 'adset_zero',
    name: 'Zero spend adset',
    startTime: '2026-10-21T07:30:00Z', // 5h before NOW
    spendTodayMinor: 0,
    impressionsToday: 0,
    ...overrides,
  })
}

function makeRead(
  overrides: Partial<HeartbeatAccountRead> = {},
): HeartbeatAccountRead {
  return {
    adAccountId: 'act_1',
    sampledAtIso: NOW_ISO,
    accountDay: '2026-10-21',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    accountStatus: 1,
    disableReason: null,
    adsets: [healthyAdset()],
    ads: [],
    outcomes: [
      { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
      { kind: 'adsets', verdict: 'ok', reason: 'ok', errorCode: null },
      { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
      { kind: 'insights', verdict: 'ok', reason: 'ok', errorCode: null },
    ],
    abortedBy: null,
    callCount: 4,
    anyFailure: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fake store
// ---------------------------------------------------------------------------

interface StoreCalls {
  upsertState: Array<{
    clientId: string
    adAccountId: string
    state: HeartbeatState
    evidence: Record<string, unknown>
    now: Date
  }>
  upsertAlarm: Array<{
    clientId: string
    adAccountId: string
    alarm: AlarmCandidate
    now: Date
  }>
  resolveAlarms: Array<{ clientId: string; keys: string[]; now: Date }>
  purgeResolved: Array<{ now: Date; olderThanDays: number }>
}

interface FakeStore extends HeartbeatStore {
  calls: StoreCalls
}

interface MakeStoreOpts {
  accounts?: BoundAccount[]
  open?: OpenAlarm[]
  hasActiveCampaigns?: boolean | null
  cpmMajor14d?: number | null
  getState?: HeartbeatState | null
  upsertStateImpl?: () => Promise<void>
  upsertAlarmImpl?: () => Promise<'inserted' | 'updated'>
}

function makeStore(opts: MakeStoreOpts = {}): FakeStore {
  const calls: StoreCalls = {
    upsertState: [],
    upsertAlarm: [],
    resolveAlarms: [],
    purgeResolved: [],
  }

  const accounts: BoundAccount[] = opts.accounts ?? [
    { adAccountId: 'act_1', hidden: false, dailyCapCents: 15000 },
  ]
  const open = opts.open ?? []
  const active =
    opts.hasActiveCampaigns === undefined ? true : opts.hasActiveCampaigns
  const cpm = opts.cpmMajor14d === undefined ? 14.14 : opts.cpmMajor14d
  const state = opts.getState === undefined ? null : opts.getState

  const store: FakeStore = {
    calls,
    listAccounts: vi.fn(async () => accounts),
    hasActiveCampaigns: vi.fn(async () => active),
    cpmMajor14d: vi.fn(async () => cpm),
    getState: vi.fn(async () => state),
    upsertState: vi.fn(
      async (
        clientId: string,
        adAccountId: string,
        nextState: HeartbeatState,
        evidence: Record<string, unknown>,
        now: Date,
      ) => {
        calls.upsertState.push({
          clientId,
          adAccountId,
          state: nextState,
          evidence,
          now,
        })
        if (opts.upsertStateImpl) await opts.upsertStateImpl()
      },
    ),
    listOpenAlarms: vi.fn(async () => open),
    upsertAlarm: vi.fn(
      async (
        clientId: string,
        adAccountId: string,
        alarm: AlarmCandidate,
        now: Date,
      ) => {
        calls.upsertAlarm.push({ clientId, adAccountId, alarm, now })
        if (opts.upsertAlarmImpl) return opts.upsertAlarmImpl()
        return 'inserted' as const
      },
    ),
    resolveAlarms: vi.fn(
      async (clientId: string, keys: string[], now: Date) => {
        calls.resolveAlarms.push({ clientId, keys, now })
        return keys.length
      },
    ),
    purgeResolved: vi.fn(async (now: Date, olderThanDays: number) => {
      calls.purgeResolved.push({ now, olderThanDays })
      return 0
    }),
  }

  return store
}

function makeDeps(
  store: HeartbeatStore,
  read: HeartbeatDeps['read'],
  overrides: Partial<HeartbeatDeps> = {},
): HeartbeatDeps {
  return {
    store,
    getToken: async () => 'tok',
    read,
    now: () => NOW,
    newRequestId: () => 'req-1',
    ...overrides,
  }
}

function run(
  deps: HeartbeatDeps,
  mode: HeartbeatMode,
  clientIds: string[] = ['client_1'],
) {
  return runAdHeartbeat(deps, { mode, clientIds })
}

// ---------------------------------------------------------------------------
// Mode / client parsing
// ---------------------------------------------------------------------------

describe('resolveHeartbeatMode', () => {
  it('defaults to dry', () => {
    expect(resolveHeartbeatMode(undefined)).toBe('dry')
    expect(resolveHeartbeatMode('')).toBe('dry')
  })

  it('parses known modes case-insensitively', () => {
    expect(resolveHeartbeatMode('LIVE')).toBe('live')
    expect(resolveHeartbeatMode('off')).toBe('off')
    expect(resolveHeartbeatMode('dry')).toBe('dry')
  })

  it('falls back to off for unknown values', () => {
    expect(resolveHeartbeatMode('banana')).toBe('off')
  })
})

describe('parseHeartbeatClientIds', () => {
  it('trims, dedupes and drops empties', () => {
    expect(parseHeartbeatClientIds('a, b ,a,,c')).toEqual(['a', 'b', 'c'])
  })

  it('returns [] for undefined', () => {
    expect(parseHeartbeatClientIds(undefined)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Off / empty
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — off', () => {
  it('does nothing when mode is off', async () => {
    const store = makeStore()
    const read = vi.fn(async () => makeRead())
    const receipt = await run(makeDeps(store, read), 'off')

    expect(read).not.toHaveBeenCalled()
    expect(store.upsertState).not.toHaveBeenCalled()
    expect(store.upsertAlarm).not.toHaveBeenCalled()
    expect(receipt.rounds).toEqual([])
    expect(receipt.accounts_checked).toBe(0)
  })

  it('does nothing when there are no client ids', async () => {
    const store = makeStore()
    const read = vi.fn(async () => makeRead())
    const receipt = await run(makeDeps(store, read), 'live', [])

    expect(read).not.toHaveBeenCalled()
    expect(store.upsertState).not.toHaveBeenCalled()
    expect(receipt.rounds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — dry', () => {
  it('reads, evaluates and writes only state', async () => {
    const store = makeStore()
    const read = vi.fn(async (_args: unknown) => makeRead())
    const receipt = await run(makeDeps(store, read), 'dry')

    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0][0]).toMatchObject({
      adAccountId: 'act_1',
      accountHasActiveCampaigns: true,
    })

    expect(store.upsertState).toHaveBeenCalledTimes(1)
    expect(store.calls.upsertState[0].adAccountId).toBe('act_1')
    expect(stateKey('client_1', 'act_1')).toBe('client_1|act_1|state')

    expect(store.upsertAlarm).not.toHaveBeenCalled()
    expect(store.resolveAlarms).not.toHaveBeenCalled()
    expect(store.purgeResolved).not.toHaveBeenCalled()

    const account = receipt.rounds[0].accounts[0]
    expect(account.status).toBe('ok')
    expect(account.wrote_state).toBe(true)
    expect(receipt.cost_usd).toBe(0)
    expect(receipt.no_publish).toBe(true)
    expect(receipt.request_id).toBe('req-1')
  })

  it('reports a zero-spend alarm without persisting it', async () => {
    const store = makeStore()
    const read = vi.fn(async () =>
      makeRead({ adsets: [zeroSpendAdset()] }),
    )
    const receipt = await run(makeDeps(store, read), 'dry')

    const account = receipt.rounds[0].accounts[0]
    const zeroSpend = account.alarms.filter((a) => a.type === 'zero_spend')
    expect(zeroSpend).toHaveLength(1)
    expect(store.upsertAlarm).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Live run
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — live', () => {
  it('persists alarms and purges', async () => {
    const store = makeStore()
    const read = vi.fn(async () =>
      makeRead({ adsets: [zeroSpendAdset()] }),
    )
    const receipt = await run(makeDeps(store, read), 'live')

    expect(store.upsertAlarm).toHaveBeenCalledTimes(1)
    expect(store.upsertState).toHaveBeenCalledTimes(1)
    expect(store.purgeResolved).toHaveBeenCalledTimes(1)
    expect(store.calls.purgeResolved[0].olderThanDays).toBe(
      AD_HEARTBEAT_PURGE_DAYS,
    )
    expect(store.calls.purgeResolved[0].now).toEqual(NOW)

    const account = receipt.rounds[0].accounts[0]
    expect(account.alarms_inserted).toBe(1)
  })

  it('resolves stale open alarms on a healthy round', async () => {
    const store = makeStore({
      open: [
        { key: 'old-key', alarmType: 'zero_spend', objectId: null, occurrences: 3 },
      ],
    })
    const read = vi.fn(async () => makeRead())
    await run(makeDeps(store, read), 'live')

    expect(store.resolveAlarms).toHaveBeenCalledTimes(1)
    expect(store.calls.resolveAlarms[0].keys).toEqual(['old-key'])
  })

  it('does not resolve when the read failed', async () => {
    const store = makeStore({
      open: [
        { key: 'old-key', alarmType: 'zero_spend', objectId: null, occurrences: 3 },
      ],
    })
    const read = vi.fn(async () =>
      makeRead({
        anyFailure: true,
        outcomes: [
          { kind: 'account', verdict: 'read_failed', reason: 'boom', errorCode: 1 },
          { kind: 'adsets', verdict: 'skipped', reason: 'aborted_by_read_failed', errorCode: null },
          { kind: 'ads', verdict: 'skipped', reason: 'aborted_by_read_failed', errorCode: null },
          { kind: 'insights', verdict: 'skipped', reason: 'aborted_by_read_failed', errorCode: null },
        ],
      }),
    )
    await run(makeDeps(store, read), 'live')

    expect(store.resolveAlarms).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Skips
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — skips', () => {
  it('skips hidden accounts', async () => {
    const store = makeStore({
      accounts: [{ adAccountId: 'act_1', hidden: true, dailyCapCents: 15000 }],
    })
    const read = vi.fn(async () => makeRead())
    const receipt = await run(makeDeps(store, read), 'live')

    expect(read).not.toHaveBeenCalled()
    expect(store.upsertState).not.toHaveBeenCalled()
    expect(store.upsertAlarm).not.toHaveBeenCalled()
    expect(receipt.rounds[0].accounts[0].status).toBe('skipped_hidden')
  })

  it('skips accounts without a token', async () => {
    const store = makeStore()
    const read = vi.fn(async () => makeRead())
    const receipt = await run(
      makeDeps(store, read, { getToken: async () => null }),
      'live',
    )

    expect(read).not.toHaveBeenCalled()
    expect(receipt.rounds[0].accounts[0].status).toBe('no_token')
  })

  it('treats unknown active-campaign state as active', async () => {
    const store = makeStore({ hasActiveCampaigns: null })
    const read = vi.fn(async (_args: unknown) => makeRead())
    await run(makeDeps(store, read), 'dry')

    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0][0]).toMatchObject({
      accountHasActiveCampaigns: true,
    })
  })
})

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — errors', () => {
  it('reports table_missing when upsertState throws HeartbeatTableMissingError', async () => {
    const store = makeStore({
      upsertStateImpl: async () => {
        throw new HeartbeatTableMissingError()
      },
    })
    const read = vi.fn(async () => makeRead())
    const receipt = await run(makeDeps(store, read), 'live')

    expect(receipt.table_missing).toBe(true)
    expect(receipt.rounds[0].accounts[0].status).toBe('table_missing')
  })

  it('detects table-missing errors from raw error shapes', () => {
    expect(isTableMissingError({ code: '42P01' })).toBe(true)
    expect(
      isTableMissingError({ message: 'relation "public.ad_heartbeat_alarms" does not exist' }),
    ).toBe(true)
    expect(isTableMissingError({ code: '23505' })).toBe(false)
    // Other "does not exist" errors (Graph object, missing column, other tables) are real faults.
    expect(isTableMissingError({ message: 'Object with ID 123 does not exist' })).toBe(false)
    expect(isTableMissingError({ message: 'column "x" of relation "ad_entity_snapshots" does not exist' })).toBe(false)
    expect(isTableMissingError(null)).toBe(false)
  })

  it('isolates a failing account and continues', async () => {
    const store = makeStore({
      accounts: [
        { adAccountId: 'act_1', hidden: false, dailyCapCents: 15000 },
        { adAccountId: 'act_2', hidden: false, dailyCapCents: 15000 },
      ],
    })
    const read = vi.fn(async (args: { adAccountId: string }) => {
      if (args.adAccountId === 'act_1') throw new Error('graph exploded')
      return makeRead({ adAccountId: 'act_2' })
    })
    const receipt = await run(makeDeps(store, read), 'live')

    const [first, second] = receipt.rounds[0].accounts
    expect(first.status).toBe('error')
    expect(first.error).toContain('graph exploded')
    expect(second.status).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// Aborts
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — aborts', () => {
  it('reports aborted and raises a read_failed alarm in live mode', async () => {
    const store = makeStore()
    const read = vi.fn(async () =>
      makeRead({
        abortedBy: 'token_expired',
        anyFailure: true,
        accountStatus: null,
        outcomes: [
          { kind: 'account', verdict: 'token_expired', reason: 'token_expired', errorCode: 190 },
          { kind: 'adsets', verdict: 'skipped', reason: 'aborted_by_token_expired', errorCode: null },
          { kind: 'ads', verdict: 'skipped', reason: 'aborted_by_token_expired', errorCode: null },
          { kind: 'insights', verdict: 'skipped', reason: 'aborted_by_token_expired', errorCode: null },
        ],
      }),
    )
    const receipt = await run(makeDeps(store, read), 'live')

    expect(receipt.rounds[0].accounts[0].status).toBe('aborted')
    expect(store.upsertAlarm).toHaveBeenCalledTimes(1)
    expect(store.calls.upsertAlarm[0].alarm.type).toBe('read_failed')
  })
})

// ---------------------------------------------------------------------------
// CPM / currency
// ---------------------------------------------------------------------------

describe('runAdHeartbeat — expected CPM', () => {
  it('alarms on zero spend when a CPM baseline exists', async () => {
    const store = makeStore({ cpmMajor14d: 14.14 })
    const read = vi.fn(async () => makeRead({ adsets: [zeroSpendAdset()] }))
    const receipt = await run(makeDeps(store, read), 'dry')

    const alarms = receipt.rounds[0].accounts[0].alarms
    expect(alarms.some((a) => a.type === 'zero_spend')).toBe(true)
  })

  it('does not alarm on zero spend when the CPM baseline is missing', async () => {
    const store = makeStore({ cpmMajor14d: null })
    const read = vi.fn(async () => makeRead({ adsets: [zeroSpendAdset()] }))
    const receipt = await run(makeDeps(store, read), 'dry')

    const alarms = receipt.rounds[0].accounts[0].alarms
    expect(alarms.some((a) => a.type === 'zero_spend')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Review fixes (3037 round 1)
// ---------------------------------------------------------------------------

describe('persistence order and config problems', () => {
  it('🔴 live: an alarm write failure leaves the state NOT advanced (so the change is seen again next round)', async () => {
    const store = makeStore({
      upsertAlarmImpl: async () => {
        throw new Error('db down')
      },
    })
    const read = vi.fn(async () =>
      makeRead({ adsets: [healthyAdset({ effectiveStatus: 'DISAPPROVED' })] }),
    )
    const prev: HeartbeatState = {
      sampledAtIso: '2026-10-21T11:30:00.000Z',
      accountStatus: 1,
      consecutiveReadFailures: 0,
      adsets: { adset_1: { effectiveStatus: 'ACTIVE', pendingReviewSinceIso: null } },
    }
    const s2 = makeStore({
      getState: prev,
      upsertAlarmImpl: async () => {
        throw new Error('db down')
      },
    })
    const receipt = await run(makeDeps(s2, read), 'live')
    expect(receipt.rounds[0].accounts[0].status).toBe('error')
    expect(s2.calls.upsertState).toHaveLength(0)
    expect(store.calls.upsertState).toHaveLength(0)
  })

  it('🔴 live: alarms are written before the state', async () => {
    const order: string[] = []
    const store = makeStore({
      getState: {
        sampledAtIso: '2026-10-21T11:30:00.000Z',
        accountStatus: 1,
        consecutiveReadFailures: 0,
        adsets: { adset_1: { effectiveStatus: 'ACTIVE', pendingReviewSinceIso: null } },
      },
      upsertAlarmImpl: async () => {
        order.push('alarm')
        return 'inserted'
      },
      upsertStateImpl: async () => {
        order.push('state')
      },
    })
    const read = vi.fn(async () =>
      makeRead({ adsets: [healthyAdset({ effectiveStatus: 'DISAPPROVED' })] }),
    )
    await run(makeDeps(store, read), 'live')
    expect(order[0]).toBe('alarm')
    expect(order[order.length - 1]).toBe('state')
  })

  it('🔴 aborted round keeps the previous adset states and sample time', async () => {
    const prev: HeartbeatState = {
      sampledAtIso: '2026-10-21T11:30:00.000Z',
      accountStatus: 1,
      consecutiveReadFailures: 0,
      adsets: { adset_1: { effectiveStatus: 'PENDING_REVIEW', pendingReviewSinceIso: '2026-10-20T09:00:00.000Z' } },
    }
    const store = makeStore({ getState: prev })
    const read = vi.fn(async () =>
      makeRead({
        adsets: [],
        abortedBy: 'token_expired',
        anyFailure: true,
        outcomes: [{ kind: 'account', verdict: 'token_expired', reason: 'x', errorCode: 190 }],
      }),
    )
    await run(makeDeps(store, read), 'dry')
    const written = store.calls.upsertState[0].state
    expect(written.adsets).toEqual(prev.adsets)
    expect(written.sampledAtIso).toBe(prev.sampledAtIso)
  })

  it('config problems: typo mode, live with no clients, client with no accounts', async () => {
    expect(heartbeatConfigProblem('lvie', ['a'])).toContain('无法识别')
    expect(heartbeatConfigProblem('live', [])).toContain('为空')
    expect(heartbeatConfigProblem('live', ['a'])).toBeNull()
    expect(heartbeatConfigProblem(undefined, [])).toBeNull()
    const store = makeStore({ accounts: [] })
    const receipt = await run(makeDeps(store, vi.fn(async () => makeRead())), 'dry')
    expect(receipt.problems.join(' ')).toContain('没有绑定的广告账户')
    const idle = await runAdHeartbeat(makeDeps(makeStore(), vi.fn(async () => makeRead())), {
      mode: 'off',
      clientIds: [],
      configProblem: 'bad',
    })
    expect(idle.problems).toEqual(['bad'])
  })
})
