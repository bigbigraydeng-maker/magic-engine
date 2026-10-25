/**
 * 写卡这一段「什么时候必须主动停下来」的行为锁 —— 2026-09-23 事故。
 *
 * 事故形态：OpenAI 余额 9/20 19:11 用光 → 写卡循环逐条 try/catch 所以不中断 →
 * SDK 对 429 重试两次、一条烧 20 秒（生产实测均值 20.1s）→ 一段 12 条约 242 秒 →
 * 网关约 125 秒掐断 → **段永远不返回** → `log-finish` 一次都没跑到 →
 * `cron_run_logs` 那行永远停在 `running`。50 行假的「在跑」，体检报告全绿，停产 3 天。
 *
 * 两条闸，缺一条都还会重演：
 *   1. 账户级故障当场熄火（别把 20 秒乘以剩下的条数）
 *   2. 时间预算兜底（无论慢在哪儿，都得把段交出去）
 *
 * 而「一个人的对话坏了不该拖累这一批剩下的人」这条老行为**必须原样保留** ——
 * 所以第三条测试锁的是「普通错误不许熄火」。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 每条对话都有 1 条消息 —— 让循环不会因为「没消息」跳过。 */
/** 消息查询的返回值 —— 默认一条消息；个别用例改成「查询被中止」。 */
let messagesResult: { data: unknown; error: { message: string } | null } = {
  data: [{ direction: 'inbound', sender_name: 'Kelly', body: 'hi', sent_at: '2026-09-23T00:00:00Z' }],
  error: null,
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            abortSignal: () => Promise.resolve(messagesResult),
          }),
        }),
      }),
    }),
  },
}))

const generateBrief = vi.fn()
const storeBrief = vi.fn()

vi.mock('@/lib/messenger/brief', async () => {
  const actual = await vi.importActual<typeof import('@/lib/messenger/brief')>('@/lib/messenger/brief')
  return {
    ...actual,
    generateBrief: (...a: unknown[]) => generateBrief(...a),
    storeBrief: (...a: unknown[]) => storeBrief(...a),
  }
})

vi.mock('@/lib/crm/qualified-buyer-autotag', () => ({ autoTagQualifiedBuyers: vi.fn() }))
vi.mock('@/lib/crm/stage-infer', () => ({ inferStagesFromConversations: vi.fn() }))

import { generateDueBriefs, type DueBrief } from '../brief-cycle'

const NOW = new Date('2026-09-23T04:00:00Z')

function due(n: number): DueBrief[] {
  return Array.from({ length: n }, (_, i) => ({
    conversationId: `conv-${i}`,
    clientId: 'c0000000-0000-0000-0000-000000000000',
    messageCount: 3,
    lastMessageAt: '2026-09-23T02:00:00Z',
    existingBriefMessageCount: null,
    regenCount: 0,
    regenCountDate: null,
    existingKnowledgeStatus: null,
    awaitingReply: true,
    channel: 'messenger' as const,
  }))
}

/** 生产实测那个 429（2026-09-23 04:38 UTC，req_b9a3b644022849b2a76c76b3d5116e6f）。 */
function noCredits(): Error {
  return Object.assign(new Error('You have no credits remaining. Add credits to continue using the API.'), {
    status: 429,
    code: 'credit_balance_exhausted',
    type: 'insufficient_quota',
  })
}

const OK = { brief: { summary: 's', intent_level: 'low', customer_needs: [], objections: [], promises_made: [], next_action: null, follow_up_due_at: null, risk_flags: [], trip: null, contact: null, draft_reply: 'd' }, knowledgeStatus: null }

beforeEach(() => {
  generateBrief.mockReset()
  storeBrief.mockReset()
  storeBrief.mockResolvedValue(undefined)
  messagesResult = {
    data: [{ direction: 'inbound', sender_name: 'Kelly', body: 'hi', sent_at: '2026-09-23T00:00:00Z' }],
    error: null,
  }
})

describe('generateDueBriefs：余额用光必须当场熄火', () => {
  it('🔴 第一条就撞上「余额用光」→ 剩下 11 条一条都不许再试（不然 20 秒 × 12 撞穿网关）', async () => {
    generateBrief.mockRejectedValue(noCredits())

    const r = await generateDueBriefs(due(12), NOW)

    expect(generateBrief).toHaveBeenCalledTimes(1)
    expect(r.generated).toBe(0)
    expect(r.aborted).toContain('余额')
  })

  it('已经写成的卡照数算 —— 熄火不回滚，也不谎报成 0', async () => {
    generateBrief.mockResolvedValueOnce(OK).mockResolvedValueOnce(OK).mockRejectedValue(noCredits())

    const r = await generateDueBriefs(due(12), NOW)

    expect(r.generated).toBe(2)
    expect(storeBrief).toHaveBeenCalledTimes(2)
    expect(r.aborted).not.toBeNull()
    expect(generateBrief).toHaveBeenCalledTimes(3)
  })

  it('🔴 普通错误不许熄火 —— 一个人的对话坏了，这一批剩下的人今天照样要有卡', async () => {
    generateBrief
      .mockRejectedValueOnce(new Error('brief upsert failed: bad timestamptz'))
      .mockResolvedValue(OK)

    const r = await generateDueBriefs(due(4), NOW)

    expect(generateBrief).toHaveBeenCalledTimes(4)
    expect(r).toEqual({ generated: 3, failed: 1, emptyThreads: 0, aborted: null })
  })
})

