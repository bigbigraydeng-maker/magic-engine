import { describe, expect, it } from 'vitest'
import {
  decideLaunchWatch,
  firstSpendSeenFromRows,
  isWatchActive,
  postLaunchStatesFromRows,
  seriesWatchStatusFromRows,
  watchEventId,
  type PostLaunchReceiptState,
} from '../launch-watch'
import { buildClientReceipt, buildRunReceipt } from '../receipt'
import { HARD_GATE, type LaunchWatchConfig, type TrackingGateReceipt } from '../types'

// 开投后「自动补排」：每小时看一眼，开投有花费且没做过读回，就自己补排 T+1h / T+24h。
// 窗口按广告账户的时区算日期；全部用虚构数据。
const WATCH: LaunchWatchConfig = { from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland', campaign_ids: ['123456789012'] }
const NOW = new Date('2026-10-22T20:30:00.000Z') // 新西兰 10-23 09:30（+13:00）

const iso = (ms: number): string => new Date(ms).toISOString()
const hoursBefore = (h: number): string => iso(NOW.getTime() - h * 3_600_000)

function state(over: Partial<PostLaunchReceiptState> = {}): PostLaunchReceiptState {
  return { phase: 'post_t1h', checked_at: hoursBefore(2), launched_at: hoursBefore(2), valid: true, ...over }
}

describe('isWatchActive · 现在在不在盯的窗口里（按账户时区算日期）', () => {
  it('开投日前一天不算；开投日当天算；盯满天数的最后一天算；再后一天不算', () => {
    const at = (utc: string) => isWatchActive(WATCH, new Date(utc))
    expect(at('2026-10-21T10:30:00Z')).toBe(false) // 新西兰 10-21 23:30
    expect(at('2026-10-21T11:30:00Z')).toBe(true) // 新西兰 10-22 00:30（日期已经翻到开投日）
    expect(at('2026-10-25T10:30:00Z')).toBe(true) // 新西兰 10-25 23:30，第 4 天
    expect(at('2026-10-25T11:30:00Z')).toBe(false) // 新西兰 10-26 00:30
  })

  it('盯的天数不到 1 天（0 或负数）或不是有限数字 → 永远不在窗口里，而且不抛错', () => {
    for (const days of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => isWatchActive({ ...WATCH, days }, new Date('2026-10-22T05:00:00Z')), String(days)).not.toThrow()
      expect(isWatchActive({ ...WATCH, days }, new Date('2026-10-22T05:00:00Z')), String(days)).toBe(false)
    }
  })

  it('时区认不出来 → 按 UTC 算，不抛错', () => {
    expect(isWatchActive({ ...WATCH, timezone: 'Not/AZone' }, new Date('2026-10-22T05:00:00Z'))).toBe(true)
  })
})

