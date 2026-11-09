/**
 * H3b — lead 类型 outcome 豁免熔断统计的回归测试。
 *
 * PM 2026-10-05 拍板：lead 不带钱，不该因为线索量涨了就把整条自动处理熔断。
 * 笔数 / 金额 / 批准占比三条统计都要排除 `outcome_kind = 'lead'`，带钱的
 * outcome 仍然受全部刹车约束。
 *
 * 假件照抄 `__tests__/ai-auto-review-circuit-breaker.test.ts`，但额外支持
 * `.neq`（生产代码用 `.neq('outcome_kind', 'lead')` 过滤）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkCircuitBreaker,
  fetchBaselineDailyAverage,
  AI_REVIEWER_IDENTITY,
} from '@/lib/conversions/ai-auto-review-circuit-breaker'

type Row = Record<string, unknown>

let outcomes: Row[]

function fakeDb(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let wantsCount = false
  const rowsOf = (): Row[] => {
    if (table !== 'me_sale_outcomes') return []
    return outcomes.filter((r) =>
      filters.every(([op, col, val]) => {
        if (op === 'eq') return r[col] === val
        if (op === 'neq') return r[col] !== val
        if (op === 'gte') {
          const cell = r[col]
          if (typeof cell === 'string' && typeof val === 'string') return cell >= val
          if (typeof cell === 'number' && typeof val === 'number') return cell >= val
          return false
        }
        return true
      }),
    )
  }
  const builder: Record<string, unknown> = {
    select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count === 'exact') wantsCount = true
      return builder
    },
    eq: (col: string, val: unknown) => {
      filters.push(['eq', col, val])
      return builder
    },
    neq: (col: string, val: unknown) => {
      filters.push(['neq', col, val])
      return builder
    },
    gte: (col: string, val: unknown) => {
      filters.push(['gte', col, val])
      return builder
    },
    then: (resolve: (v: { data: Row[] | null; count: number | null; error: null }) => unknown) =>
      resolve(
        wantsCount
          ? { data: null, count: rowsOf().length, error: null }
          : { data: rowsOf(), count: null, error: null },
      ),
  }
  return builder
}

const fromFn = vi.fn(fakeDb)
const supabaseHolder = { from: fromFn }

beforeEach(() => {
  outcomes = []
  fromFn.mockImplementation(fakeDb)
})

const NOW = new Date('2026-09-15T12:00:00Z')

function approvedRow(
  amountMinor: number | null,
  reviewedAt: string,
  outcomeKind: string,
  reviewedBy = AI_REVIEWER_IDENTITY,
) {
  return {
    client_id: 'c1',
    review_status: 'approved',
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    ai_last_reviewed_at: reviewedAt,
    amount_minor: amountMinor,
    outcome_kind: outcomeKind,
  }
}

// 实测核实：`checkCircuitBreaker()` / `fetchBaselineDailyAverage()` 只调用传入对象的
// `.from(table)`，不碰 `SupabaseClient` 的其它方法——这份假件只需要实现 `.from`。
function callCheck(now: Date) {
  return checkCircuitBreaker(
    supabaseHolder as unknown as Parameters<typeof checkCircuitBreaker>[0],
    'c1',
    now,
  )
}

function callBaseline(now: Date) {
  return fetchBaselineDailyAverage(
    supabaseHolder as unknown as Parameters<typeof fetchBaselineDailyAverage>[0],
    'c1',
    now,
  )
}

describe('checkCircuitBreaker · lead 豁免', () => {
  it('近 24 小时 12 笔 AI 批准的 lead（无更早记录）→ 不触发', async () => {
    for (let i = 0; i < 12; i++) {
      outcomes.push(
        approvedRow(null, new Date(NOW.getTime() - i * 60_000).toISOString(), 'lead'),
      )
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(false)
  })

  it('同样 12 笔但类型是 purchase、历史日均约 1 笔 → 仍然触发 volume_spike', async () => {
    // 历史 7 天：每天 1 笔 purchase，均值 1；近 24 小时 12 笔，远超 3 倍阈值。
    for (let i = 0; i < 6; i++) {
      outcomes.push(
        approvedRow(
          10000,
          new Date(NOW.getTime() - (i + 2) * 86_400_000).toISOString(),
          'purchase',
        ),
      )
    }
    for (let i = 0; i < 12; i++) {
      outcomes.push(
        approvedRow(10000, new Date(NOW.getTime() - i * 60_000).toISOString(), 'purchase'),
      )
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(true)
    if (v.tripped) expect(v.rule).toBe('volume_spike')
  })
})

describe('fetchBaselineDailyAverage · lead 豁免', () => {
  it('忽略 lead 行：一笔 purchase 10000 + 一笔 lead 900000 → maxSingleAmountMinor 10000', async () => {
    const t = new Date(NOW.getTime() - 86_400_000).toISOString()
    outcomes.push(approvedRow(10000, t, 'purchase'))
    outcomes.push(approvedRow(900000, t, 'lead'))
    const base = await callBaseline(NOW)
    expect(base.maxSingleAmountMinor).toBe(10000)
  })
})

describe('checkCircuitBreaker · 批准占比 lead 豁免', () => {
  it('近 24 小时 6 笔 AI 判断的 lead 全部 approved（>90%）→ 不触发', async () => {
    for (let i = 0; i < 6; i++) {
      outcomes.push(
        approvedRow(null, new Date(NOW.getTime() - i * 60_000).toISOString(), 'lead'),
      )
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(false)
  })

  it('同样 6 笔但类型是 purchase 全部 approved → 触发 approval_rate_spike', async () => {
    // 先铺一段"正常"历史基线（7 天，每天 2 笔 purchase，金额 1000），让近 24 小时的
    // 6 笔无论是笔数（6 ≤ 3×2=6）还是金额（6000 ≤ 3×2000=6000）都不会先撞上笔数 /
    // 金额那两条规则——这样才能真正测到"批准占比"这条独立规则。
    for (let day = 2; day <= 8; day++) {
      for (let j = 0; j < 2; j++) {
        outcomes.push(
          approvedRow(
            1000,
            new Date(NOW.getTime() - day * 86_400_000 - j * 60_000).toISOString(),
            'purchase',
          ),
        )
      }
    }
    // 近 24 小时判过 6 条 purchase，全部 approved（100%），超过 90% 上限。
    for (let i = 0; i < 6; i++) {
      outcomes.push(
        approvedRow(1000, new Date(NOW.getTime() - i * 60_000).toISOString(), 'purchase'),
      )
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(true)
    if (v.tripped) expect(v.rule).toBe('approval_rate_spike')
  })
})
