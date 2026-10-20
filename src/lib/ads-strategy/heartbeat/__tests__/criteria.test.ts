import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  classifyRead,
  failuresBeforeAlarm,
  evaluateZeroSpend,
  evaluateOverspend,
  diffStatus,
  dedupeKey,
  capAlarms,
} from '../criteria'

describe('classifyRead', () => {
  const base = {
    ok: true,
    complete: true,
    errorCode: null as number | null,
    rowCount: 0,
    accountHasActiveCampaigns: false,
    kind: 'adsets' as const,
  }

  it('empty adset list with active campaigns → read_failed (empty_adset_list)', () => {
    const r = classifyRead({ ...base, accountHasActiveCampaigns: true })
    expect(r.verdict).toBe('read_failed')
    expect(r.reason).toBe('empty_adset_list')
  })

  it('empty adset list without active campaigns → ok', () => {
    const r = classifyRead({ ...base, accountHasActiveCampaigns: false })
    expect(r.verdict).toBe('ok')
  })

  it('errorCode 190 → token_expired', () => {
    const r = classifyRead({ ...base, ok: false, errorCode: 190 })
    expect(r.verdict).toBe('token_expired')
  })

  it.each([17, 80004, 429])('errorCode %i → rate_limited', (code) => {
    const r = classifyRead({ ...base, ok: false, errorCode: code })
    expect(r.verdict).toBe('rate_limited')
  })

  it('ok=false → read_failed', () => {
    const r = classifyRead({ ...base, ok: false })
    expect(r.verdict).toBe('read_failed')
  })

  it('complete=false (ok=true) → read_failed', () => {
    const r = classifyRead({ ...base, complete: false })
    expect(r.verdict).toBe('read_failed')
  })

  it('kind insights with rowCount 0 and active campaigns → ok', () => {
    const r = classifyRead({
      ...base,
      kind: 'insights',
      rowCount: 0,
      accountHasActiveCampaigns: true,
    })
    expect(r.verdict).toBe('ok')
  })
})

describe('failuresBeforeAlarm', () => {
  it('money → 1', () => {
    expect(failuresBeforeAlarm('money')).toBe(1)
  })

  it('other → 2', () => {
    expect(failuresBeforeAlarm('other')).toBe(2)
  })
})

describe('evaluateZeroSpend', () => {
  function base() {
    return {
      effectiveStatus: 'ACTIVE' as string | null,
      deliverySubStatus: null as string | null,
      activeSinceIso: '2026-10-21T00:00:00Z' as string | null,
      nowIso: '2026-10-21T06:00:00Z',
      effectiveDeliveryHours: 5,
      spendTodayMinor: 0 as number | null,
      impressionsToday: 0 as number | null,
      dailyBudgetMinor: 7500 as number | null,
      expectedCpmMinor: 1500 as number | null,
      hasDeliverySchedule: false,
    }
  }

  it('base input alarms', () => {
    const r = evaluateZeroSpend(base())
    expect(r.alarm).toBe(true)
    expect(r.code).toBe('alarm')
  })

  it('not_active', () => {
    const r = evaluateZeroSpend({ ...base(), effectiveStatus: 'PAUSED' })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('not_active')
  })

  it('in_review_or_learning', () => {
    const r = evaluateZeroSpend({ ...base(), deliverySubStatus: 'in_process' })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('in_review_or_learning')
  })

  it('activation_unknown', () => {
    const r = evaluateZeroSpend({ ...base(), activeSinceIso: null })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('activation_unknown')
  })

  it('too_fresh (now = active + 1h)', () => {
    const r = evaluateZeroSpend({
      ...base(),
      nowIso: '2026-10-21T01:00:00Z',
    })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('too_fresh')
  })

  it('report_lag (now = active + 3h)', () => {
    const r = evaluateZeroSpend({
      ...base(),
      nowIso: '2026-10-21T03:00:00Z',
    })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('report_lag')
  })

  it('night_low_traffic_or_schedule (effectiveDeliveryHours 1)', () => {
    const r = evaluateZeroSpend({ ...base(), effectiveDeliveryHours: 1 })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('night_low_traffic_or_schedule')
  })

  it.each([
    'spendTodayMinor',
    'impressionsToday',
    'dailyBudgetMinor',
    'expectedCpmMinor',
  ] as const)('data_missing when %s is null', (field) => {
    const r = evaluateZeroSpend({ ...base(), [field]: null })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('data_missing')
  })

  it('data_missing when expectedCpmMinor is 0', () => {
    const r = evaluateZeroSpend({ ...base(), expectedCpmMinor: 0 })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('data_missing')
  })

  it('micro_budget', () => {
    const r = evaluateZeroSpend({
      ...base(),
      dailyBudgetMinor: 1,
      effectiveDeliveryHours: 2,
      expectedCpmMinor: 100000,
    })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('micro_budget')
  })

  it('delivering when spend and impressions are present', () => {
    const r = evaluateZeroSpend({
      ...base(),
      spendTodayMinor: 500,
      impressionsToday: 300,
    })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('delivering')
  })

  it('impressions above 10% fraction with spend 0 does not alarm', () => {
    // expectedImpressions ≈ 1041.67 → 10% ≈ 104.17; 200 > that.
    const r = evaluateZeroSpend({ ...base(), impressionsToday: 200 })
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('delivering')
  })

  it('threshold override cannot lower the floor', () => {
    const r = evaluateZeroSpend(
      { ...base(), nowIso: '2026-10-21T01:00:00Z' },
      { zeroSpendMinEffectiveHours: 1 },
    )
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('too_fresh')
  })

  it('threshold override can raise the floor (active + 5h → report_lag)', () => {
    const r = evaluateZeroSpend(
      { ...base(), nowIso: '2026-10-21T05:00:00Z' },
      { zeroSpendMinEffectiveHours: 4 },
    )
    expect(r.alarm).toBe(false)
    expect(r.code).toBe('report_lag')
  })
})