describe('decideLaunchWatch', () => {
  const decide = (over: Partial<Parameters<typeof decideLaunchWatch>[0]> = {}) =>
    decideLaunchWatch({ watch: WATCH, now: NOW, spendSeen: true, receipts: [], firstSpendSeenAt: null, ...over })

  it('不在窗口里 → 什么都不做', () => {
    expect(decide({ now: new Date('2026-10-30T00:00:00Z') })).toEqual([])
  })

  it('窗口里但还没看到花费（或没读到）→ 什么都不做', () => {
    expect(decide({ spendSeen: false })).toEqual([])
  })

  // 🔴 审查整改：T+1h 要在「第一次看到花费」之后满 1 小时才读，不能在发现花费的当小时就读
  it('有花费、一次读回都没做过，但这是第一次看到花费（之前的盯盘记录里没有）→ 先不读：等满 1 小时再补排 T+1h', () => {
    expect(decide()).toEqual([])
  })

  it('第一次看到花费已经过了 1 小时 → 补排 T+1h，开投时刻记为「第一次看到花费的那个时刻」', () => {
    const seen = hoursBefore(1)
    expect(decide({ firstSpendSeenAt: seen })).toEqual([{ phase: 't1h', launched_at: seen }])
    expect(decide({ firstSpendSeenAt: hoursBefore(5) })).toEqual([{ phase: 't1h', launched_at: hoursBefore(5) }])
  })

  it('每小时的盯盘有几分钟的调度误差：差 55 分钟就算满 1 小时，54 分钟还不算', () => {
    const minutesBefore = (m: number): string => iso(NOW.getTime() - m * 60_000)
    expect(decide({ firstSpendSeenAt: minutesBefore(55) })).toEqual([{ phase: 't1h', launched_at: minutesBefore(55) }])
    expect(decide({ firstSpendSeenAt: minutesBefore(54) })).toEqual([])
  })

  it('第一次看到花费的时间读不懂 → 不发（不去猜）', () => {
    expect(decide({ firstSpendSeenAt: 'garbage' })).toEqual([])
  })

  it('这一小时没看到花费 → 哪怕以前看到过也不发（花费读不到 / 为 0 时不能凭记忆补排）', () => {
    expect(decide({ spendSeen: false, firstSpendSeenAt: hoursBefore(3) })).toEqual([])
  })

  // 🔴 第二轮审查整改：盯盘窗口配得很长（开投日未定），T+1h / T+24h 和 96 小时的盯盘从「第一次看到花费」起算，
  //    不能让一个一直读不到数的读回在整个窗口里每小时重发。
  it('第一次看到花费已经过了 96 小时 → 不再补排任何读回（T+1h 和 T+24h 都是）', () => {
    expect(decide({ firstSpendSeenAt: hoursBefore(97) })).toEqual([])
    const launched = hoursBefore(100)
    expect(decide({ receipts: [state({ launched_at: launched, checked_at: launched })], firstSpendSeenAt: hoursBefore(100) })).toEqual([])
  })

  it('96 小时之内照常补排：第 95 小时还没做过 T+1h → 补；T+1h 做过、T+24h 没做 → 补', () => {
    expect(decide({ firstSpendSeenAt: hoursBefore(95) })).toEqual([{ phase: 't1h', launched_at: hoursBefore(95) }])
    const launched = hoursBefore(95)
    expect(decide({ receipts: [state({ launched_at: launched, checked_at: launched })], firstSpendSeenAt: launched })).toEqual([{ phase: 't24h', launched_at: launched }])
  })

  it('刚好 96 小时还算在盯（超过才停）', () => {
    expect(decide({ firstSpendSeenAt: hoursBefore(96) })).toEqual([{ phase: 't1h', launched_at: hoursBefore(96) }])
  })

  it('第一次看到花费的时间取不到（盯盘记录被挤掉了），但 T+1h 回执里的开投时刻已经超过 96 小时 → 同样不再补排', () => {
    const launched = hoursBefore(97)
    expect(decide({ receipts: [state({ launched_at: launched, checked_at: launched })], firstSpendSeenAt: null })).toEqual([])
  })

  it('T+1h 做过但还没满 24 小时 → 等', () => {
    expect(decide({ receipts: [state({ launched_at: hoursBefore(23.5), checked_at: hoursBefore(23.5) })] })).toEqual([])
  })

  it('T+1h 做过且满 24 小时（刚好 24 小时算满）→ 补排 T+24h，开投时刻沿用 T+1h 那份回执里的', () => {
    const launched = hoursBefore(24)
    expect(decide({ receipts: [state({ launched_at: launched, checked_at: launched })] })).toEqual([
      { phase: 't24h', launched_at: launched },
    ])
  })

  it('T+1h 和 T+24h 都做过 → 不再发', () => {
    const receipts = [
      state({ launched_at: hoursBefore(30), checked_at: hoursBefore(30) }),
      state({ phase: 'post_t24h', launched_at: hoursBefore(30), checked_at: hoursBefore(1) }),
    ]
    expect(decide({ receipts })).toEqual([])
  })

  it('读回做过但没读到数（灰，valid 为 false）→ 不算做过，下一小时接着补', () => {
    const seen = hoursBefore(3)
    expect(decide({ receipts: [state({ valid: false })], firstSpendSeenAt: seen })).toEqual([{ phase: 't1h', launched_at: seen }])
    const launched = hoursBefore(30)
    const t24Gray = [
      state({ launched_at: launched, checked_at: launched }),
      state({ phase: 'post_t24h', valid: false, launched_at: launched, checked_at: hoursBefore(1) }),
    ]
    expect(decide({ receipts: t24Gray })).toEqual([{ phase: 't24h', launched_at: launched }])
  })

  it('人手发的读回（统筹带着真实开投时刻发的）同样算做过，且 T+24h 按那个真实时刻算', () => {
    const real = hoursBefore(26)
    const out = decide({ receipts: [state({ launched_at: real, checked_at: hoursBefore(25) })] })
    expect(out).toEqual([{ phase: 't24h', launched_at: real }])
  })

  it('有好几份有效的 T+1h（人手发的真实开投时刻 + 自动补排的）→ 取最早的开投时刻算 24 小时', () => {
    const manualReal = hoursBefore(26)
    const autoDetected = hoursBefore(24.5)
    const receipts = [
      state({ launched_at: autoDetected, checked_at: autoDetected }),
      state({ launched_at: manualReal, checked_at: manualReal }),
    ]
    expect(decide({ receipts })).toEqual([{ phase: 't24h', launched_at: manualReal }])
  })

  it('T+1h 回执里没有开投时刻 → 退用它的检查时间', () => {
    const checked = hoursBefore(25)
    expect(decide({ receipts: [state({ launched_at: null, checked_at: checked })] })).toEqual([{ phase: 't24h', launched_at: checked }])
  })
})

