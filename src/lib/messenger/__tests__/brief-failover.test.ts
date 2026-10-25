/**
 * 简报接上切换层之后的行为锁。
 *
 * 核心要钉的三件事：
 *  1. 谁答的卡就记谁（原来 `storeBrief` 凭环境变量猜，断电时备用模型的卡也会被记成 gpt-4o-mini）；
 *  2. 全家都没钱时，错误要带得出「账户级」判据（否则 brief-cycle 不再当场停下）；
 *  3. 备用模型把「下一步」写成英文时不能当成功写进库。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let clientsRow: { name: string; industry: string | null } | null = { name: 'Acme Travel', industry: 'travel' }
let upserted: Record<string, unknown> | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'conversation_briefs') {
        return {
          upsert: (row: Record<string, unknown>) => {
            upserted = row
            const q = { abortSignal: () => q, then: (res: (v: { error: null }) => unknown) => res({ error: null }) }
            return q
          },
        }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: clientsRow, error: null }) }) }) }
    },
  },
}))

vi.mock('@/lib/knowledge/read', () => ({
  getClientKnowledge: async () => ({ entries: [], status: 'ok' }),
}))

import { generateBrief, storeBrief, type StoredMessage } from '../brief'
import { AllProvidersFailedError } from '@/lib/ai/failover'
import { createFailoverState, type FailoverProvider } from '@/lib/ai/failover-core'

const messages: StoredMessage[] = [
  { direction: 'inbound', senderName: 'Nilesh', body: 'Hi, how much is the Shanghai tour for 2 adults?', sentAt: '2026-10-26T01:00:00Z' },
]

const goodCard = {
  summary: '客人想问上海团两位成人的价格',
  intent_level: 'medium',
  customer_needs: ['报价'],
  objections: [],
  promises_made: [],
  next_action: '回他报价',
  follow_up_due_at: null,
  risk_flags: [],
  trip: { tour_interest: null, travel_window: null, party_size: 2, departure_city: null, first_time_to_china: null, budget_signal: null },
  contact: { phone: null, email: null },
  draft_reply: 'Hi Nilesh, thanks for asking.',
}

const noCredit = Object.assign(new Error('x'), {
  status: 429,
  error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You have no credits remaining' },
})
const mk = (provider: 'openai' | 'anthropic', model: string, call: () => Promise<unknown>): FailoverProvider => ({ provider, model, call })

const env = { ...process.env }
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'o'
  upserted = null
  clientsRow = { name: 'Acme Travel', industry: 'travel' }
})
afterEach(() => {
  process.env = { ...env }
})

describe('generateBrief 走切换层', () => {
  it('健康时由 OpenAI 答，并如实带回是谁答的', async () => {
    const r = await generateBrief(messages, 'c1', undefined, {
      failover: { providers: [mk('openai', 'gpt-4o-mini', async () => goodCard)], state: createFailoverState(), onProviderFailure: () => {} },
    })
    expect(r.answeredBy).toEqual({ provider: 'openai', model: 'gpt-4o-mini' })
    expect(r.brief.summary).toBe(goodCard.summary)
  })

  it('🔴 OpenAI 没钱 → Claude 救回来，answeredBy 如实说是 anthropic（这才是要落库的东西）', async () => {
    const r = await generateBrief(messages, 'c1', undefined, {
      failover: {
        providers: [
          mk('openai', 'gpt-4o-mini', async () => Promise.reject(noCredit)),
          mk('anthropic', 'claude-haiku-4-5-20251001', async () => goodCard),
        ],
        state: createFailoverState(),
        onProviderFailure: () => {},
      },
    })
    expect(r.answeredBy).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
    expect(r.brief.summary).toBe(goodCard.summary)
  })

  it('🔴 全家都没钱 → 抛 AllProvidersFailedError 且 accountLevel 为真（brief-cycle 靠它当场停下整轮）', async () => {
    const billing = Object.assign(new Error('Your credit balance is too low to access the Anthropic API.'), { status: 400 })
    let caught: unknown
    try {
      await generateBrief(messages, 'c1', undefined, {
        failover: {
          providers: [
            mk('openai', 'gpt-4o-mini', async () => Promise.reject(noCredit)),
            mk('anthropic', 'claude', async () => Promise.reject(billing)),
          ],
          state: createFailoverState(),
          onProviderFailure: () => {},
        },
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).accountLevel).toBe(true)
  })

  it('🔴 备用模型把「下一步」写成英文 → 不能当成功写进库', async () => {
    const english = { ...goodCard, next_action: 'Send Nilesh a quote for the Shanghai tour' }
    let caught: unknown
    try {
      await generateBrief(messages, 'c1', undefined, {
        failover: {
          providers: [
            mk('openai', 'gpt-4o-mini', async () => Promise.reject(noCredit)),
            mk('anthropic', 'claude', async () => english),
          ],
          state: createFailoverState(),
          onProviderFailure: () => {},
        },
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).kinds.anthropic).toBe('schema_invalid')
  })

  it('🔴 备用模型只答三个字段 → 不能被默认值悄悄填空后当成功', async () => {
    const three = { summary: '摘要', intent_level: 'low', draft_reply: 'Hi there' }
    await expect(
      generateBrief(messages, 'c1', undefined, {
        failover: {
          providers: [
            mk('openai', 'gpt-4o-mini', async () => Promise.reject(noCredit)),
            mk('anthropic', 'claude', async () => three),
          ],
          state: createFailoverState(),
          onProviderFailure: () => {},
        },
      }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError)
  })

  it('所有启用的家都没钥匙 → 规则兜底卡，answeredBy 是 rule/fallback，且零网络', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.DEEPSEEK_API_KEY
    const r = await generateBrief(messages, 'c1')
    expect(r.answeredBy).toEqual({ provider: 'rule', model: 'fallback' })
  })

  it('🔴 只有 Claude 有钥匙（OpenAI 钥匙被撤）→ 不能直接出兜底卡，要去试 Claude', async () => {
    delete process.env.OPENAI_API_KEY
    process.env.ANTHROPIC_API_KEY = 'a'
    const r = await generateBrief(messages, 'c1', undefined, {
      failover: { providers: [mk('anthropic', 'claude', async () => goodCard)], state: createFailoverState(), onProviderFailure: () => {} },
    })
    expect(r.answeredBy?.provider).toBe('anthropic')
  })

  it('垃圾消息短路：不调模型，answeredBy 是 rule', async () => {
    const spam: StoredMessage[] = [
      { direction: 'inbound', senderName: 'x', body: 'Congratulations your page is eligible for a verification badge, click to activate', sentAt: '2026-10-26T01:00:00Z' },
    ]
    const call = vi.fn(async () => goodCard)
    const r = await generateBrief(spam, 'c1', undefined, {
      failover: { providers: [mk('openai', 'gpt-4o-mini', call)], state: createFailoverState(), onProviderFailure: () => {} },
    })
    expect(call).not.toHaveBeenCalled()
    expect(r.answeredBy?.provider).toBe('rule')
  })
})

describe('storeBrief 落库的 model 是真实答题的模型', () => {
  const candidate = {
    conversationId: 'conv-1', clientId: 'c1', messageCount: 2, lastMessageAt: '2026-10-26T01:00:00Z',
    existingBriefMessageCount: null, regenCount: 0, regenCountDate: null,
  }

  it('🔴 传什么就记什么 —— 不再凭环境变量猜（断电时 OpenAI 钥匙还在，旧写法会把 Claude 的卡记成 gpt-4o-mini）', async () => {
    process.env.OPENAI_API_KEY = 'still-set'
    const gen = await generateBrief(messages, 'c1', undefined, {
      failover: {
        providers: [
          mk('openai', 'gpt-4o-mini', async () => Promise.reject(noCredit)),
          mk('anthropic', 'claude-haiku-4-5-20251001', async () => goodCard),
        ],
        state: createFailoverState(),
        onProviderFailure: () => {},
      },
    })
    await storeBrief(candidate, gen.brief, new Date('2026-10-26T02:00:00Z'), gen.knowledgeStatus, undefined, gen.answeredBy?.model)
    expect(upserted?.model).toBe('claude-haiku-4-5-20251001')
  })

  it('没传 model 时记 unknown，而不是猜一个看着合理的名字', async () => {
    await storeBrief(candidate, { ...goodCard } as never, new Date('2026-10-26T02:00:00Z'))
    expect(upserted?.model).toBe('unknown')
  })
})
