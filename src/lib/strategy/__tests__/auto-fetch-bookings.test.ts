/**
 * `signups_count`（报名/预订数）的取数来源；只计入已审核且符合现有客户/时间/类型/删除条件的记录。
 *
 * 🔴 这个指标一度被接到广告留资上——「33 个报名」的目标会拿留资数去填，数字漂亮但名不符实。
 * 现在读 `me_sale_outcomes` 已审核的 purchase 行（由 CRM 同步流水线写入）。
 * 没有符合条件的已审核记录时必须返回 `unknown`，不能把待审记录计入，也不能把未知说成 0。
 * `approved` 只表示记录已通过对外发送审批，并非银行到账或独立核实成交。
 */

import { describe, it, expect } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

type Client = Parameters<typeof autoFetchMetricValue>[0]

interface FakeDbOpts {
  goal?: { period_start: string; period_end: string } | null
  goalError?: string
  saleOutcomes?: SaleOutcome[]
  countUnavailable?: boolean
  countError?: string
}

interface SaleOutcome {
  id: string
  client_id: string
  outcome_kind: string
  redacted_at: string | null
  review_status: string
  occurred_at: string
}

type SaleFilter = {
  op: 'eq' | 'neq' | 'is' | 'gte' | 'lte'
  column: string
  value: unknown
}

function saleOutcome(id: string, overrides: Partial<SaleOutcome> = {}): SaleOutcome {
  return {
    id,
    client_id: 'client-1',
    outcome_kind: 'purchase',
    redacted_at: null,
    review_status: 'approved',
    occurred_at: '2026-09-15T12:00:00Z',
    ...overrides,
  }
}

/**
 * 手搓的 SupabaseClient 替身。`autoFetchMetricValue` 把 client 当第一个参数收，
 * 所以直接传 stub 即可，不需要 vi.mock 整个 supabase 模块。
 *
 * 要支持两条链，两条都是被 **直接 await** 的：
 *   1. from('goals').select(...).eq(...).eq(...).limit(2) → { data: rows[], error }
 *   2. from('me_sale_outcomes').select(...).eq(...).eq(...).is(...).neq(...).gte(...).lte(...)
 *      → { count, error }
 *
 * 做法：一个可链式调用的对象，select/eq/is/neq/gte/lte/limit 都返回它自己；
 * 它的 then 按**表**返回结果（不按调用次序）；成交表会实际执行查询筛选，
 * 避免 stub 忽略 `.eq()` / `.neq()` 让状态过滤的回归测试假绿。
 */
function matches(row: SaleOutcome, filter: SaleFilter): boolean {
  const actual = row[filter.column as keyof SaleOutcome]
  if (filter.op === 'eq') return actual === filter.value
  if (filter.op === 'neq') return actual !== null && actual !== filter.value
  if (filter.op === 'is') return actual === filter.value
  if (typeof actual !== 'string' || typeof filter.value !== 'string') return false
  return filter.op === 'gte' ? actual >= filter.value : actual <= filter.value
}

function countResult(opts: FakeDbOpts, filters: SaleFilter[]) {
  if (opts.countError) return { count: null, error: { message: opts.countError } }
  if (opts.countUnavailable) return { count: null, error: null }
  const count = (opts.saleOutcomes ?? []).filter(row => filters.every(filter => matches(row, filter))).length
  return { count, error: null }
}

function makeChain(table: string, opts: FakeDbOpts, filters: SaleFilter[]) {
  const goalResult = opts.goalError
    ? { data: null, error: { message: opts.goalError } }
    : { data: opts.goal ? [opts.goal] : [], error: null }
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      if (table === 'me_sale_outcomes') filters.push({ op: 'eq', column, value })
      return chain
    },
    is: (column: string, value: unknown) => {
      if (table === 'me_sale_outcomes') filters.push({ op: 'is', column, value })
      return chain
    },
    neq: (column: string, value: unknown) => {
      if (table === 'me_sale_outcomes') filters.push({ op: 'neq', column, value })
      return chain
    },
    gte: (column: string, value: unknown) => {
      if (table === 'me_sale_outcomes') filters.push({ op: 'gte', column, value })
      return chain
    },
    lte: (column: string, value: unknown) => {
      if (table === 'me_sale_outcomes') filters.push({ op: 'lte', column, value })
      return chain
    },
    limit: () => chain,
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(table === 'goals' ? goalResult : countResult(opts, filters)).then(onFulfilled, onRejected),
  }
  return chain
}