describe('postLaunchStatesFromRows · 从运行记录里挑出这个客户的开投后读回', () => {
  const gate = (status: TrackingGateReceipt['status']): TrackingGateReceipt => ({
    key: 'post.t1h', status, reason: 'r', how: '', evidence: {}, as_of: null, hard: HARD_GATE['post.t1h'],
  })
  const postReceipt = (clientId: string, phase: 'post_t1h' | 'post_t24h', status: TrackingGateReceipt['status'], checkedAt: string, launchedAt: string | null) =>
    buildClientReceipt({
      requestId: `r-${clientId}-${phase}`, clientId, checkedAt, trigger: 'postlaunch', phase,
      gates: [gate(status)], readErrors: [], links: { fallback: 'https://app.example.test/p' }, launchedAt,
    })
  const row = (receipts: ReturnType<typeof postReceipt>[], startedAt: string, status: string | null = 'completed') => ({
    status, started_at: startedAt,
    summary: buildRunReceipt({ requestId: `run-${startedAt}`, checkedAt: startedAt, trigger: 'postlaunch', clients: receipts }),
  })
  const SINCE = '2026-10-21T00:00:00.000Z'

  it('只挑这个客户的、开投后读回的回执；灰的标 valid=false，非灰的标 valid=true', () => {
    const rows = [
      row([postReceipt('c1', 'post_t1h', 'green', '2026-10-22T09:00:00Z', '2026-10-22T08:30:00Z'), postReceipt('c2', 'post_t1h', 'green', '2026-10-22T09:00:00Z', null)], '2026-10-22T09:00:00Z'),
      row([postReceipt('c1', 'post_t24h', 'gray', '2026-10-23T09:00:00Z', '2026-10-22T08:30:00Z')], '2026-10-23T09:00:00Z'),
    ]
    expect(postLaunchStatesFromRows(rows, 'c1', SINCE)).toEqual([
      { phase: 'post_t1h', checked_at: '2026-10-22T09:00:00Z', launched_at: '2026-10-22T08:30:00Z', valid: true },
      { phase: 'post_t24h', checked_at: '2026-10-23T09:00:00Z', launched_at: '2026-10-22T08:30:00Z', valid: false },
    ])
  })

  it('开投前的回执、还在跑的、读不懂的、窗口开始之前的，都不算', () => {
    const preflight = buildClientReceipt({
      requestId: 'p', clientId: 'c1', checkedAt: '2026-10-22T07:00:00Z', trigger: 'cron', phase: 'preflight',
      gates: [gate('green')], readErrors: [], links: { fallback: 'https://app.example.test/p' },
    })
    const rows = [
      row([preflight], '2026-10-22T07:00:00Z'),
      row([postReceipt('c1', 'post_t1h', 'green', '2026-10-22T09:00:00Z', null)], '2026-10-22T09:00:00Z', 'running'),
      { status: 'completed', started_at: '2026-10-22T10:00:00Z', summary: { nonsense: true } },
      row([postReceipt('c1', 'post_t1h', 'green', '2026-10-01T09:00:00Z', null)], '2026-10-01T09:00:00Z'),
    ]
    expect(postLaunchStatesFromRows(rows, 'c1', SINCE)).toEqual([])
  })
})