describe('generateDueBriefs：时间预算是「段必须返回」的兜底闸', () => {
  it('🔴 预算用完就把剩下的留给下一轮 —— 段返回出去，而不是撞穿网关永远不返回', async () => {
    generateBrief.mockResolvedValue(OK)
    // 假表：每读一次走 40 秒。预算 90 秒 → 写完 2 条后第 3 条开工前就超了。
    let t = 0
    const clock = () => (t += 40_000) - 40_000

    const r = await generateDueBriefs(due(12), NOW, { budgetMs: 90_000, clock })

    expect(r.generated).toBe(2)
    expect(r.aborted).toContain('剩下 10 条')
    expect(generateBrief).toHaveBeenCalledTimes(2)
  })

  it('没超预算的正常一轮，aborted 必须是 null（别把正常跑完报成被掐掉）', async () => {
    generateBrief.mockResolvedValue(OK)

    const r = await generateDueBriefs(due(12), NOW)

    expect(r).toEqual({ generated: 12, failed: 0, emptyThreads: 0, aborted: null })
  })
})

/**
 * Codex 复审 2026-09-23 抓到的两处 —— 都是「超时被记成成功」这同一个毛病换了位置，
 * 也就是本 PR 存在的全部理由。所以各锁一条。
 */
describe('超时绝不许被记成成功', () => {
  it('🔴 消息查询被中止 → 必须抛，不许当成「这条对话没消息」跳过', async () => {
    // PostgREST 被 AbortSignal 掐断时不抛异常，返回 { data: null, error }
    messagesResult = { data: null, error: { message: 'AbortError: signal is aborted without reason' } }
    generateBrief.mockResolvedValue(OK)

    const r = await generateDueBriefs(due(1), NOW)

    // 旧写法会得到 generated 0 / failed 0 / aborted null —— 一次超时记成成功
    expect(r.generated).toBe(0)
    expect(r.failed).toBe(1)
    expect(generateBrief).not.toHaveBeenCalled()
  })

  it('🔴 最后一条候选自己卡住 → 整段必须报 aborted，不许返回 aborted=null', async () => {
    // 卡住一条永不返回的调用：没有外层硬闸，函数会走完循环返回 aborted=null
    generateBrief.mockImplementation(() => new Promise(() => {}))

    const r = await generateDueBriefs(due(1), NOW, { budgetMs: 60, perCandidateMs: 60 })

    expect(r.aborted).not.toBeNull()
    expect(r.aborted).toContain('预算')
    expect(r.generated).toBe(0)
  })

  it('🔴 卡住的那条不许把后面的段也拖上 —— 报了 aborted 就当场收工', async () => {
    generateBrief.mockResolvedValueOnce(OK).mockImplementation(() => new Promise(() => {}))

    const r = await generateDueBriefs(due(5), NOW, { budgetMs: 60, perCandidateMs: 60 })

    expect(r.generated).toBe(1)
    expect(r.aborted).toContain('留给下一轮')
    // 卡住那条之后的候选一条都不该再开工
    expect(generateBrief).toHaveBeenCalledTimes(2)
  })
})

/**
 * Codex 复审 2026-09-23 · P1：队首饿死。
 *
 * `loadDueBriefs` 按 `last_message_at` 倒序排，队首永远是同一条。让它吃满整段预算，
 * 它下一小时又排在最前面再吃一次 —— 其他客户的卡可以永久排不到。
 */
describe('一条坏对话不许饿死其他所有客户', () => {
  it('🔴 队首那条挂住 → 只吃掉它自己那份上限，后面的照样写得出来', async () => {
    // 第一条永不返回，其余正常
    generateBrief.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(OK)

    const r = await generateDueBriefs(due(4), NOW, { budgetMs: 5_000, perCandidateMs: 50 })

    // 关键：队首失败了，但后面 3 条都写成了 —— 队列往前推进了
    expect(r.generated).toBe(3)
    expect(r.failed).toBe(1)
    expect(r.aborted).toBeNull()
  })

  it('单条上限不许 >= 整段预算（配置层面就不能让一条吃满整段）', async () => {
    const { CHUNK_TIME_BUDGET_MS, PER_CANDIDATE_BUDGET_MS } = await import('../brief-cycle')
    expect(PER_CANDIDATE_BUDGET_MS).toBeLessThan(CHUNK_TIME_BUDGET_MS)
    // 留足能往前推进的条数：一段里最坏情况也要还能推进 4 条以上
    expect(CHUNK_TIME_BUDGET_MS / PER_CANDIDATE_BUDGET_MS).toBeGreaterThanOrEqual(4)
  })
})
