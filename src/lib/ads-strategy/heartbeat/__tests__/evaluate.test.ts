import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { evaluateAccountRound } from '../evaluate'
import type {
  EvaluateContext,
  HeartbeatState,
} from '../evaluate'
import type {
  HeartbeatAccountRead,
  HeartbeatAdsetSample,
  HeartbeatReadOutcome,
} from '../read'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-21T12:30:00Z')
const SAMPLED_AT = '2026-10-21T12:30:00.000Z'

function okOutcomes(): HeartbeatReadOutcome[] {
  return [
    { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
    { kind: 'adsets', verdict: 'ok', reason: 'ok', errorCode: null },
    { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
    { kind: 'insights', verdict: 'ok', reason: 'ok', errorCode: null },
  ]
}

function makeAdset(
  overrides: Partial<HeartbeatAdsetSample> = {},
): HeartbeatAdsetSample {
  return {
    adsetId: 'adset_1',
    campaignId: 'camp_1',
    name: 'Adset 1',
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

function makeRead(
  overrides: Partial<HeartbeatAccountRead> = {},
): HeartbeatAccountRead {
  return {
    adAccountId: 'act_1',
    sampledAtIso: SAMPLED_AT,
    accountDay: '2026-10-21',
    timezone: 'Pacific/Auckland',
    currency: 'NZD',
    accountStatus: 1,
    disableReason: null,
    adsets: [makeAdset()],
    ads: [],
    outcomes: okOutcomes(),
    abortedBy: null,
    callCount: 4,
    anyFailure: false,
    ...overrides,
  }
}

function makeCtx(overrides: Partial<EvaluateContext> = {}): EvaluateContext {
  return {
    clientId: 'c1',
    now: NOW,
    expectedCpmMinor: 1500,
    accountCapMinor: 15000,
    accountCapCurrency: 'NZD',
    prev: null,
    ...overrides,
  }
}

function makePrev(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    sampledAtIso: '2026-10-21T11:30:00.000Z',
    accountStatus: 1,
    consecutiveReadFailures: 0,
    adsets: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateAccountRound', () => {
  it('healthy round produces no alarms and a sane nextState', () => {
    const result = evaluateAccountRound(makeRead(), makeCtx())

    expect(result.alarms).toEqual([])
    expect(result.skippedReason).toBeNull()
    expect(result.nextState.consecutiveReadFailures).toBe(0)
    expect(result.nextState.accountStatus).toBe(1)
    expect(result.nextState.adsets.adset_1).toEqual({
      effectiveStatus: 'ACTIVE',
      pendingReviewSinceIso: null,
    })
  })

  it('alarms on zero spend after the timing gates pass', () => {
    const read = makeRead({
      adsets: [
        makeAdset({
          startTime: '2026-10-21T07:30:00Z', // 5h ago
          spendTodayMinor: 0,
          impressionsToday: 0,
        }),
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    const zero = result.alarms.filter((a) => a.type === 'zero_spend')
    expect(zero).toHaveLength(1)
    expect(zero[0].severity).toBe('red')
    expect(zero[0].evidence.adset_ids).toEqual(['adset_1'])
  })

  it('collapses multiple zero-spend adsets into one alarm', () => {
    const read = makeRead({
      adsets: [
        makeAdset({
          adsetId: 'adset_1',
          startTime: '2026-10-21T07:30:00Z',
          spendTodayMinor: 0,
          impressionsToday: 0,
        }),
        makeAdset({
          adsetId: 'adset_2',
          startTime: '2026-10-21T07:30:00Z',
          spendTodayMinor: 0,
          impressionsToday: 0,
        }),
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    const zero = result.alarms.filter((a) => a.type === 'zero_spend')
    expect(zero).toHaveLength(1)
    expect((zero[0].evidence.adset_ids as string[]).length).toBe(2)
  })

  it('alarms immediately on token_expired', () => {
    const read = makeRead({
      abortedBy: 'token_expired',
      anyFailure: true,
      outcomes: [
        { kind: 'account', verdict: 'token_expired', reason: 'token_expired', errorCode: 190 },
        { kind: 'adsets', verdict: 'skipped', reason: 'aborted_by_token_expired', errorCode: null },
        { kind: 'ads', verdict: 'skipped', reason: 'aborted_by_token_expired', errorCode: null },
        { kind: 'insights', verdict: 'skipped', reason: 'aborted_by_token_expired', errorCode: null },
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    const failed = result.alarms.filter((a) => a.type === 'read_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].severity).toBe('red')
    expect(failed[0].evidence.reason).toBe('token_expired')
  })

  it('rate_limited: first failure is an observation, second is an alarm', () => {
    const read = makeRead({
      abortedBy: 'rate_limited',
      anyFailure: true,
      outcomes: [
        { kind: 'account', verdict: 'rate_limited', reason: 'rate_limited', errorCode: 17 },
        { kind: 'adsets', verdict: 'skipped', reason: 'aborted_by_rate_limited', errorCode: null },
        { kind: 'ads', verdict: 'skipped', reason: 'aborted_by_rate_limited', errorCode: null },
        { kind: 'insights', verdict: 'skipped', reason: 'aborted_by_rate_limited', errorCode: null },
      ],
    })

    const first = evaluateAccountRound(read, makeCtx())
    expect(first.alarms.filter((a) => a.type === 'read_failed')).toHaveLength(0)
    expect(first.observations.some((o) => o.type === 'rate_limited_skipped')).toBe(true)

    const second = evaluateAccountRound(
      read,
      makeCtx({ prev: makePrev({ consecutiveReadFailures: 1 }) }),
    )
    const failed = second.alarms.filter((a) => a.type === 'read_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].severity).toBe('yellow')
  })

  it('money-category failure (insights) alarms on the first failure', () => {
    const read = makeRead({
      anyFailure: true,
      outcomes: [
        { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'adsets', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'insights', verdict: 'read_failed', reason: 'read_failed', errorCode: null },
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    const failed = result.alarms.filter((a) => a.type === 'read_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].evidence.category).toBe('money')
  })

  it('account status 1 -> 3 is a red alarm', () => {
    const read = makeRead({ accountStatus: 3 })
    const result = evaluateAccountRound(
      read,
      makeCtx({ prev: makePrev({ accountStatus: 1 }) }),
    )

    const status = result.alarms.filter((a) => a.type === 'account_status')
    expect(status).toHaveLength(1)
    expect(status[0].severity).toBe('red')
    expect(status[0].evidence).toEqual({ from: '1', to: '3' })
  })

  it('account status 3 -> 1 is a yellow recovery alarm', () => {
    const read = makeRead({ accountStatus: 1 })
    const result = evaluateAccountRound(
      read,
      makeCtx({ prev: makePrev({ accountStatus: 3 }) }),
    )

    const status = result.alarms.filter((a) => a.type === 'account_status')
    expect(status).toHaveLength(1)
    expect(status[0].severity).toBe('yellow')
  })

  it('adset ACTIVE -> DISAPPROVED is a red status_change', () => {
    const read = makeRead({
      adsets: [makeAdset({ effectiveStatus: 'DISAPPROVED' })],
    })
    const prev = makePrev({
      adsets: { adset_1: { effectiveStatus: 'ACTIVE', pendingReviewSinceIso: null } },
    })

    const result = evaluateAccountRound(read, makeCtx({ prev }))

    const change = result.alarms.filter((a) => a.type === 'status_change')
    expect(change).toHaveLength(1)
    expect(change[0].severity).toBe('red')
    expect(change[0].objectId).toBe('adset_1')
    expect(change[0].evidence.change).toBe('disapproved')
  })

  it('adset overspend is an observation, never an alarm', () => {
    const read = makeRead({
      adsets: [makeAdset({ dailyBudgetMinor: 7500, spendTodayMinor: 9750 })], // 1.3x
    })

    const result = evaluateAccountRound(read, makeCtx())

    expect(result.alarms.filter((a) => a.type === 'overspend')).toHaveLength(0)
    const obs = result.observations.filter((o) => o.type === 'adset_overspend')
    expect(obs).toHaveLength(1)
  })

  it('account overspend over cap is a red alarm', () => {
    const read = makeRead({
      adsets: [makeAdset({ spendTodayMinor: 15001 })],
    })

    const result = evaluateAccountRound(read, makeCtx())

    const over = result.alarms.filter((a) => a.type === 'overspend')
    expect(over).toHaveLength(1)
    expect(over[0].severity).toBe('red')
    expect(over[0].evidence.reason).toBe('account_overspend')
  })

  it('currency mismatch is an observation, not an alarm', () => {
    const read = makeRead({
      currency: 'USD',
      adsets: [makeAdset({ spendTodayMinor: 99999 })],
    })

    const result = evaluateAccountRound(read, makeCtx())

    expect(result.alarms.filter((a) => a.type === 'overspend')).toHaveLength(0)
    expect(result.observations.some((o) => o.type === 'currency_mismatch')).toBe(true)
  })

  it('insights failure suppresses overspend and zero-spend alarms', () => {
    const read = makeRead({
      anyFailure: true,
      outcomes: [
        { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'adsets', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'insights', verdict: 'read_failed', reason: 'read_failed', errorCode: null },
      ],
      adsets: [
        makeAdset({
          startTime: '2026-10-21T07:30:00Z',
          spendTodayMinor: 0,
          impressionsToday: 0,
        }),
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    expect(result.alarms.filter((a) => a.type === 'zero_spend')).toHaveLength(0)
    expect(result.alarms.filter((a) => a.type === 'overspend')).toHaveLength(0)
  })

  it('carries pendingReviewSinceIso across rounds', () => {
    const prev = makePrev({
      adsets: {
        adset_1: {
          effectiveStatus: 'PENDING_REVIEW',
          pendingReviewSinceIso: '2026-10-20T00:00:00.000Z',
        },
      },
    })
    const read = makeRead({
      adsets: [makeAdset({ effectiveStatus: 'PENDING_REVIEW' })],
    })

    const result = evaluateAccountRound(read, makeCtx({ prev }))

    expect(result.nextState.adsets.adset_1.pendingReviewSinceIso).toBe(
      '2026-10-20T00:00:00.000Z',
    )
  })

  it('never merges red alarms away, even past the daily cap', () => {
    const adsets = Array.from({ length: 8 }, (_, i) =>
      makeAdset({
        adsetId: `adset_${i}`,
        effectiveStatus: 'DISAPPROVED',
      }),
    )
    const prev = makePrev({
      adsets: Object.fromEntries(
        adsets.map((a) => [a.adsetId, { effectiveStatus: 'ACTIVE', pendingReviewSinceIso: null }]),
      ),
    })
    const read = makeRead({ adsets })

    const result = evaluateAccountRound(read, makeCtx({ prev }))

    expect(result.alarms.length).toBeGreaterThanOrEqual(8)
    expect(result.alarms.every((a) => a.severity === 'red')).toBe(true)
    expect(result.mergedSummary).toBeNull()
  })

  it('caps yellow-only overflow at 5 and reports the merged summary', () => {
    const adsets = Array.from({ length: 7 }, (_, i) =>
      makeAdset({
        adsetId: `adset_${i}`,
        effectiveStatus: 'PENDING_REVIEW',
        // 7 个组合计要低于账户上限（15000），否则会多出一条账户超限的红牌占掉名额
        spendTodayMinor: 1000,
      }),
    )
    // prev sampled 23h after pendingReviewSince → not yet over 24h at prev time.
    const prev = makePrev({
      sampledAtIso: '2026-10-21T10:00:00.000Z',
      adsets: Object.fromEntries(
        adsets.map((a) => [
          a.adsetId,
          {
            effectiveStatus: 'PENDING_REVIEW',
            pendingReviewSinceIso: '2026-10-20T11:00:00.000Z',
          },
        ]),
      ),
    })
    const read = makeRead({ adsets })

    const result = evaluateAccountRound(read, makeCtx({ prev }))

    const changes = result.alarms.filter((a) => a.type === 'status_change')
    expect(changes).toHaveLength(5)
    expect(changes.every((a) => a.severity === 'yellow')).toBe(true)
    expect(new Set(changes.map((a) => a.objectId)).size).toBe(5)
    expect(result.mergedSummary).toBe('账户 act_1 另有 2 个问题')
  })

  it('CBO adset (campaign budget) never overspends', () => {
    const read = makeRead({
      adsets: [
        makeAdset({
          budgetLevel: 'campaign',
          dailyBudgetMinor: null,
          spendTodayMinor: 99999,
        }),
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    expect(result.observations.filter((o) => o.type === 'adset_overspend')).toHaveLength(0)
  })

  it('returns skippedReason when the read aborted with no alarms', () => {
    const read = makeRead({
      abortedBy: 'rate_limited',
      anyFailure: true,
      outcomes: [
        { kind: 'account', verdict: 'rate_limited', reason: 'rate_limited', errorCode: 17 },
        { kind: 'adsets', verdict: 'skipped', reason: 'aborted_by_rate_limited', errorCode: null },
        { kind: 'ads', verdict: 'skipped', reason: 'aborted_by_rate_limited', errorCode: null },
        { kind: 'insights', verdict: 'skipped', reason: 'aborted_by_rate_limited', errorCode: null },
      ],
    })

    const result = evaluateAccountRound(read, makeCtx())

    expect(result.alarms).toHaveLength(0)
    expect(result.skippedReason).toBe('aborted_by_rate_limited')
  })
})