describe('firstSpendSeenFromRows · 从盯盘函数自己的运行记录里找「第一次看到花费」的时刻', () => {
  const SINCE = '2026-10-21T00:00:00.000Z'
  const entry = (clientId: string, spendSeen: boolean | null) => ({ client_id: clientId, active: true, spend_seen: spendSeen, sent: [], error: null })
  const row = (checkedAt: string, clients: unknown[], status: string | null = 'completed') => ({
    status, started_at: checkedAt, summary: { checked_at: checkedAt, no_publish: true, clients },
  })

  it('取这个客户最早一次「看到花费」的盯盘时刻（记录是新的在前，也一样取最早）', () => {
    const rows = [
      row('2026-10-22T11:20:00.000Z', [entry('c1', true)]),
      row('2026-10-22T09:20:00.000Z', [entry('c1', true)]),
      row('2026-10-22T08:20:00.000Z', [entry('c1', false)]),
    ]
    expect(firstSpendSeenFromRows(rows, 'c1', SINCE)).toBe('2026-10-22T09:20:00.000Z')
  })

  it('没看到花费（false）/ 没读到（null）/ 别的客户 / 还在跑的 / 读不懂的 / 窗口开始之前的，都不算', () => {
    const rows = [
      row('2026-10-22T08:20:00.000Z', [entry('c1', false)]),
      row('2026-10-22T09:20:00.000Z', [entry('c1', null)]),
      row('2026-10-22T10:20:00.000Z', [entry('c2', true)]),
      row('2026-10-22T11:20:00.000Z', [entry('c1', true)], 'running'),
      { status: 'completed', started_at: '2026-10-22T12:20:00.000Z', summary: { nonsense: true } },
      { status: 'completed', started_at: '2026-10-22T12:30:00.000Z', summary: null },
      row('2026-10-01T09:20:00.000Z', [entry('c1', true)]),
    ]
    expect(firstSpendSeenFromRows(rows, 'c1', SINCE)).toBeNull()
  })

  it('一条记录都没有 → null', () => {
    expect(firstSpendSeenFromRows([], 'c1', SINCE)).toBeNull()
  })

  it('记录里的盯盘时刻读不懂 → 跳过那一条，不抛错', () => {
    const rows = [row('garbage', [entry('c1', true)]), row('2026-10-22T10:20:00.000Z', [entry('c1', true)])]
    expect(firstSpendSeenFromRows(rows, 'c1', SINCE)).toBe('2026-10-22T10:20:00.000Z')
  })
})