function fakeDb(opts: FakeDbOpts): Client {
  const outcomeFilters: SaleFilter[] = []
  return {
    from: (table: string) => {
      if (table === 'goals' || table === 'me_sale_outcomes') return makeChain(table, opts, outcomeFilters)
      throw new Error(`unexpected table in test stub: ${table}`)
    },
  } as unknown as Client
}

const PERIOD = { period_start: '2026-09-01', period_end: '2026-09-30' }

describe('autoFetchMetricValue — signups_count (报名/预订数)', () => {
  it('只计入同客户/目标期内、未删除且已审核的 purchase；待审、拒绝及无关记录不计', async () => {
    const db = fakeDb({
      goal: PERIOD,
      saleOutcomes: [
        saleOutcome('approved-1'),
        saleOutcome('approved-2'),
        saleOutcome('pending-1', { review_status: 'pending_review' }),
        saleOutcome('pending-2', { review_status: 'pending_review' }),
        saleOutcome('pending-3', { review_status: 'pending_review' }),
        saleOutcome('rejected-1', { review_status: 'rejected' }),
        saleOutcome('unknown-status', { review_status: 'needs_review' }),
        saleOutcome('other-client', { client_id: 'client-2' }),
        saleOutcome('before-period', { occurred_at: '2026-08-31T23:59:59Z' }),
        saleOutcome('after-period', { occurred_at: '2026-10-01T00:00:00Z' }),
        saleOutcome('redacted', { redacted_at: '2026-09-16T00:00:00Z' }),
        saleOutcome('lead', { outcome_kind: 'lead' }),
      ],
    })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result).toMatchObject({
      ok: true,
      value: 2,
      source: 'me_sale_outcomes',
      snapshot_date: PERIOD.period_end,
    })
  })

  it('只有待审或未知审核状态 → unknown，不变成 0 或目标完成', async () => {
    const db = fakeDb({
      goal: PERIOD,
      saleOutcomes: [
        saleOutcome('pending-1', { review_status: 'pending_review' }),
        saleOutcome('unknown-state', { review_status: 'needs_review' }),
      ],
    })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true, noData: true })
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toContain('暂无已审核、可计入的记录')
    expect(result).not.toMatchObject({ ok: true, value: 0 })
  })

  it('没有任何 purchase 记录 → 同样 unknown，不当 0', async () => {
    const db = fakeDb({ goal: PERIOD, saleOutcomes: [] })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true, noData: true })
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toContain('暂无已审核、可计入的记录')

    // 🔴 回归：绝不允许把「没记录」当成 0 报出去。
    expect(result).not.toMatchObject({ ok: true, value: 0 })
  })

  it('count 为 null（PostgREST 没回计数）→ 同样 unknown，不当 0', async () => {
    const db = fakeDb({ goal: PERIOD, countUnavailable: true })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })

    // 🔴 回归：null 计数不是 0。
    expect(result).not.toMatchObject({ ok: true, value: 0 })
  })

  it('没有生效中的目标 → unknown，reason 含 no active goal', async () => {
    const db = fakeDb({ goal: null })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toContain('no active goal')
  })

  it('读 me_sale_outcomes 报错 → unknown，reason 是那条错误消息', async () => {
    const db = fakeDb({ goal: PERIOD, countError: 'permission denied for table me_sale_outcomes' })

    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count')

    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ unknown: true })
    // 查询报错是故障，不能被当成「只是没数据」
    expect(result).not.toHaveProperty('noData')
    if (result.ok) throw new Error('expected failure result')
    expect(result.reason).toBe('permission denied for table me_sale_outcomes')
  })
})
