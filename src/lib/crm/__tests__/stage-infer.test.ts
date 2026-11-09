/**
 * 读往来内容填空着的阶段 —— 取数和落库部分。
 *
 * 这套东西会去动 556 个人的档案，所以三件事必须钉死：
 *   · **只填空的** —— 销售手标过的阶段是最硬的信号，写库那一刻还要再判一次
 *   · **说不出原话就不写** —— 铁律 8，编出来的判断绝不许落到客户档案上
 *   · **留痕** —— 谁填的、为什么、依据哪句话，销售在时间线上看得到
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { inferStagesFromConversations, STAGE_INFER_ACTOR } from '../stage-infer'
import type { StageVerdict } from '../stage-from-conversation'

const NOW = new Date('2026-08-16T00:00:00Z')
const CLIENT = 'client-1'
const CONTACT = 'contact-1'

/** 客人自己说的一句话 —— 模型的证据必须逐字来自它。 */
const CUSTOMER_LINE = 'Could you send me the October itinerary and a price please?'

interface Fake {
  /** 空阶段的候选人。 */
  candidates: { id: string; client_id: string }[]
  /** 这个客户配了哪些阶段。 */
  stages: string[]
  /** 这个人的对话消息。 */
  messages: { direction: 'inbound' | 'outbound'; body: string | null; sent_at: string }[]
  /** UPDATE 命中几行（0 = 有人抢先标过了）。 */
  updated: number
  /** 写审计是否失败。 */
  auditErr?: string
}

let written: {
  stage?: string
  audit?: Record<string, unknown>
  guard?: string
  /** 留痕失败后退回成了什么（null = 退回空阶段）。 */
  revertedTo?: string | null
}

function stubDb(over: Partial<Fake> = {}) {
  const f: Fake = {
    candidates: [{ id: CONTACT, client_id: CLIENT }],
    stages: ['new', 'contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'],
    messages: [
      { direction: 'inbound', body: CUSTOMER_LINE, sent_at: '2026-08-01T00:00:00Z' },
      // 真人隔天回的（不是两分钟内的自动回复）—— 「已联系 / 已报价」要有这个才落。
      { direction: 'outbound', body: 'Hi, happy to help with that.', sent_at: '2026-08-02T00:00:00Z' },
    ],
    updated: 1,
    ...over,
  }
  written = {}

  mocks.from.mockImplementation((table: string) => {
    if (table === 'client_pipeline_stages') {
      // 两个用途共用一张表：先找「配齐了那几档的客户」，再查某客户配了哪些档。
      const rows = f.stages.map((stage_key) => ({ stage_key, client_id: CLIENT }))
      return {
        select: () => ({
          in: async () => ({ data: rows, error: null }),
          eq: async () => ({ data: rows }),
        }),
      }
    }
    if (table === 'contacts') {
      return {
        select: () => ({
          in: () => ({
            is: () => ({
              eq: () => ({
                // 永远从队头取，不轮转 —— 每看一个少一个，队列自己往前走。
                order: () => ({ limit: async () => ({ data: f.candidates, error: null }) }),
              }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              // 记下这道闸真的加在 UPDATE 上了 —— 没有它，取数之后销售手标的
              // 阶段会被这条 UPDATE 直接盖掉。
              is: (col: string, val: unknown) => ({
                select: async () => {
                  written.guard = `${col}=${String(val)}`
                  written.stage = patch.stage as string
                  return { data: f.updated > 0 ? [{ id: CONTACT }] : [], error: null }
                },
              }),
              // 留痕失败后把阶段退回去那一条（多两个 .eq，没有 .is）。
              eq: () => ({
                eq: async () => {
                  written.revertedTo = patch.stage as string | null
                  return { error: null }
                },
              }),
            }),
          }),
        }),
      }
    }
    if (table === 'conversations') {
      return { select: () => ({ eq: () => ({ eq: async () => ({ data: [{ id: 'conv-1' }] }) }) }) }
    }
    if (table === 'conversation_messages') {
      return {
        select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: f.messages }) }) }) }),
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ neq: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }),
          }),
        }),
      }
    }
    // contact_stage_events
    return {
      insert: async (row: Record<string, unknown>) => {
        if (f.auditErr) return { error: { message: f.auditErr } }
        written.audit = row
        return { error: null }
      },
    }
  })
}