describe('evaluateOverspend', () => {
  function adsetBase() {
    return {
      budgetLevel: 'adset' as 'adset' | 'campaign' | null,
      objectKind: 'adset' as const,
      dailyBudgetMinor: 10000 as number | null,
      spendTodayMinor: 0 as number | null,
      currency: 'NZD' as string | null,
    }
  }

  function accountBase() {
    return {
      budgetLevel: null as 'adset' | 'campaign' | null,
      objectKind: 'account' as const,
      dailyBudgetMinor: null as number | null,
      spendTodayMinor: 0 as number | null,
      currency: 'NZD' as string | null,
      capCurrency: 'NZD' as string | null,
      capMinor: 15000 as number | null,
    }
  }

  it('adset with campaign budget level → cbo_not_applicable', () => {
    const r = evaluateOverspend({ ...adsetBase(), budgetLevel: 'campaign' })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('cbo_not_applicable')
  })

  it('adset with null daily budget → cbo_not_applicable', () => {
    const r = evaluateOverspend({ ...adsetBase(), dailyBudgetMinor: null })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('cbo_not_applicable')
  })

  it('adset spend 1.2x budget → no alarm', () => {
    const r = evaluateOverspend({ ...adsetBase(), spendTodayMinor: 12000 })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('within_budget')
  })

  it('adset spend 1.3x budget → yellow alarm', () => {
    const r = evaluateOverspend({ ...adsetBase(), spendTodayMinor: 13000 })
    expect(r.alarm).toBe(true)
    expect(r.severity).toBe('yellow')
    expect(r.reason).toBe('adset_overspend')
  })

  it('adset spend 10x budget is still yellow, never red', () => {
    const r = evaluateOverspend({ ...adsetBase(), spendTodayMinor: 100000 })
    expect(r.alarm).toBe(true)
    expect(r.severity).toBe('yellow')
  })

  it('adset spend null → data_missing', () => {
    const r = evaluateOverspend({ ...adsetBase(), spendTodayMinor: null })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('data_missing')
  })

  it('account spend above cap → red', () => {
    const r = evaluateOverspend({ ...accountBase(), spendTodayMinor: 15001 })
    expect(r.alarm).toBe(true)
    expect(r.severity).toBe('red')
    expect(r.reason).toBe('account_overspend')
  })

  it('account spend exactly at cap → within_cap', () => {
    const r = evaluateOverspend({ ...accountBase(), spendTodayMinor: 15000 })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('within_cap')
  })

  it('account currency mismatch → currency_mismatch', () => {
    const r = evaluateOverspend({
      ...accountBase(),
      currency: 'AUD',
      spendTodayMinor: 20000,
    })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('currency_mismatch')
  })

  it('account capMinor missing → data_missing', () => {
    const r = evaluateOverspend({ ...accountBase(), capMinor: null })
    expect(r.alarm).toBe(false)
    expect(r.reason).toBe('data_missing')
  })

  it('threshold override {overspendFactor: 1.1} makes 1.2x alarm yellow', () => {
    const r = evaluateOverspend(
      { ...adsetBase(), spendTodayMinor: 12000 },
      { overspendFactor: 1.1 },
    )
    expect(r.alarm).toBe(true)
    expect(r.severity).toBe('yellow')
  })

  it('threshold override {overspendFactor: 2} does not loosen (1.3x still alarms)', () => {
    const r = evaluateOverspend(
      { ...adsetBase(), spendTodayMinor: 13000 },
      { overspendFactor: 2 },
    )
    expect(r.alarm).toBe(true)
    expect(r.severity).toBe('yellow')
  })
})

