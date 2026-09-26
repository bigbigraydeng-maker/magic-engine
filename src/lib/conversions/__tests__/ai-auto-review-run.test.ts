/**
 * `runAiAutoReviewForClient()` 测试。
 *
 * 钉住设计里最重要的几条契约：
 *   · 客户开关关着 → 什么都不做（PM 随时能按的独立停止开关，魏征复审 BLOCKER）
 *   · 熔断命中 → 整批不处理，客户开关被自动关掉 + 写审计
 *   · 明显过期的记录不浪费一次 AI 调用，直接判过期
 *   · approve 之后同一轮内立即调用发送（不拆两步）
 *   · uncertain 只增加尝试次数，不改 review_status，也不会无限重判（子牙复审 BLOCKER）
 *   · 单条金额异常 / 单次批处理硬顶 → 提前熔断停止本轮剩余记录
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ai-auto-review', () => ({
  judgeOutcome: vi.fn(),
}))
vi.mock('../ai-auto-review-circuit-breaker', () => ({
  checkCircuitBreaker: vi.fn(async () => ({ tripped: false })),
  isSingleRecordAmountAnomalous: vi.fn(() => false),
  fetchBaselineDailyAverage: vi.fn(async () => ({ avgCount: 1, avgAmountMinor: 100000, maxSingleAmountMinor: 100000 })),
  AI_REVIEWER_IDENTITY: 'ai-auto-review@system',
}))
vi.mock('../writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({ status: 'confirmed', message: '已发送', writebackId: 'wb-1' })),
}))

import { judgeOutcome } from '../ai-auto-review'
import { checkCircuitBreaker, isSingleRecordAmountAnomalous } from '../ai-auto-review-circuit-breaker'
import { sendApprovedOutcome } from '../writeback-service'
import { runAiAutoReviewForClient, MAX_UNCERTAIN_ATTEMPTS, BATCH_HARD_STOP_COUNT } from '../ai-auto-review-run'
import { DAY_MS } from '../event-window'

type Row = Record<string, unknown>

let clients: Row[]
let outcomes: Row[]
let audits: Row[]

function fakeDb(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let pendingUpdate: Row | null = null
  let wantsAffectedSelect = false
  let limitN: number | null = null

  const src = (): Row[] => (table === 'clients' ? clients : table === 'me_sale_outcomes' ? outcomes : [])

  const rowsOf = (): Row[] =>
    src().filter((r) =>
      filters.every(([op, col, val]) => {
        if (op === 'eq') return r[col] === val
        if (op === 'is') return val === null ? r[col] == null : r[col] === val
        if (op === 'lt') {
          if (typeof r[col] === 'number') return (r[col] as number) < (val as number)
          // 时间列按真实时刻比，不按字符串比（'…00Z' 和 '…00.000Z' 是同一刻）。
          if (typeof r[col] === 'string' && typeof val === 'string') return Date.parse(r[col] as string) < Date.parse(val)
          return false
        }
        return true
      }),
    )

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push(['eq', col, val])
      return builder
    },
    is: (col: string, val: unknown) => {
      filters.push(['is', col, val])
      return builder
    },
    lt: (col: string, val: unknown) => {
      filters.push(['lt', col, val])
      return builder
    },
    // 幂等窗口的 or() 在这份假件里当直通处理（不额外过滤）——这份测试不断言
    // 冷却窗口的精确 SQL 语义，只断言 run.ts 的分支逻辑。
    or: () => builder,
    order: () => builder,
    limit: (n: number) => {
      limitN = n
      return builder
    },
    maybeSingle: async () => ({ data: rowsOf()[0] ?? null, error: null }),
    update: (patch: Row) => {
      pendingUpdate = patch
      wantsAffectedSelect = false
      return builder
    },
    insert: (row: Row) => {
      if (table === 'me_conversion_audit') audits.push(row)
      return Promise.resolve({ data: null, error: null })
    },
    then: (resolve: (v: { data: Row[] | Row | null; error: null }) => unknown) => {
      if (pendingUpdate) {
        const matched = rowsOf()
        for (const r of matched) Object.assign(r, pendingUpdate)
        if (wantsAffectedSelect) return resolve({ data: matched.map((r) => ({ id: r.id })), error: null })
        return resolve({ data: null, error: null })
      }
      let rows = rowsOf()
      if (limitN != null) rows = rows.slice(0, limitN)
      return resolve({ data: rows, error: null })
    },
  }
  // .update(...).eq(...).select('id') 需要在 select 被调用时记下"要返回受影响行"。
  const originalSelect = builder.select as () => typeof builder
  builder.select = () => {
    if (pendingUpdate) wantsAffectedSelect = true
    return originalSelect()
  }
  return builder
}

const fromFn = vi.fn(fakeDb)
const supabaseHolder = { from: fromFn }

function pendingRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'o1',
    client_id: 'c1',
    contact_id: null,
    outcome_kind: 'purchase',
    customer_first: 'Jordan',
    customer_last: null,
    amount_minor: 50000,
    currency: 'NZD',
    source_kind: 'crm_stage_manual',
    occurred_at: '2026-09-14T00:00:00Z',
    review_status: 'pending_review',
    redacted_at: null,
    ai_review_attempts: 0,
    ai_last_reviewed_at: null,
    ...overrides,
  }
}

const NOW = new Date('2026-09-15T00:00:00Z')

beforeEach(() => {
  clients = [{ id: 'c1', ai_auto_review_enabled: true }]
  outcomes = []
  audits = []
  fromFn.mockImplementation(fakeDb)
  vi.mocked(checkCircuitBreaker).mockResolvedValue({ tripped: false })
  vi.mocked(isSingleRecordAmountAnomalous).mockReturnValue(false)
  vi.mocked(judgeOutcome).mockReset()
  vi.mocked(sendApprovedOutcome).mockClear()
})

function run() {
  return runAiAutoReviewForClient('c1', { supabase: supabaseHolder as never, sendDeps: { writer: {} as never, fetcher: fetch }, now: NOW })
}

describe('runAiAutoReviewForClient', () => {
  it('客户开关关着 → 不处理任何记录（独立于熔断的停止开关）', async () => {
    clients = [{ id: 'c1', ai_auto_review_enabled: false }]
    outcomes.push(pendingRow())
    const summary = await run()
    expect(summary).toMatchObject({ ran: false, reason: 'disabled' })
    expect(judgeOutcome).not.toHaveBeenCalled()
  })

  it('熔断命中 → 整批不处理，客户开关被自动关掉并写审计', async () => {
    vi.mocked(checkCircuitBreaker).mockResolvedValue({ tripped: true, rule: 'volume_spike', detail: '笔数异常' })
    outcomes.push(pendingRow())
    const summary = await run()
    expect(summary).toMatchObject({ ran: false, reason: 'circuit_breaker_tripped' })
    expect(judgeOutcome).not.toHaveBeenCalled()
    expect((clients[0] as { ai_auto_review_enabled: boolean }).ai_auto_review_enabled).toBe(false)
    expect(audits.some((a) => a.action === 'circuit_breaker_tripped')).toBe(true)
  })

  it('明显过期的记录（>7天）直接判过期不发送，不调用 AI', async () => {
    outcomes.push(pendingRow({ occurred_at: '2026-08-01T00:00:00Z' }))
    const summary = await run()
    expect(judgeOutcome).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ ran: true, expired: 1 })
    expect((outcomes[0] as { review_status: string }).review_status).toBe('rejected')
  })

  describe('🔴 第 7 天边界：来不及发的一律不问 AI（2026-09-19 CTS 被 uncertain_backlog 熔断的回归测试）', () => {
    const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()
    const approveVerdict = {
      verdict: 'approve' as const,
      reason: '数据完整',
      model: 'm',
      promptVersion: 'v1',
      inputSnapshot: {},
      rawOutput: '{}',
    }

    it.each([
      ['6.99 天（离过期不到 1 小时余量）', 6.99],
      ['正好 7.0 天', 7.0],
      ['7.01 天（旧口径取整成 7、会交给 AI）', 7.01],
      ['7.5 天', 7.5],
    ])('%s → 直接判过期，不调用 AI、不发送', async (_label, days) => {
      outcomes.push(pendingRow({ occurred_at: ago(days) }))
      const summary = await run()
      expect(judgeOutcome).not.toHaveBeenCalled()
      expect(sendApprovedOutcome).not.toHaveBeenCalled()
      expect(summary).toMatchObject({ ran: true, expired: 1, uncertain: 0 })
      expect(outcomes[0]).toMatchObject({ review_status: 'rejected', reviewed_by: 'ai-auto-review@system' })
      expect(audits).toContainEqual(
        expect.objectContaining({ action: 'ai_auto_rejected', detail: expect.objectContaining({ reason: 'expired' }) }),
      )
    })

    it('6.95 天（离过期还有 1 小时 12 分）→ 照常交给 AI 判', async () => {
      outcomes.push(pendingRow({ occurred_at: ago(6.95) }))
      vi.mocked(judgeOutcome).mockResolvedValue(approveVerdict)
      const summary = await run()
      expect(judgeOutcome).toHaveBeenCalledTimes(1)
      expect(summary).toMatchObject({ ran: true, approved: 1, expired: 0 })
    })

    it('🔴 判满 3 次 uncertain、之后过期的行 → 也被清掉（以前永远停在待审核，只能人手批量拒绝）', async () => {
      outcomes.push(pendingRow({ occurred_at: ago(7.2), ai_review_attempts: MAX_UNCERTAIN_ATTEMPTS }))
      const summary = await run()
      expect(judgeOutcome).not.toHaveBeenCalled()
      expect(summary).toMatchObject({ ran: true, expired: 1 })
      expect(outcomes[0]).toMatchObject({ review_status: 'rejected' })
    })

    it('刚判过 uncertain、还在 6 小时冷却里的过期行 → 也被清掉（清理不看冷却）', async () => {
      outcomes.push(
        pendingRow({ occurred_at: ago(7.2), ai_review_attempts: 1, ai_last_reviewed_at: NOW.toISOString() }),
      )
      const summary = await run()
      expect(summary).toMatchObject({ ran: true, expired: 1 })
    })

    it('判满 3 次 uncertain 但还没过期的行 → 不动，等人看', async () => {
      outcomes.push(pendingRow({ occurred_at: ago(3), ai_review_attempts: MAX_UNCERTAIN_ATTEMPTS }))
      const summary = await run()
      expect(summary).toMatchObject({ ran: true, processed: 0 })
      expect(outcomes[0]).toMatchObject({ review_status: 'pending_review' })
    })

    it('已脱敏的过期行、别的客户的过期行、已经处理过的过期行 → 都不动', async () => {
      outcomes.push(
        pendingRow({ id: 'redacted', occurred_at: ago(8), redacted_at: '2026-09-10T00:00:00Z' }),
        pendingRow({ id: 'other-client', client_id: 'c2', occurred_at: ago(8) }),
        pendingRow({ id: 'approved', occurred_at: ago(8), review_status: 'approved' }),
      )
      const summary = await run()
      expect(summary).toMatchObject({ ran: true, processed: 0, expired: 0 })
      expect(outcomes.map((o) => o.review_status)).toEqual(['pending_review', 'pending_review', 'approved'])
    })

    it('清理跟 AI 判断共用单轮上限：上限 2、1 条过期 + 2 条新的 → 清 1 条、判 1 条', async () => {
      outcomes.push(
        pendingRow({ id: 'old', occurred_at: ago(7.5) }),
        pendingRow({ id: 'new1', occurred_at: ago(1) }),
        pendingRow({ id: 'new2', occurred_at: ago(1) }),
      )
      vi.mocked(judgeOutcome).mockResolvedValue(approveVerdict)
      const summary = await runAiAutoReviewForClient(
        'c1',
        { supabase: supabaseHolder as never, sendDeps: { writer: {} as never, fetcher: fetch }, now: NOW },
        { maxBatchSize: 2 },
      )
      expect(summary).toMatchObject({ ran: true, processed: 2, expired: 1, approved: 1 })
      expect(judgeOutcome).toHaveBeenCalledTimes(1)
    })

    it('客户开关关着 → 过期行也不动（开关是 PM 的停止按钮，清理同样受它管）', async () => {
      clients = [{ id: 'c1', ai_auto_review_enabled: false }]
      outcomes.push(pendingRow({ occurred_at: ago(8) }))
      await run()
      expect(outcomes[0]).toMatchObject({ review_status: 'pending_review' })
    })
  })

  it('AI 判 approve → 批准、写审计、同一轮内立即调用发送', async () => {
    outcomes.push(pendingRow())
    vi.mocked(judgeOutcome).mockResolvedValue({
      verdict: 'approve',
      reason: '数据完整',
      model: 'claude-sonnet-4-6',
      promptVersion: 'v1',
      inputSnapshot: {},
      rawOutput: '{}',
    })
    const summary = await run()
    expect(summary).toMatchObject({ ran: true, approved: 1 })
    expect((outcomes[0] as { review_status: string }).review_status).toBe('approved')
    expect((outcomes[0] as { reviewed_by: string }).reviewed_by).toBe('ai-auto-review@system')
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(audits.some((a) => a.action === 'ai_auto_approved')).toBe(true)
    expect(audits.some((a) => a.action === 'sent')).toBe(true)
  })

  it('AI 判 reject → 拒绝，不调用发送', async () => {
    outcomes.push(pendingRow())
    vi.mocked(judgeOutcome).mockResolvedValue({
      verdict: 'reject',
      reason: '数据异常',
      model: 'claude-sonnet-4-6',
      promptVersion: 'v1',
      inputSnapshot: {},
      rawOutput: '{}',
    })
    const summary = await run()
    expect(summary).toMatchObject({ ran: true, rejected: 1 })
    expect((outcomes[0] as { review_status: string }).review_status).toBe('rejected')
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('AI 判 uncertain → 只加尝试次数，review_status 不变，不发送', async () => {
    outcomes.push(pendingRow())
    vi.mocked(judgeOutcome).mockResolvedValue({
      verdict: 'uncertain',
      reason: '拿不准',
      model: 'claude-sonnet-4-6',
      promptVersion: 'v1',
      inputSnapshot: {},
      rawOutput: '{}',
    })
    const summary = await run()
    expect(summary).toMatchObject({ ran: true, uncertain: 1 })
    expect((outcomes[0] as { review_status: string }).review_status).toBe('pending_review')
    expect((outcomes[0] as { ai_review_attempts: number }).ai_review_attempts).toBe(1)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('uncertain 达到上限的记录不会被本轮再次拉取（子牙复审 BLOCKER 回归测试）', async () => {
    outcomes.push(pendingRow({ ai_review_attempts: MAX_UNCERTAIN_ATTEMPTS }))
    const summary = await run()
    expect(judgeOutcome).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ ran: true, processed: 0 })
  })

  it('单条记录金额异常 → 提前熔断，停止本轮剩余记录', async () => {
    outcomes.push(pendingRow({ id: 'o1' }), pendingRow({ id: 'o2' }))
    vi.mocked(isSingleRecordAmountAnomalous).mockReturnValueOnce(true)
    const summary = await run()
    expect(summary).toMatchObject({ ran: true })
    expect(judgeOutcome).not.toHaveBeenCalled()
    expect((clients[0] as { ai_auto_review_enabled: boolean }).ai_auto_review_enabled).toBe(false)
  })

  it('单次批处理内批准笔数达到硬顶 → 提前停止本轮剩余记录，客户开关被熔断关掉（魏征最终复审 MEDIUM 回归测试）', async () => {
    // 铺比硬顶还多的记录，金额都很小（不会触发金额硬顶），专门验证"笔数"这一条硬顶
    // 真的在处理下一条**之前**生效，不是等全部处理完才检查。
    const extra = 5
    for (let i = 0; i < BATCH_HARD_STOP_COUNT + extra; i++) {
      outcomes.push(pendingRow({ id: `o${i}`, amount_minor: 100 }))
    }
    vi.mocked(judgeOutcome).mockResolvedValue({
      verdict: 'approve',
      reason: '数据完整',
      model: 'claude-sonnet-4-6',
      promptVersion: 'v1',
      inputSnapshot: {},
      rawOutput: '{}',
    })
    const summary = await run()
    expect(summary).toMatchObject({ ran: true })
    if (summary.ran) {
      // 硬顶命中后应该提前停手，不会把 25 条全部判完。
      expect(summary.approved).toBeLessThan(BATCH_HARD_STOP_COUNT + extra)
      expect(summary.approved).toBeGreaterThanOrEqual(BATCH_HARD_STOP_COUNT)
    }
    expect((clients[0] as { ai_auto_review_enabled: boolean }).ai_auto_review_enabled).toBe(false)
    expect(audits.some((a) => a.action === 'circuit_breaker_tripped')).toBe(true)
  })

  it('拉取查询条件本身：review_status 已经不是 pending_review 的记录不会被本轮拉到', async () => {
    outcomes.push(pendingRow({ review_status: 'approved' }))
    const summary = await run()
    expect(summary).toMatchObject({ ran: true, processed: 0 })
    expect(judgeOutcome).not.toHaveBeenCalled()
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })

  it('AI 判 approve 期间被人工页面抢先批准（真实竞态）→ CAS 检测到 0 行受影响，不重复发送、不写虚假审计（魏征最终复审回归测试）', async () => {
    outcomes.push(pendingRow())
    vi.mocked(judgeOutcome).mockImplementation(async () => {
      // 模拟"AI 正在判断的同时，人在审核页面上抢先点了确认"——SELECT 时这条
      // 还是 pending_review，AI 判断完准备写回时状态已经被人改掉了。
      ;(outcomes[0] as { review_status: string }).review_status = 'approved'
      return {
        verdict: 'approve',
        reason: '数据完整',
        model: 'claude-sonnet-4-6',
        promptVersion: 'v1',
        inputSnapshot: {},
        rawOutput: '{}',
      }
    })
    const summary = await run()
    expect(summary).toMatchObject({ ran: true, approved: 0 })
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
    expect(audits.some((a) => a.action === 'ai_auto_approved')).toBe(false)
  })

  it('AI 判 reject 期间被人工页面抢先批准（真实竞态）→ CAS 检测到 0 行受影响，不写一条跟事实不符的"AI 已拒绝"审计（魏征最终复审 MEDIUM 回归测试）', async () => {
    outcomes.push(pendingRow())
    vi.mocked(judgeOutcome).mockImplementation(async () => {
      ;(outcomes[0] as { review_status: string }).review_status = 'approved'
      return {
        verdict: 'reject',
        reason: '数据异常',
        model: 'claude-sonnet-4-6',
        promptVersion: 'v1',
        inputSnapshot: {},
        rawOutput: '{}',
      }
    })
    const summary = await run()
    expect(summary).toMatchObject({ ran: true, rejected: 0 })
    // 这条记录实际是"已批准"，不能因为 AI 判断线程晚一步跑到 reject 分支
    // 就被覆盖成 rejected，也不能留下一条声称"AI 已拒绝"的假审计记录。
    expect((outcomes[0] as { review_status: string }).review_status).toBe('approved')
    expect(audits.some((a) => a.action === 'ai_auto_rejected')).toBe(false)
  })
})

describe('分块调用（2026-09-22 conversion-daily-pipeline 拆块）', () => {
  beforeEach(() => vi.mocked(checkCircuitBreaker).mockClear())
  const approve = () =>
    vi.mocked(judgeOutcome).mockResolvedValue({
      verdict: 'approve',
      reason: '数据完整',
      model: 'claude-sonnet-4-6',
      promptVersion: 'v1',
      inputSnapshot: {},
      rawOutput: '{}',
    })
  const runWith = (opts: Parameters<typeof runAiAutoReviewForClient>[2]) =>
    runAiAutoReviewForClient('c1', { supabase: supabaseHolder as never, sendDeps: { writer: {} as never, fetcher: fetch }, now: NOW }, opts)

  it('maxBatchSize 生效：铺 7 条、每块 5 → 一次只处理 5 条', async () => {
    for (let i = 0; i < 7; i++) outcomes.push(pendingRow({ id: `o${i}`, amount_minor: 100 }))
    approve()
    const summary = await runWith({ maxBatchSize: 5 })
    expect(summary).toMatchObject({ ran: true, processed: 5, approved: 5, approvedAmountMinor: 500 })
  })

  it('🔴 非首块（带 carried）跳过开工前的熔断预检——否则前几块刚批的行会被当成「近 24 小时激增」把客户关掉', async () => {
    outcomes.push(pendingRow({ amount_minor: 100 }))
    approve()
    await runWith({ maxBatchSize: 5, carried: { approvedCount: 2, approvedAmountMinor: 200 } })
    expect(checkCircuitBreaker).not.toHaveBeenCalled()
    expect((clients[0] as { ai_auto_review_enabled: boolean }).ai_auto_review_enabled).toBe(true)
  })

  it('首块（不带 carried）照常预检', async () => {
    outcomes.push(pendingRow({ amount_minor: 100 }))
    approve()
    await runWith({ maxBatchSize: 5 })
    expect(checkCircuitBreaker).toHaveBeenCalledTimes(1)
  })

  it('🔴 carried 是「单次运行硬顶」的起点：前几块累计已到硬顶 → 本块第一条之前就熔断，processed=0', async () => {
    outcomes.push(pendingRow({ amount_minor: 100 }))
    approve()
    const summary = await runWith({ maxBatchSize: 5, carried: { approvedCount: BATCH_HARD_STOP_COUNT, approvedAmountMinor: 100 } })
    expect(summary).toMatchObject({ ran: true, processed: 0, approved: 0 })
    expect(judgeOutcome).not.toHaveBeenCalled()
    expect((clients[0] as { ai_auto_review_enabled: boolean }).ai_auto_review_enabled).toBe(false)
    const trip = audits.find((a) => a.action === 'circuit_breaker_tripped')
    expect(JSON.stringify(trip?.detail)).toContain('前几块累计')
  })

  it('carried 差一条到硬顶 → 本块批 1 条后停，跟一块 50 条时的行为一致', async () => {
    for (let i = 0; i < 3; i++) outcomes.push(pendingRow({ id: `o${i}`, amount_minor: 100 }))
    approve()
    const summary = await runWith({ maxBatchSize: 5, carried: { approvedCount: BATCH_HARD_STOP_COUNT - 1, approvedAmountMinor: 0 } })
    expect(summary).toMatchObject({ ran: true, approved: 1 })
    expect((clients[0] as { ai_auto_review_enabled: boolean }).ai_auto_review_enabled).toBe(false)
  })

  it('🔴 发送不透传判断用的 now——状态机要用真实时间写 last_attempt_at，否则「卡在 sending 超过 5 分钟」会被误触发（子牙实施后复审 MAJOR）', async () => {
    outcomes.push(pendingRow())
    approve()
    await runWith({ maxBatchSize: 5 })
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    const sendDeps = vi.mocked(sendApprovedOutcome).mock.calls[0][1]
    expect(sendDeps).not.toHaveProperty('now')
  })

  it('🔴 「AI 刚看过」时间戳写失败要抛——它是分块的冷却依据，写丢了下一块会再判一次', async () => {
    outcomes.push(pendingRow())
    approve()
    fromFn.mockImplementation((table: string) => {
      const b = fakeDb(table)
      if (table === 'me_sale_outcomes') {
        const origUpdate = b.update as (patch: Row) => typeof b
        b.update = (patch: Row) =>
          'ai_last_reviewed_at' in patch
            ? ({ eq: () => Promise.resolve({ data: null, error: { message: '模拟写失败' } }) } as unknown as typeof b)
            : origUpdate(patch)
      }
      return b
    })
    await expect(runWith({ maxBatchSize: 5 })).rejects.toThrow('模拟写失败')
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})
