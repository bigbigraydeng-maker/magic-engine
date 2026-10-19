import { describe, expect, it } from 'vitest'
import {
  decideLaunchWatch,
  isWatchActive,
  postLaunchStatesFromRows,
  watchEventId,
  type PostLaunchReceiptState,
} from '../launch-watch'
import { buildClientReceipt, buildRunReceipt } from '../receipt'
import { HARD_GATE, type LaunchWatchConfig, type TrackingGateReceipt } from '../types'

// 开投后「自动补排」：每小时看一眼，开投有花费且没做过读回，就自己补排 T+1h / T+24h。
// 窗口按广告账户的时区算日期；全部用虚构数据。
const WATCH: LaunchWatchConfig = { from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland' }
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
    decideLaunchWatch({ watch: WATCH, now: NOW, spendSeen: true, receipts: [], ...over })

  it('不在窗口里 → 什么都不做', () => {
    expect(decide({ now: new Date('2026-10-30T00:00:00Z') })).toEqual([])
  })

  it('窗口里但还没看到花费（或没读到）→ 什么都不做', () => {
    expect(decide({ spendSeen: false })).toEqual([])
  })

  it('有花费、一次开投后读回都没做过 → 补排 T+1h，开投时刻记为「现在发现的时刻」', () => {
    expect(decide()).toEqual([{ phase: 't1h', launched_at: NOW.toISOString() }])
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
    expect(decide({ receipts: [state({ valid: false })] })).toEqual([{ phase: 't1h', launched_at: NOW.toISOString() }])
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