describe('diffStatus', () => {
  const now = '2026-10-21T12:00:00Z'

  it('prev null → []', () => {
    expect(diffStatus(null, { effectiveStatus: 'ACTIVE' }, now)).toEqual([])
  })

  it('ACTIVE → DISAPPROVED yields one disapproved change', () => {
    const changes = diffStatus(
      { effectiveStatus: 'ACTIVE' },
      { effectiveStatus: 'DISAPPROVED' },
      now,
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({
      type: 'disapproved',
      from: 'ACTIVE',
      to: 'DISAPPROVED',
    })
  })

  it('ACTIVE → WITH_ISSUES yields with_issues', () => {
    const changes = diffStatus(
      { effectiveStatus: 'ACTIVE' },
      { effectiveStatus: 'WITH_ISSUES' },
      now,
    )
    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('with_issues')
  })

  it('DISAPPROVED → ACTIVE recovery yields []', () => {
    const changes = diffStatus(
      { effectiveStatus: 'DISAPPROVED' },
      { effectiveStatus: 'ACTIVE' },
      now,
    )
    expect(changes).toEqual([])
  })

  it('recovery then re-disapproval yields a new disapproved event', () => {
    const recovery = diffStatus(
      { effectiveStatus: 'DISAPPROVED' },
      { effectiveStatus: 'ACTIVE' },
      now,
    )
    expect(recovery).toEqual([])

    const again = diffStatus(
      { effectiveStatus: 'ACTIVE' },
      { effectiveStatus: 'DISAPPROVED' },
      now,
    )
    expect(again).toHaveLength(1)
    expect(again[0].type).toBe('disapproved')
  })

  it('no change → []', () => {
    expect(
      diffStatus(
        { effectiveStatus: 'ACTIVE' },
        { effectiveStatus: 'ACTIVE' },
        now,
      ),
    ).toEqual([])
  })

  it('PENDING_REVIEW crossing 24h → pending_review_over_24h', () => {
    const changes = diffStatus(
      { effectiveStatus: 'PENDING_REVIEW', pendingReviewSinceIso: null },
      {
        effectiveStatus: 'PENDING_REVIEW',
        pendingReviewSinceIso: '2026-10-20T11:00:00Z', // 25h before now
      },
      now,
    )
    expect(changes).toHaveLength(1)
    expect(changes[0].type).toBe('pending_review_over_24h')
  })

  it('already over 24h and still over → [] (reported once)', () => {
    const changes = diffStatus(
      {
        effectiveStatus: 'PENDING_REVIEW',
        pendingReviewSinceIso: '2026-10-20T11:00:00Z',
      },
      {
        effectiveStatus: 'PENDING_REVIEW',
        pendingReviewSinceIso: '2026-10-20T11:00:00Z',
      },
      now,
    )
    expect(changes).toEqual([])
  })

  it('PENDING_REVIEW 23h → []', () => {
    const changes = diffStatus(
      { effectiveStatus: 'PENDING_REVIEW', pendingReviewSinceIso: null },
      {
        effectiveStatus: 'PENDING_REVIEW',
        pendingReviewSinceIso: '2026-10-20T13:00:00Z', // 23h before now
      },
      now,
    )
    expect(changes).toEqual([])
  })

  it('accountStatus 1 → 3 yields account_status_changed', () => {
    const changes = diffStatus(
      { effectiveStatus: 'ACTIVE', accountStatus: 1 },
      { effectiveStatus: 'ACTIVE', accountStatus: 3 },
      now,
    )
    expect(changes).toHaveLength(1)
    expect(changes[0]).toEqual({
      type: 'account_status_changed',
      from: '1',
      to: '3',
    })
  })

  it('accountStatus null → 3 yields []', () => {
    const changes = diffStatus(
      { effectiveStatus: 'ACTIVE', accountStatus: null },
      { effectiveStatus: 'ACTIVE', accountStatus: 3 },
      now,
    )
    expect(changes).toEqual([])
  })
})

describe('dedupeKey', () => {
  const now = new Date('2026-10-21T12:30:00Z')

  function key(overrides: Partial<Parameters<typeof dedupeKey>[0]> = {}) {
    return dedupeKey({
      clientId: 'c1',
      accountId: 'act_1',
      objectId: 'adset_1',
      type: 'overspend',
      timezone: 'UTC',
      now,
      ...overrides,
    })
  }

  it('Pacific/Auckland day is 2026-10-22', () => {
    expect(key({ timezone: 'Pacific/Auckland' })).toContain('2026-10-22')
  })

  it('UTC day is 2026-10-21', () => {
    expect(key({ timezone: 'UTC' })).toContain('2026-10-21')
  })

  it('zero_spend ignores objectId (rebuilt adset keeps the same key)', () => {
    const a = key({ type: 'zero_spend', objectId: 'adset_1' })
    const b = key({ type: 'zero_spend', objectId: 'adset_2' })
    expect(a).toBe(b)
  })

  it('overspend differs per objectId', () => {
    const a = key({ type: 'overspend', objectId: 'adset_1' })
    const b = key({ type: 'overspend', objectId: 'adset_2' })
    expect(a).not.toBe(b)
  })

  it.each(['account_status', 'read_failed', 'heartbeat_stalled'] as const)(
    '%s ignores objectId',
    (type) => {
      const a = key({ type, objectId: 'x1' })
      const b = key({ type, objectId: 'x2' })
      expect(a).toBe(b)
    },
  )

  it('different accounts differ', () => {
    const a = key({ accountId: 'act_1' })
    const b = key({ accountId: 'act_2' })
    expect(a).not.toBe(b)
  })
})

describe('capAlarms', () => {
  function alarm(n: number, severity: 'yellow' | 'red') {
    return { key: `k${n}`, severity }
  }

  it('3 alarms → all kept, no summary', () => {
    const alarms = [alarm(1, 'red'), alarm(2, 'yellow'), alarm(3, 'yellow')]
    const r = capAlarms(alarms, 'act_1')
    expect(r.kept).toHaveLength(3)
    expect(r.mergedSummary).toBeNull()
  })

  it('7 alarms → 5 kept, reds first, merged summary', () => {
    const alarms = [
      alarm(1, 'yellow'),
      alarm(2, 'red'),
      alarm(3, 'yellow'),
      alarm(4, 'yellow'),
      alarm(5, 'red'),
      alarm(6, 'yellow'),
      alarm(7, 'yellow'),
    ]
    const r = capAlarms(alarms, 'act_1')
    expect(r.kept).toHaveLength(5)
    expect(r.kept[0].severity).toBe('red')
    expect(r.kept[1].severity).toBe('red')
    expect(r.kept.slice(2).every((a) => a.severity === 'yellow')).toBe(true)
    expect(r.mergedSummary).toBe('账户 act_1 另有 2 个问题')
  })

  it('exactly 5 → null summary', () => {
    const alarms = [
      alarm(1, 'red'),
      alarm(2, 'red'),
      alarm(3, 'yellow'),
      alarm(4, 'yellow'),
      alarm(5, 'yellow'),
    ]
    const r = capAlarms(alarms, 'act_1')
    expect(r.kept).toHaveLength(5)
    expect(r.mergedSummary).toBeNull()
  })

  it('override {maxAlarmsPerAccountPerDay: 2} lowers the cap', () => {
    const alarms = [alarm(1, 'red'), alarm(2, 'yellow'), alarm(3, 'yellow')]
    const r = capAlarms(alarms, 'act_1', { maxAlarmsPerAccountPerDay: 2 })
    expect(r.kept).toHaveLength(2)
    expect(r.mergedSummary).toBe('账户 act_1 另有 1 个问题')
  })

  it('override {maxAlarmsPerAccountPerDay: 50} does not raise the cap', () => {
    const alarms = [
      alarm(1, 'red'),
      alarm(2, 'red'),
      alarm(3, 'yellow'),
      alarm(4, 'yellow'),
      alarm(5, 'yellow'),
      alarm(6, 'yellow'),
      alarm(7, 'yellow'),
    ]
    const r = capAlarms(alarms, 'act_1', { maxAlarmsPerAccountPerDay: 50 })
    expect(r.kept).toHaveLength(5)
    expect(r.mergedSummary).toBe('账户 act_1 另有 2 个问题')
  })
})
