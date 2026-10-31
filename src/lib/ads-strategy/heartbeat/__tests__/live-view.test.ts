import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_CACHE_TTL_MS,
  buildLiveAccountView,
  clearLiveCacheForTests,
  getLiveToday,
  type LiveDeps,
} from '../live-view'
import { readHeartbeatAccount, type HeartbeatAccountRead, type HeartbeatAdsetSample, type HeartbeatFetchers } from '../read'

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
    expect(partial.reason).toContain('今天的花费数据')
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
      hasActiveCampaigns: vi.fn(async () => true),
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

/** 用真实的 readHeartbeatAccount + 注入的假读取器：验证「有没有在投系列」真的改变了判定（不是只看参数传没传）。 */
function fakeFetchers(adsetRows: number): HeartbeatFetchers {
  const ok = <T,>(rows: T[]) => async () => ({ rows, complete: true, error: null })
  return {
    account: ok([{ id: 'act_1', account_status: 1, currency: 'NZD', timezone_name: 'Pacific/Auckland' }]),
    adsets: ok(Array.from({ length: adsetRows }, (_, i) => ({ id: `as${i}`, effective_status: 'ACTIVE', daily_budget: '5000' }))),
    ads: ok([]),
    insights: ok([]),
  } as unknown as HeartbeatFetchers
}

describe('getLiveToday — 有没有在投系列决定「空广告组列表」是真零还是读失败', () => {
  beforeEach(() => clearLiveCacheForTests())
  function deps(active: boolean | null | Error, fetchers = fakeFetchers(0)): LiveDeps {
    return {
      listOfficialAccountIds: vi.fn(async () => ['act_1']),
      getToken: vi.fn(async () => 'tok'),
      hasActiveCampaigns: vi.fn(async () => {
        if (active instanceof Error) throw active
        return active
      }),
      read: (args) => readHeartbeatAccount({ ...args, fetchers }),
      now: () => NOW,
    }
  }

  it('账户全暂停（active=false）+ 空广告组列表 → 不是读失败，页面显示「现在没有投放中」', async () => {
    const v = await getLiveToday('c1', deps(false))
    expect(v.accounts[0].readState).toBe('ok')
    expect(v.accounts[0].reason).toBeNull()
    expect(v.accounts[0].active).toEqual([])
  })

  it('有在投系列（active=true）+ 空广告组列表 → 仍判读失败（安全规则必须保住）', async () => {
    const v = await getLiveToday('c1', deps(true))
    expect(v.accounts[0].readState).toBe('unreadable')
    expect(v.accounts[0].reason).toContain('广告组')
  })

  it('读不到（null）按「有在投」处理 → 空列表仍判读失败', async () => {
    const v = await getLiveToday('c1', deps(null))
    expect(v.accounts[0].readState).toBe('unreadable')
  })

  it('读取出错（抛错）也按「有在投」处理，不拖垮这个账户的视图', async () => {
    const v = await getLiveToday('c1', deps(new Error('db down')))
    expect(v.accounts[0].readState).toBe('unreadable')
    expect(v.accounts[0].reason).not.toContain('db down')
  })

  it('读失败的文案不出现英文代号，出现中文名和下一步', async () => {
    const v = await getLiveToday('c1', deps(true))
    const reason = v.accounts[0].reason ?? ''
    expect(reason).not.toMatch(/adsets|insights|account|\bads\b/i)
    expect(reason).toContain('广告组')
    expect(reason).toContain('刷新')
  })

  it('单账户隔离：账户 A 查「有没有在投」抛错时，账户 B 的视图逐字段不受影响', async () => {
    const base = deps(false)
    const d: LiveDeps = {
      ...base,
      listOfficialAccountIds: vi.fn(async () => ['act_a', 'act_b']),
      hasActiveCampaigns: vi.fn(async (_c: string, acct: string) => {
        if (acct === 'act_a') throw new Error('boom')
        return false
      }),
      read: (args) => readHeartbeatAccount({ ...args, fetchers: fakeFetchers(0) }),
    }
    const v = await getLiveToday('c1', d)
    const a = v.accounts.find((x) => x.adAccountId === 'act_a')!
    const b = v.accounts.find((x) => x.adAccountId === 'act_b')!
    // A：查询出错 → 保守当有在投 → **仍然去读了 Meta**，空列表判读失败（文案是「广告组没读到」，不是笼统的「读取出错」）
    expect(a.readState).toBe('unreadable')
    expect(a.reason).toContain('广告组')
    expect(a.reason).not.toContain('读取出错')
    // B：只看自己的查询结果（false）→ 真零，逐字段不变
    expect(b.readState).toBe('ok')
    expect(b.reason).toBeNull()
    expect(b.active).toEqual([])
    expect(b.newToday).toEqual([])
    expect(b.currency).toBe('NZD')
  })

  it('未知读取项名字兜底为「某项数据」，不泄漏英文代号', async () => {
    const v = await getLiveToday('c1', {
      ...deps(false),
      read: vi.fn(async () => read({
        outcomes: [{ kind: 'weird', verdict: 'read_failed', reason: 'x', errorCode: 1 }] as unknown as HeartbeatAccountRead['outcomes'],
        anyFailure: true,
      })),
    })
    expect(v.accounts[0].reason).toContain('某项数据')
    expect(v.accounts[0].reason).not.toContain('weird')
  })
})
