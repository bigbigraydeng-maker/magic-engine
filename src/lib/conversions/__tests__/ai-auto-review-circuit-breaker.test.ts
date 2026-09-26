/**
 * `checkCircuitBreaker()` / `isSingleRecordAmountAnomalous()` 测试。
 *
 * 钉住魏征复审的两条：① 绝对硬顶要独立于历史均值生效（防"温水煮青蛙"）；
 * ② 批准占比异常要能在总量没涨的情况下单独触发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCircuitBreaker, isSingleRecordAmountAnomalous, AI_REVIEWER_IDENTITY } from '../ai-auto-review-circuit-breaker'

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
    gte: (col: string, val: unknown) => {
      filters.push(['gte', col, val])
      return builder
    },
    then: (resolve: (v: { data: Row[] | null; count: number | null; error: null }) => unknown) =>
      resolve(wantsCount ? { data: null, count: rowsOf().length, error: null } : { data: rowsOf(), count: null, error: null }),
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

function approvedRow(amountMinor: number, reviewedAt: string, reviewedBy = AI_REVIEWER_IDENTITY) {
  return {
    client_id: 'c1',
    review_status: 'approved',
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    ai_last_reviewed_at: reviewedAt,
    amount_minor: amountMinor,
  }
}

// 实测核实：`checkCircuitBreaker()` 只调用传入对象的 `.from(table)`，不碰
// `SupabaseClient` 的其它方法——这份假件只需要实现 `.from`。
function callCheck(now: Date) {
  return checkCircuitBreaker(supabaseHolder as unknown as Parameters<typeof checkCircuitBreaker>[0], 'c1', now)
}

describe('checkCircuitBreaker', () => {
  it('没有历史数据、近期也没有批准记录 → 不触发', async () => {
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(false)
  })

  it('笔数远超历史均值（相对阈值）→ 触发 volume_spike', async () => {
    // 历史 7 天：每天 1 笔，均值 1；近 24 小时：突然 10 笔，远超 3 倍阈值
    for (let i = 0; i < 6; i++) {
      outcomes.push(approvedRow(10000, new Date(NOW.getTime() - (i + 2) * 86_400_000).toISOString()))
    }
    for (let i = 0; i < 10; i++) {
      outcomes.push(approvedRow(10000, new Date(NOW.getTime() - i * 60_000).toISOString()))
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(true)
    if (v.tripped) expect(v.rule).toBe('volume_spike')
  })

  it('即使历史均值本身已经很高，笔数超过绝对硬顶也要触发（防温水煮青蛙）', async () => {
    // 历史 7 天均值故意造得很高（比如每天 20 笔），让"3倍均值"远超硬顶 30——
    // 这种情况下相对阈值形同虚设，必须靠绝对硬顶兜底。
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 20; j++) {
        outcomes.push(approvedRow(1000, new Date(NOW.getTime() - (i + 1) * 86_400_000 - j * 60_000).toISOString()))
      }
    }
    // 近 24 小时 31 笔——低于"3倍历史均值"(60)，但超过绝对硬顶 30
    for (let i = 0; i < 31; i++) {
      outcomes.push(approvedRow(1000, new Date(NOW.getTime() - i * 60_000).toISOString()))
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(true)
    if (v.tripped) expect(v.rule).toBe('volume_spike')
  })

  it('uncertain 堆积超过阈值 → 触发 uncertain_backlog', async () => {
    for (let i = 0; i < 10; i++) {
      outcomes.push({
        client_id: 'c1',
        review_status: 'pending_review',
        ai_review_attempts: 2,
        amount_minor: null,
      })
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(true)
    if (v.tripped) expect(v.rule).toBe('uncertain_backlog')
  })

  it('批准占比异常：总量没涨，但该拒的都放行了 → 触发 approval_rate_spike', async () => {
    // 先铺一段"正常"历史基线（7 天，每天 2 笔，金额 1000），让近 24 小时的 6 笔
    // 无论是笔数（6 ≤ 3×2=6）还是金额（6000 ≤ 3×2000=6000）都不会先撞上笔数/
    // 金额那两条规则——这样才能真正测到"批准占比"这条独立规则，而不是被前面
    // 更早命中的规则挡住。
    for (let day = 2; day <= 8; day++) {
      for (let j = 0; j < 2; j++) {
        outcomes.push(approvedRow(1000, new Date(NOW.getTime() - day * 86_400_000 - j * 60_000).toISOString()))
      }
    }
    // 近 24 小时判过 6 条，全部 approved（100%），超过 90% 上限
    for (let i = 0; i < 6; i++) {
      outcomes.push(approvedRow(1000, new Date(NOW.getTime() - i * 60_000).toISOString()))
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(true)
    if (v.tripped) expect(v.rule).toBe('approval_rate_spike')
  })

  it('判断次数太少（<5）时不因为批准占比 100% 就触发——避免冷启动误报', async () => {
    // 同样先铺基线，避免笔数/金额规则先触发，专门测"总数不够 5 条不判占比"这条。
    for (let day = 2; day <= 8; day++) {
      outcomes.push(approvedRow(1000, new Date(NOW.getTime() - day * 86_400_000).toISOString()))
    }
    for (let i = 0; i < 3; i++) {
      outcomes.push(approvedRow(1000, new Date(NOW.getTime() - i * 60_000).toISOString()))
    }
    const v = await callCheck(NOW)
    expect(v.tripped).toBe(false)
  })
})

describe('isSingleRecordAmountAnomalous', () => {
  it('金额远超历史单笔最大值的倍数 → true', () => {
    expect(isSingleRecordAmountAnomalous(100000, 10000)).toBe(true)
  })

  it('金额在合理范围内 → false', () => {
    expect(isSingleRecordAmountAnomalous(12000, 10000)).toBe(false)
  })

  it('没有历史数据（maxSingleAmountMinor=0）时不误判', () => {
    expect(isSingleRecordAmountAnomalous(999999, 0)).toBe(false)
  })

  it('金额为 null（如 lead 类型）不触发', () => {
    expect(isSingleRecordAmountAnomalous(null, 10000)).toBe(false)
  })
})