/** 假装模型答了什么。 */
let ask: ReturnType<typeof vi.fn>
function answer(v: { stage: string; evidence: string; reason: string } | null) {
  ask = vi.fn().mockResolvedValue(v as StageVerdict | null)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  ask = vi.fn().mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('没配 key 就一步都不走', () => {
  it('绝不假装读出了什么', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    stubDb()
    const r = await inferStagesFromConversations(NOW, ask)
    expect(r).toEqual({
      candidates: 0,
      asked: 0,
      filled: 0,
      byRule: 0,
      toPool: 0,
      rejected: 0,
      failed: 0,
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('填空着的阶段', () => {
  it('证据逐字对得上 → 填上，并留一条审计', async () => {
    stubDb()
    answer({ stage: 'quoted', evidence: CUSTOMER_LINE, reason: '客户主动要行程和价格' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.filled).toBe(1)
    expect(written.stage).toBe('quoted')
    expect(written.audit?.changed_by).toBe(STAGE_INFER_ACTOR)
    expect(written.audit?.from_stage).toBeNull()
    expect(written.audit?.to_stage).toBe('quoted')
    // 留痕要说得出理由和原话 —— 销售不服可以直接改。
    expect(String(written.audit?.note)).toContain('客户主动要行程和价格')
    expect(String(written.audit?.note)).toContain('October itinerary')
  })

  it('🔴 证据是编的 → 模型说的那一档一个字都不写', async () => {
    stubDb()
    answer({ stage: 'quoted', evidence: 'He said he will pay the deposit tomorrow', reason: '编的' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.rejected).toBe(1)
    expect(written.stage).not.toBe('quoted')
  })

  it('🔴 模型想落终结档 → 不接，那个人会从所有名单上消失', async () => {
    stubDb()
    answer({ stage: 'not_interested', evidence: CUSTOMER_LINE, reason: '不该由模型下这种判决' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.rejected).toBe(1)
    expect(written.stage).not.toBe('not_interested')
  })
})

describe('绝不覆盖人工判断', () => {
  it('🔴 取数之后销售抢先标了 → UPDATE 命中 0 行，不算填上，也不留假审计', async () => {
    stubDb({ updated: 0 })
    answer({ stage: 'contacted', evidence: CUSTOMER_LINE, reason: '聊上了' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.filled).toBe(0)
    expect(r.failed).toBe(0)
    expect(written.audit).toBeUndefined()
  })

  it('🔴 那道闸必须加在 UPDATE 本身上，不能只靠取数时筛过一遍', async () => {
    stubDb()
    answer({ stage: 'contacted', evidence: CUSTOMER_LINE, reason: '聊上了' })

    await inferStagesFromConversations(NOW, ask)
    expect(written.guard).toBe('stage=null')
  })
})

describe('不值得花的模型调用一次都不花', () => {
  it('对方一个字都没回过 → 不问模型', async () => {
    stubDb({ messages: [{ direction: 'outbound', body: 'Following up on your enquiry', sent_at: '2026-08-01T00:00:00Z' }] })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.asked).toBe(0)
    expect(ask).not.toHaveBeenCalled()
  })

  it('一个候选人都没有 → 直接结束', async () => {
    stubDb({ candidates: [] })
    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.asked).toBe(0)
    expect(r.filled).toBe(0)
  })
})


/**
 * 🔴 提示词讲的是 CTS 的旅游生意（团 / 行程 / 出行月份）。地产那套漏斗也有
 * `contacted` 和 `no_response`，「配了其中任意一档就跑」会拿旅游漏斗去判一个
 * 看房的人 —— 写进去的是错的客户数据。
 */
describe('只跑配齐了整条旅游漏斗的客户', () => {
  it('少一档（地产那套只有 contacted / no_response）→ 一步都不走', async () => {
    stubDb({ stages: ['contacted', 'no_response'] })
    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.candidates).toBe(0)
    expect(ask).not.toHaveBeenCalled()
  })
})

/**
 * 🔴 少读了一路就不许再判：拼出来的是残缺对话，而落下的阶段是永久的。
 * 最典型的坏法 —— 邮件那一路挂了，只剩两个月前的电话手记，正在邮件里谈价的人
 * 被写成「无下文」。
 */
describe('取数出错时不许硬判', () => {
  it('读对话出错 → 记一笔 failed，不写阶段', async () => {
    stubDb()
    const real = mocks.from.getMockImplementation()!
    mocks.from.mockImplementation((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({ eq: async () => ({ data: null, error: { message: '数据库抽风' } }) }),
          }),
        }
      }
      return real(table)
    })
    answer({ stage: 'quoted', evidence: CUSTOMER_LINE, reason: '不该走到这一步' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.failed).toBe(1)
    expect(r.filled).toBe(0)
    expect(written.stage).toBeUndefined()
  })
})

/**
 * 原先这里只是 `continue` —— 于是「规则自己就能定」的那一档其实从来没人写：
 * 这些人永远停在空阶段、每小时被重捞一遍，还占着候选窗口挡住后面的人。
 */
describe('对方一个字没回过的，规则自己定', () => {
  const outbound = (sent_at: string) => ({
    direction: 'outbound' as const,
    body: 'Following up on your enquiry',
    sent_at,
  })

  it('发出去两周多还没回 → 写「无下文」，不花模型钱', async () => {
    stubDb({ messages: [outbound('2026-07-01T00:00:00Z')] })
    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.filled).toBe(1)
    expect(r.byRule).toBe(1)
    expect(r.asked).toBe(0)
    expect(ask).not.toHaveBeenCalled()
    expect(written.stage).toBe('no_response')
    // 没有原话可引，别在时间线上留一个空引号。
    expect(String(written.audit?.note)).not.toContain('「」')
  })

  it('昨天才发的 → 不写「无下文」，进潜在客户池等他回', async () => {
    stubDb({ messages: [outbound('2026-08-15T00:00:00Z')] })
    const r = await inferStagesFromConversations(NOW, ask)
    expect(written.stage).toBe('new')
    expect(r.byRule).toBe(0)
  })

  it('我们也没发过 → 不写「无下文」，进潜在客户池', async () => {
    stubDb({ messages: [] })
    await inferStagesFromConversations(NOW, ask)
    expect(written.stage).toBe('new')
  })
})


/**
 * 🔴 留痕写不上，这一条就不算数 —— 否则会留下一个**没有任何来历**的自动阶段：
 * 销售看不到理由、看不到原话、也看不出是机器填的，而这个人从此不在候选里、
 * 再也不会被重填。这套东西敢动 556 个人的档案，靠的就是「每一条都说得出为什么」。
 */
describe('留痕写不上就把阶段退回去', () => {
  it('审计失败 → 记一笔 failed，并把刚写的阶段退回空', async () => {
    stubDb({ auditErr: '数据库抽风' })
    answer({ stage: 'quoted', evidence: CUSTOMER_LINE, reason: '客户主动要行程' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(r.failed).toBe(1)
    expect(r.filled).toBe(0)
    expect(written.revertedTo).toBeNull()
  })
})

/**
 * 🔴 填表不是「他回话了」：FB 客资表单在触点表里也是 inbound。把它当成回话，
 * 会让一整批「只填过表、我们追了几次、他一个字没说过」的人每小时都花一次
 * 模型调用，而且永远落不进「无下文」。
 */
describe('只填过表、从没说过话的人', () => {
  it('不问模型，两周后按规则写「无下文」', async () => {
    stubDb({ messages: [] })
    const real = mocks.from.getMockImplementation()!
    mocks.from.mockImplementation((table: string) => {
      if (table === 'contact_touchpoints') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                neq: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [
                        {
                          channel: 'meta_lead_form',
                          direction: 'inbound',
                          occurred_at: '2026-06-01T00:00:00Z',
                          raw: null,
                          summary: 'Facebook 客资表单：Best of China',
                        },
                        {
                          channel: 'email',
                          direction: 'outbound',
                          occurred_at: '2026-07-01T00:00:00Z',
                          raw: 'Following up on your enquiry',
                          summary: null,
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      return real(table)
    })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(ask).not.toHaveBeenCalled()
    expect(written.stage).toBe('no_response')
    expect(r.byRule).toBe(1)
  })
})


/**
 * 🔴 **读不出来就进潜在客户池**（PM 2026-08-16）。
 *
 * 原先读不出来就什么都不写，于是这个人每天被重读一遍、每次都读不出来
 * （对话太薄的人永远读不出来）。为了不重复烧钱我一度打算加一列记「上次
 * 什么时候试过」—— PM 一句话点破：读不出来本来就该进潜在客户池，那才是他
 * 现在真实的位置。写下来他就不在候选里了，那一列和轮转队列都不用做了。
 */
describe('读不出来 → 潜在客户池', () => {
  it('模型说读不出来 → 落「新线索」，不是继续空着', async () => {
    stubDb()
    answer({ stage: 'unclear', evidence: '', reason: '对话太薄' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(written.stage).toBe('new')
    expect(r.toPool).toBe(1)
    expect(r.filled).toBe(1)
    expect(r.failed).toBe(0)
  })

  it('留痕说清是「看过还看不出来」，不是假装读懂了', async () => {
    stubDb()
    answer({ stage: 'unclear', evidence: '', reason: '对话太薄' })

    await inferStagesFromConversations(NOW, ask)
    expect(String(written.audit?.note)).toContain('还看不出他到哪一步')
    expect(written.audit?.to_stage).toBe('new')
  })

  it('客户没配「新线索」这一档 → 不硬塞，继续空着', async () => {
    stubDb({ stages: ['contacted', 'quoted', 'deferred', 'no_response', 'traveling_soon'] })
    answer({ stage: 'unclear', evidence: '', reason: '对话太薄' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(written.stage).toBeUndefined()
    expect(r.toPool).toBe(0)
  })
})

describe('只有客人自己的话（含表单回声）时，不许落「已联系 / 已报价」（2026-11-03）', () => {
  it('模型判已联系，但库里没有真人联系记录 → 不落，进潜在客户池', async () => {
    const echo = 'Hello! I filled out your form and would like to know more about your business.'
    stubDb({
      messages: [
        { direction: 'inbound', body: echo + ' Which tour interests you most?: Golden China', sent_at: '2026-08-01T00:00:00Z' },
        { direction: 'inbound', body: CUSTOMER_LINE, sent_at: '2026-08-01T00:00:10Z' },
        { direction: 'outbound', body: 'Thank you for contacting us.', sent_at: '2026-08-01T00:00:12Z' },
      ],
    })
    answer({ stage: 'contacted', evidence: CUSTOMER_LINE, reason: '客户在聊' })

    const r = await inferStagesFromConversations(NOW, ask)
    expect(written.stage).toBe('new')
    expect(r.toPool).toBe(1)
    expect(r.rejected).toBe(1)
  })
})
