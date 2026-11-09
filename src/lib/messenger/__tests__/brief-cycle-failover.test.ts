/**
 * 接上切换层之后，「账户级故障当场停下整轮」这条现有保护必须还在。
 *
 * 事故形状（子牙 + 魏征审设计稿时各自独立指出）：`brief-cycle.ts` 原来靠
 * `classifyThrownOpenAIError(err)` 认 OpenAI SDK 的原始异常。三家都失败时抛出来的是聚合错误
 * `AllProvidersFailedError`，没有 `status` → 被判成 `other` → 整轮不再停下，
 * 对最多 500 条候选每条试三家、每条烧满 20 秒，运行记录里那句「已当场停下」再也不出现。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ abortSignal: () => Promise.resolve({
        data: [{ direction: 'inbound', sender_name: 'Kelly', body: 'hi', sent_at: '2026-10-26T00:00:00Z', message_id: 'm1' }],
        error: null,
      }) }) }) }),
    }),
  },
}))

const generateBrief = vi.fn()
const storeBrief = vi.fn()
vi.mock('@/lib/messenger/brief', async () => {
  const actual = await vi.importActual<typeof import('@/lib/messenger/brief')>('@/lib/messenger/brief')
  return { ...actual, generateBrief: (...a: unknown[]) => generateBrief(...a), storeBrief: (...a: unknown[]) => storeBrief(...a) }
})
vi.mock('@/lib/crm/qualified-buyer-autotag', () => ({ autoTagQualifiedBuyers: vi.fn() }))
vi.mock('@/lib/crm/stage-infer', () => ({ inferStagesFromConversations: vi.fn() }))

import { abortReasonFor, generateDueBriefs, type DueBrief } from '../brief-cycle'
import { AllProvidersFailedError } from '@/lib/ai/failover'

const NOW = new Date('2026-10-26T04:00:00Z')

function due(n: number): DueBrief[] {
  return Array.from({ length: n }, (_, i) => ({
    conversationId: `conv-${i}`, clientId: 'client-1', messageCount: 3, lastMessageAt: '2026-10-26T02:00:00Z',
    existingBriefMessageCount: null, regenCount: 0, regenCountDate: null, existingKnowledgeStatus: null,
    awaitingReply: true, channel: 'messenger' as const,
  }))
}

const noCredit = Object.assign(new Error('x'), {
  status: 429,
  error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You have no credits remaining' },
})

beforeEach(() => {
  generateBrief.mockReset()
  storeBrief.mockReset()
  storeBrief.mockResolvedValue(undefined)
})

describe('abortReasonFor', () => {
  it('🔴 三家都是账户级失败 → 要当场停下，原因点名每一家', () => {
    const err = new AllProvidersFailedError({ openai: 'account_exhausted', anthropic: 'account_exhausted' }, 2)
    const reason = abortReasonFor(err)
    expect(reason).not.toBeNull()
    expect(reason).toContain('openai')
    expect(reason).toContain('anthropic')
    expect(reason).toContain('已当场停下')
  })

  it('混合：一家账户级 + 一家超时 → 不当场停下（超时的那家下一条可能就好了）', () => {
    expect(abortReasonFor(new AllProvidersFailedError({ openai: 'account_exhausted', anthropic: 'timeout' }, 2))).toBeNull()
  })

  it('全是限流 / other → 不停', () => {
    expect(abortReasonFor(new AllProvidersFailedError({ openai: 'rate_limited' }, 1))).toBeNull()
    expect(abortReasonFor(new AllProvidersFailedError({ openai: 'other', anthropic: 'schema_invalid' }, 3))).toBeNull()
  })

  it('OpenAI 原始异常的老路径仍然认（没有被新逻辑吃掉）', () => {
    expect(abortReasonFor(noCredit)).toContain('余额')
  })

  it('无关错误 → null', () => {
    expect(abortReasonFor(new Error('boom'))).toBeNull()
    expect(abortReasonFor(undefined)).toBeNull()
  })
})

describe('generateDueBriefs 接上切换层后', () => {
  it('🔴 第一条就是「全家账户级失败」→ 剩下 11 条一条都不许再试，整轮报 aborted', async () => {
    generateBrief.mockRejectedValue(new AllProvidersFailedError({ openai: 'account_exhausted', anthropic: 'account_exhausted' }, 2))
    const r = await generateDueBriefs(due(12), NOW)
    expect(generateBrief).toHaveBeenCalledTimes(1)
    expect(r.aborted).toContain('已当场停下')
    expect(r.generated).toBe(0)
  })

  it('🔴 普通的聚合失败（非账户级）→ 记一笔失败，继续下一条，一个人的坏对话不拖累别人', async () => {
    generateBrief
      .mockRejectedValueOnce(new AllProvidersFailedError({ openai: 'schema_invalid', anthropic: 'schema_invalid' }, 3))
      .mockResolvedValue({ brief: {}, knowledgeStatus: null, answeredBy: { provider: 'openai', model: 'gpt-4o-mini' } })
    const r = await generateDueBriefs(due(3), NOW)
    expect(generateBrief).toHaveBeenCalledTimes(3)
    expect(r.failed).toBe(1)
    expect(r.generated).toBe(2)
    expect(r.aborted).toBeNull()
  })

  it('🔴 谁答的就落谁：answeredBy.model 原样传给 storeBrief（第 6 个参数）', async () => {
    generateBrief.mockResolvedValue({ brief: {}, knowledgeStatus: null, answeredBy: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } })
    await generateDueBriefs(due(1), NOW)
    expect(storeBrief).toHaveBeenCalledTimes(1)
    expect(storeBrief.mock.calls[0][5]).toBe('claude-haiku-4-5-20251001')
  })

  it('🔴 这一条候选的预算要传给切换层（只传 signal 不传数字，它不知道总共有多少时间可以分）', async () => {
    generateBrief.mockResolvedValue({ brief: {}, knowledgeStatus: null, answeredBy: { provider: 'openai', model: 'm' } })
    await generateDueBriefs(due(1), NOW)
    const deps = generateBrief.mock.calls[0][3] as { signal?: AbortSignal; budgetMs?: number }
    expect(deps.signal).toBeInstanceOf(AbortSignal)
    expect(deps.budgetMs).toBeGreaterThan(0)
    expect(deps.budgetMs).toBeLessThanOrEqual(20_000)
  })
})
