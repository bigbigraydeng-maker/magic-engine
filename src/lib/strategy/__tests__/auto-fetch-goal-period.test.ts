/**
 * 一个客户同时有多个进行中目标时，每个目标都要能按**自己的**时间段刷出当前值。
 *
 * 🔴 回归：2026-09-24 起 CTS 有 2 个 active 目标（signups_count + leads_count），
 *    旧版按「该客户唯一的 active 目标」取时间段（.maybeSingle()），多行直接报错，
 *    两个目标连续两天都刷不出数，而定时任务日志还显示 completed。
 */

import { describe, it, expect } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

type Client = Parameters<typeof autoFetchMetricValue>[0]

interface Period {
  period_start: string
  period_end: string
}

interface AdRow {
  reach: number | null
  video_thruplays: number | null
  actions: Array<{ action_type: string; value: string }> | null
}

interface FakeDbOpts {
  activeGoals: Period[]
  adRows?: AdRow[]
  purchaseCount?: number
}

interface RangeCall {
  table: string
  gte: string
  lte: string
}

/**
 * 按表建模的 SupabaseClient 替身（不按调用次序）：
 *   goals                 → 该客户所有 active 目标（limit 生效）
 *   ga4_traffic_snapshots → 没有快照（让 leads_count 落到广告结果）
 *   ad_daily_insights     → adRows（单页，不足 1000 行）
 *   me_sale_outcomes      → purchaseCount
 * 同时记下每张表 gte/lte 用的时间段，用来断言「用的是哪个目标的时间段」。
 */
function fakeDb(opts: FakeDbOpts): { db: Client; ranges: RangeCall[] } {
  const ranges: RangeCall[] = []

  function makeChain(table: string) {
    let limitN: number | null = null
    const range: RangeCall = { table, gte: '', lte: '' }
    ranges.push(range)

    const result = (): unknown => {
      switch (table) {
        case 'goals': {
          const rows = limitN === null ? opts.activeGoals : opts.activeGoals.slice(0, limitN)
          return { data: rows, error: null }
        }
        case 'ad_daily_insights':
          return { data: opts.adRows ?? [], error: null }
        case 'me_sale_outcomes':
          return { count: opts.purchaseCount ?? null, error: null }
        default:
          throw new Error(`unexpected table in test stub: ${table}`)
      }
    }

    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      neq: () => chain,
      order: () => chain,
      range: () => chain,
      gte: (_col: string, v: string) => { range.gte = v; return chain },
      lte: (_col: string, v: string) => { range.lte = v; return chain },
      limit: (n: number) => { limitN = n; return chain },
      maybeSingle: () => {
        if (table === 'ga4_traffic_snapshots') return Promise.resolve({ data: null, error: null })
        throw new Error(`maybeSingle not expected on ${table}`)
      },
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve().then(result).then(onFulfilled, onRejected),
    }
    return chain
  }

  const db = { from: (table: string) => makeChain(table) } as unknown as Client
  return { db, ranges }
}

// 两个目标故意给不同的时间段，才能证明各自用的是自己那段。
const LEADS_GOAL: Period = { period_start: '2026-09-24', period_end: '2026-11-30' }
const SIGNUPS_GOAL: Period = { period_start: '2026-10-01', period_end: '2026-12-31' }

const leadRow = (n: number): AdRow => ({
  reach: 100,
  video_thruplays: null,
  actions: [{ action_type: 'lead', value: String(n) }],
})

describe('autoFetchMetricValue — 同一客户多个 active 目标', () => {
  it('leads_count 目标：传入自己的时间段 → 按广告留资合计刷出数字，结束日收到今天', async () => {
    const { db, ranges } = fakeDb({
      activeGoals: [LEADS_GOAL, SIGNUPS_GOAL],
      adRows: [leadRow(13), leadRow(10)],
    })
    const now = new Date('2026-10-25T03:00:00Z')

    const result = await autoFetchMetricValue(db, 'client-1', 'leads_count', { goalPeriod: LEADS_GOAL, now })

    expect(result).toMatchObject({ ok: true, value: 23, source: 'auto.meta_leads', snapshot_date: '2026-10-25' })
    const ads = ranges.find((r) => r.table === 'ad_daily_insights')
    expect(ads).toMatchObject({ gte: LEADS_GOAL.period_start, lte: '2026-10-25' })
  })

  it('signups_count 目标：传入自己的时间段 → 按成交记录刷出数字，用的是它自己的时间段', async () => {
    const { db, ranges } = fakeDb({ activeGoals: [LEADS_GOAL, SIGNUPS_GOAL], purchaseCount: 2 })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count', { goalPeriod: SIGNUPS_GOAL })

    expect(result).toMatchObject({ ok: true, value: 2, source: 'me_sale_outcomes', snapshot_date: SIGNUPS_GOAL.period_end })
    const sales = ranges.find((r) => r.table === 'me_sale_outcomes')
    expect(sales).toMatchObject({
      gte: `${SIGNUPS_GOAL.period_start}T00:00:00Z`,
      lte: `${SIGNUPS_GOAL.period_end}T23:59:59Z`,
    })
  })

  it('没传时间段且有 2 个 active 目标 → unknown，说清楚原因（不猜用哪个）', async () => {
    const { db } = fakeDb({ activeGoals: [LEADS_GOAL, SIGNUPS_GOAL], adRows: [leadRow(5)] })

    const result = await autoFetchMetricValue(db, 'client-1', 'messaging_started')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toContain('several active goals')
    // 歧义不是「没数据」，定时任务必须仍把它算成失败
    expect(result).not.toHaveProperty('noData')
  })

  it('没传时间段且只有 1 个 active 目标 → 照旧用它的时间段', async () => {
    const { db, ranges } = fakeDb({ activeGoals: [LEADS_GOAL], adRows: [leadRow(4)] })

    const result = await autoFetchMetricValue(db, 'client-1', 'leads_count')

    expect(result).toMatchObject({ ok: true, value: 4 })
    expect(ranges.find((r) => r.table === 'ad_daily_insights')).toMatchObject({
      gte: LEADS_GOAL.period_start,
      lte: LEADS_GOAL.period_end,
    })
  })
})
