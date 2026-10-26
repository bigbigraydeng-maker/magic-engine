import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_CACHE_TTL_MS,
  buildLiveAccountView,
  clearLiveCacheForTests,
  getLiveToday,
  type LiveDeps,
} from '../live-view'
import type { HeartbeatAccountRead, HeartbeatAdsetSample } from '../read'

const NOW = new Date('2026-10-21T20:00:00Z') // NZ 2026-10-22 09:00 (NZDT, +13)

function adset(o: Partial<HeartbeatAdsetSample> = {}): HeartbeatAdsetSample {
  return {
    adsetId: 'a1', campaignId: 'c1', name: 'Old', effectiveStatus: 'ACTIVE', budgetLevel: 'adset',
    dailyBudgetMinor: 3000, hasLifetimeBudget: false, createdTime: '2026-10-10T00:00:00Z',
    startTime: '2026-10-10T00:00:00Z', updatedTime: null, hasDeliverySchedule: false, isDynamicCreative: false,
    spendTodayMinor: 1234, impressionsToday: 900, ...o,
  }
}
function read(o: Partial<HeartbeatAccountRead> = {}): HeartbeatAccountRead {
  return {
    adAccountId: 'act_1', sampledAtIso: NOW.toISOString(), accountDay: '2026-10-22', timezone: 'Pacific/Auckland',
    currency: 'NZD', accountStatus: 1, disableReason: null, adsets: [adset()], ads: [],
    outcomes: ['account', 'adsets', 'ads', 'insights'].map(kind => ({ kind, verdict: 'ok', reason: 'ok', errorCode: null })) as HeartbeatAccountRead['outcomes'],
    abortedBy: null, callCount: 4, anyFailure: false, ...o,
  }
}

describe('buildLiveAccountView', () => {
  it('converts minor units, lists ACTIVE adsets and picks adsets created/started today (account day)', () => {
    const v = buildLiveAccountView(read({
      adsets: [
        adset(),
        adset({ adsetId: 'a2', name: 'Rebuilt v2', createdTime: '2026-10-21T19:00:00Z', spendTodayMinor: null, impressionsToday: null }),
        adset({ adsetId: 'a3', effectiveStatus: 'PAUSED' }),
      ],
      ads: [{ adId: 'x', adsetId: 'a2', effectiveStatus: 'ACTIVE' }],
    }))
    expect(v.readState).toBe('ok')
    expect(v.active.map(a => a.adsetId)).toEqual(['a1', 'a2'])
    expect(v.active[0]).toMatchObject({ spendToday: 12.34, dailyBudget: 30, impressionsToday: 900 })
    expect(v.active[1].spendToday).toBeNull() // unread is null, never 0
    expect(v.newToday.map(a => a.adsetId)).toEqual(['a2'])
    expect(v.newToday[0].adCount).toBe(1)
  })

  it('CBO adset has no adset-level daily budget; zero-decimal currency is not divided', () => {
    const v = buildLiveAccountView(read({ currency: 'JPY', adsets: [adset({ budgetLevel: 'campaign', dailyBudgetMinor: null, spendTodayMinor: 500 })] }))
    expect(v.active[0].dailyBudget).toBeNull()
    expect(v.active[0].spendToday).toBe(500)
  })

  it('ok + empty adset list → readState ok (not unreadable); UI will show the empty copy, not 读不到', () => {
    // Regression for CTS 2026-10-26: both ad accounts had every adset PAUSED, so the
    // heartbeat whitelist returned 0 rows and the "今日实时" card said "读不到".
    // After the fix, empty_but_ok leaves readState=ok so the panel renders its
    // "现在没有状态为「投放中」的广告组" branch instead.
    const v = buildLiveAccountView(read({
      adsets: [],
      ads: [],
      outcomes: [
        { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'adsets', verdict: 'empty_but_ok', reason: 'empty_adset_list', errorCode: null },
        { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'insights', verdict: 'ok', reason: 'ok', errorCode: null },
      ],
      anyFailure: false,
    }))
    expect(v.readState).toBe('ok')
    expect(v.reason).toBeNull()
    expect(v.active).toEqual([])
    expect(v.newToday).toEqual([])
  })

  it('real adsets read_failed → readState unreadable with 读取失败 reason (not confused with empty)', () => {
    const v = buildLiveAccountView(read({
      adsets: [],
      ads: [],
      outcomes: [
        { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'adsets', verdict: 'read_failed', reason: 'read_failed', errorCode: 100 },
        { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'insights', verdict: 'ok', reason: 'ok', errorCode: null },
      ],
      anyFailure: true,
    }))
    expect(v.readState).toBe('unreadable')
    expect(v.reason).toContain('adsets')
  })

  it('failed reads are never shown as fine', () => {
    const aborted = buildLiveAccountView(read({ abortedBy: 'token_expired', anyFailure: true, adsets: [] }))
    expect(aborted.readState).toBe('unreadable')
    expect(aborted.reason).toContain('授权过期')
    const partial = buildLiveAccountView(read({
      anyFailure: true,
      outcomes: [
        { kind: 'account', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'adsets', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'ads', verdict: 'ok', reason: 'ok', errorCode: null },
        { kind: 'insights', verdict: 'read_failed', reason: 'x', errorCode: 1 },
      ],
    }))
    expect(partial.readState).toBe('partial')
    expect(partial.reason).toContain('insights')
  })
})

describe('getLiveToday cache', () => {
  beforeEach(() => clearLiveCacheForTests())
  function deps(o: Partial<LiveDeps> = {}): LiveDeps & { clock: { t: number } } {
    const clock = { t: NOW.getTime() }
    return {
      clock,
      listOfficialAccountIds: vi.fn(async () => ['act_1']),
      getToken: vi.fn(async () => 'tok'),
      read: vi.fn(async () => read()),
      now: () => new Date(clock.t),
      ...o,
    }
  }

  it('reads Meta once within 60s, again after', async () => {
    const d = deps()
    await getLiveToday('c1', d)
    await getLiveToday('c1', d)
    expect(d.read).toHaveBeenCalledTimes(1)
    d.clock.t += LIVE_CACHE_TTL_MS + 1
    await getLiveToday('c1', d)
    expect(d.read).toHaveBeenCalledTimes(2)
  })

  it('concurrent callers share one in-flight read', async () => {
    const d = deps()
    await Promise.all([getLiveToday('c1', d), getLiveToday('c1', d), getLiveToday('c1', d)])
    expect(d.read).toHaveBeenCalledTimes(1)
  })

  it('missing token or a throwing read gives an unreadable account, not an empty fine one', async () => {
    const v1 = await getLiveToday('c1', deps({ getToken: vi.fn(async () => null) }))
    expect(v1.accounts[0]).toMatchObject({ readState: 'unreadable', active: [] })
    clearLiveCacheForTests()
    const v2 = await getLiveToday('c1', deps({ read: vi.fn(async () => { throw new Error('boom') }) }))
    expect(v2.accounts[0].readState).toBe('unreadable')
  })

  it('no official accounts → empty list (page says so)', async () => {
    const v = await getLiveToday('c1', deps({ listOfficialAccountIds: vi.fn(async () => []) }))
    expect(v.accounts).toEqual([])
  })
})