describe('seriesWatchStatusFromRows · 盯盘记录里「本次系列找到过没有」', () => {
  const entry = (clientId: string, found: boolean | null, spendSeen: boolean | null = null, active = true) =>
    ({ client_id: clientId, active, spend_seen: spendSeen, series_found: found, sent: [], error: null })
  const row = (checkedAt: string, clients: unknown[], status: string | null = 'completed') => ({
    status, started_at: checkedAt, summary: { checked_at: checkedAt, no_publish: true, clients },
  })

  it('数出这个客户有多少次盯盘、最新一次的时间和结论、期间有没有找到过', () => {
    const rows = [
      row('2026-10-19T19:20:00.000Z', [entry('c1', false)]),
      row('2026-10-19T18:20:00.000Z', [entry('c1', false)]),
      row('2026-10-19T17:20:00.000Z', [entry('c2', true)]),
    ]
    expect(seriesWatchStatusFromRows(rows, 'c1')).toEqual({
      ticks: 2, latest_at: '2026-10-19T19:20:00.000Z', latest_found: false, ever_found: false,
    })
  })

  it('哪怕只有一次 series_found 为 true、或见到过花费（spend_seen 为 true）→ ever_found 为 true', () => {
    const a = seriesWatchStatusFromRows([row('2026-10-19T19:20:00.000Z', [entry('c1', false)]), row('2026-10-19T09:20:00.000Z', [entry('c1', true)])], 'c1')
    expect(a.ever_found).toBe(true)
    expect(a.latest_found).toBe(false)
    const b = seriesWatchStatusFromRows([row('2026-10-19T19:20:00.000Z', [entry('c1', null, true)])], 'c1')
    expect(b.ever_found).toBe(true)
  })

  it('记录的顺序不重要：最新一次按盯盘时刻取', () => {
    const rows = [row('2026-10-19T09:20:00.000Z', [entry('c1', true)]), row('2026-10-19T19:20:00.000Z', [entry('c1', false)])]
    expect(seriesWatchStatusFromRows(rows, 'c1').latest_found).toBe(false)
  })

  // 🔴 第三轮整改：读不出来的盯盘（series_found 和 spend_seen 都是 null）不是「找不到」，不能算进次数，也不能当「最新一次」
  it('读不出来的盯盘不算一次盯盘，也不顶掉「最新一次读得出结果」的结论', () => {
    const rows = [
      row('2026-10-19T20:20:00.000Z', [entry('c1', null)]),
      row('2026-10-19T19:20:00.000Z', [entry('c1', false)]),
      row('2026-10-19T18:20:00.000Z', [entry('c1', null)]),
      row('2026-10-19T17:20:00.000Z', [entry('c1', false)]),
    ]
    expect(seriesWatchStatusFromRows(rows, 'c1')).toEqual({
      ticks: 2, latest_at: '2026-10-19T19:20:00.000Z', latest_found: false, ever_found: false,
    })
  })

  it('全是读不出来的盯盘 → 一次也不算，没有「最新一次」', () => {
    const rows = [row('2026-10-19T19:20:00.000Z', [entry('c1', null)]), row('2026-10-19T18:20:00.000Z', [entry('c1', null)])]
    expect(seriesWatchStatusFromRows(rows, 'c1')).toEqual({ ticks: 0, latest_at: null, latest_found: null, ever_found: false })
  })

  it('只有 spend_seen 为 true、没写 series_found（手工 / 旧记录）→ 算一次读得出结果的盯盘，等于找到了', () => {
    const rows = [row('2026-10-19T19:20:00.000Z', [{ client_id: 'c1', active: true, spend_seen: true, sent: [], error: null }])]
    expect(seriesWatchStatusFromRows(rows, 'c1')).toEqual({
      ticks: 1, latest_at: '2026-10-19T19:20:00.000Z', latest_found: true, ever_found: true,
    })
  })

  it('找到过系列的盯盘（true）和明确找不到的盯盘（false）都算一次；读不出来的（null）不算', () => {
    const rows = [
      row('2026-10-19T19:20:00.000Z', [entry('c1', true)]),
      row('2026-10-19T18:20:00.000Z', [entry('c1', false)]),
      row('2026-10-19T17:20:00.000Z', [entry('c1', null)]),
    ]
    expect(seriesWatchStatusFromRows(rows, 'c1').ticks).toBe(2)
  })

  it('窗口外的盯盘（active 为 false）、还在跑的、读不懂的、没有这个客户的，都不算一次盯盘', () => {
    const rows = [
      row('2026-10-19T19:20:00.000Z', [entry('c1', false, null, false)]),
      row('2026-10-19T18:20:00.000Z', [entry('c1', false)], 'running'),
      { status: 'completed', started_at: '2026-10-19T17:20:00.000Z', summary: { nonsense: true } },
      { status: 'completed', started_at: '2026-10-19T16:20:00.000Z', summary: null },
      row('2026-10-19T15:20:00.000Z', [entry('c2', true)]),
      row('garbage', [entry('c1', true)]),
    ]
    expect(seriesWatchStatusFromRows(rows, 'c1')).toEqual({ ticks: 0, latest_at: null, latest_found: null, ever_found: false })
  })
})

describe('watchEventId · 自动补排发出的事件编号', () => {
  it('同一小时内同一个客户同一阶段编号相同（重复触发会被去重），换小时 / 阶段 / 客户就不同', () => {
    const a = watchEventId('c1', 't1h', new Date('2026-10-22T20:05:00Z'))
    expect(watchEventId('c1', 't1h', new Date('2026-10-22T20:55:00Z'))).toBe(a)
    expect(watchEventId('c1', 't1h', new Date('2026-10-22T21:05:00Z'))).not.toBe(a)
    expect(watchEventId('c1', 't24h', new Date('2026-10-22T20:05:00Z'))).not.toBe(a)
    expect(watchEventId('c2', 't1h', new Date('2026-10-22T20:05:00Z'))).not.toBe(a)
    expect(a).toContain('c1')
    expect(a).toContain('t1h')
    expect(a).toMatch(/^postlaunch-auto-/)
  })
})
