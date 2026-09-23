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
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            abortSignal: () => Promise.resolve({
              data: [{ direction: 'inbound', sender_name: 'Kelly', body: 'hi', sent_at: '2026-09-23T00:00:00Z' }],
              error: null,
            }),
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
    expect(r).toEqual({ generated: 3, failed: 1, aborted: null })
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

    expect(r).toEqual({ generated: 12, failed: 0, aborted: null })
  })
})
