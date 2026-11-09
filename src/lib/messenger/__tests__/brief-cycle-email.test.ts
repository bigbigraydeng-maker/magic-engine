/**
 * 邮件渠道的接线锁。
 *
 * 这条路存在的全部理由：`conversation_messages.body` 只存了 255 字摘要，实测
 * 73% 的客人来信在那里被截断，拿半句话写卡错得看不出来。所以邮件必须去拉全文
 * **再**清洗（全文带着整段引用历史，一封真实来信里客人只写了 78 字、我们自己的
 * 营销文案占了 3890 字）。这份文件钉住三件事：
 *   · 邮件真的去拉全文了，而且喂给模型的是清洗后的字
 *   · 私信**一次都不许**去拉邮件全文
 *   · 清洗完一个字不剩时不写卡，而且这不算失败
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let messagesResult: { data: unknown; error: { message: string } | null } = { data: [], error: null }

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ abortSignal: () => Promise.resolve(messagesResult) }) }),
      }),
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

import { generateDueBriefs, makeEmailFullTextResolver, type DueBrief } from '../brief-cycle'

const NOW = new Date('2026-10-26T04:00:00Z')

function candidate(channel: 'messenger' | 'email'): DueBrief {
  return {
    conversationId: 'conv-1',
    clientId: 'client-1',
    messageCount: 2,
    lastMessageAt: '2026-10-26T02:00:00Z',
    existingBriefMessageCount: null,
    regenCount: 0,
    regenCountDate: null,
    existingKnowledgeStatus: null,
    awaitingReply: true,
    channel,
  }
}

/** 库里那 255 字摘要：被截断，而且尾巴已经咬到引用历史。 */
const STORED = 'Hi\n\nBy when i will get this price as i will pay in November end\n\nThanks\nNilesh\n\nOn Sat, 24 Oct'
/** 全文：客人自己 78 字，后面全是我们自己发的营销邮件。 */
const FULL =
  'Hi\n\nBy when i will get this price as i will pay in November end\n\nThanks\nNilesh\n\n' +
  'On Sat, 24 Oct 2026, 2:11 pm CTS Tours, <info@x.co.nz> wrote:\nOur Shanghai tour departs 25 March 2027 and costs NZD $2,699.'

beforeEach(() => {
  generateBrief.mockReset()
  storeBrief.mockReset()
  generateBrief.mockResolvedValue({ brief: {}, knowledgeStatus: null })
  storeBrief.mockResolvedValue(undefined)
  messagesResult = {
    data: [{ direction: 'inbound', sender_name: 'Nilesh', body: STORED, sent_at: '2026-10-26T02:00:00Z', message_id: 'AAA' }],
    error: null,
  }
})

describe('邮件渠道会去拉全文并清洗', () => {
  it('🔴 喂给模型的是清洗后的全文：客人那句在，我们自己的报价不在', async () => {
    const r = await generateDueBriefs([candidate('email')], NOW, {
      emailFullTextFactory: () => async () => async () => FULL,
    })
    expect(r.generated).toBe(1)
    const fed = (generateBrief.mock.calls[0][0] as Array<{ body: string }>)[0].body
    expect(fed).toContain('By when i will get this price')
    expect(fed).not.toContain('2,699')
    expect(fed).not.toContain('25 March 2027')
    // 也不该把库里那条被咬到引用历史的尾巴带进去
    expect(fed).not.toContain('On Sat, 24 Oct')
  })

  it('🔴 渠道要传给模型，否则卡会说错渠道', async () => {
    await generateDueBriefs([candidate('email')], NOW, { emailFullTextFactory: () => async () => async () => FULL })
    expect((generateBrief.mock.calls[0][2] as { channel?: string }).channel).toBe('email')
  })

  it('🔴 私信一次都不许去拉邮件全文', async () => {
    const getFetcher = vi.fn()
    await generateDueBriefs([candidate('messenger')], NOW, { emailFullTextFactory: () => getFetcher })
    expect(getFetcher).not.toHaveBeenCalled()
    expect((generateBrief.mock.calls[0][2] as { channel?: string }).channel).toBe('messenger')
  })

  it('拿不到邮箱令牌 → 按 255 字摘要走，不算失败（短，但确实是这封信的开头）', async () => {
    const r = await generateDueBriefs([candidate('email')], NOW, { emailFullTextFactory: () => async () => null })
    expect(r.generated).toBe(1)
    expect(r.failed).toBe(0)
    expect((generateBrief.mock.calls[0][0] as Array<{ body: string }>)[0].body).toBe(STORED)
  })

  it('🔴 清洗完一个字不剩 → 不调模型，但要写一张「客人没写内容」的卡（否则这段对话每小时被重选、永远占配额）', async () => {
    messagesResult = {
      data: [{ direction: 'inbound', sender_name: 'S', body: 'Sent from my iPad', sent_at: '2026-10-26T02:00:00Z', message_id: 'AAA' }],
      error: null,
    }
    const onlyQuoted = 'Sent from my iPad\n\nOn 8 Oct 2026, at 3:52 PM, CTS Tours <info@x.co.nz> wrote:\n\nOur tour departs 25 March.'
    const r = await generateDueBriefs([candidate('email')], NOW, { emailFullTextFactory: () => async () => async () => onlyQuoted })
    expect(r.generated).toBe(0)
    expect(r.failed).toBe(0)
    expect(r.emptyThreads).toBe(1)
    // 不许调模型（没有任何可总结的东西，调了就是花钱让它编）
    expect(generateBrief).not.toHaveBeenCalled()
    // 但必须写卡 —— 不写就等于这段对话永远「待写卡」
    expect(storeBrief).toHaveBeenCalledTimes(1)
    const card = storeBrief.mock.calls[0][1] as { summary: string; customer_needs: string[]; draft_reply: string }
    expect(card.summary).toContain('没有自己写的内容')
    expect(card.customer_needs).toEqual([])
    expect(card.draft_reply).toBe('')
  })

  it('🔴 令牌缓存必须是「一轮一份」：新的一轮要重新换令牌，同一轮内同一客户只换一次', async () => {
    // 这是复审查出的 P1。`getValidTokenForConnection` 的契约是「每次调用都给你一个
    // 没过期的」，它自己会在过期前换新。把返回的字符串长期缓存就把这个保证作废了：
    // Render 上进程常驻、令牌约一小时过期，于是第二轮起每次拉全文都失败，
    // 而失败被吞掉、退回 255 字摘要 —— 运行记录里一点异常都没有。
    const resolveOne = vi.fn(async () => async () => FULL)

    const runA = makeEmailFullTextResolver(resolveOne)
    await runA('client-1')
    await runA('client-1')
    await runA('client-2')
    expect(resolveOne).toHaveBeenCalledTimes(2) // 一轮内：每个客户各一次

    const runB = makeEmailFullTextResolver(resolveOne)
    await runB('client-1')
    expect(resolveOne).toHaveBeenCalledTimes(3) // 新的一轮：同一个客户要重新换
  })

  it('🔴 每一轮都必须新造一个解析器 —— 把它提到模块顶层就等于 P1 的 bug 换个写法', async () => {
    // 这条钉的是复审第二轮的 P2：只测工厂自身的缓存语义还不够。实测把
    // `makeEmailFullTextResolver()` 提到模块顶层，另外 7 条测试照样全绿 ——
    // 而那正是「令牌永不过期」那个 bug 的另一种写法。
    const factory = vi.fn(() => async () => async () => FULL)
    await generateDueBriefs([candidate('email')], NOW, { emailFullTextFactory: factory })
    expect(factory).toHaveBeenCalledTimes(1)
    await generateDueBriefs([candidate('email')], NOW, { emailFullTextFactory: factory })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('一轮之内只造一次（一轮 25 段不该造 25 个）', async () => {
    const factory = vi.fn(() => async () => async () => FULL)
    const two = [candidate('email'), { ...candidate('email'), conversationId: 'conv-2' }]
    await generateDueBriefs(two, NOW, { emailFullTextFactory: factory })
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('🔴 缓存 null 也只在一轮内有效（客户之后接上邮箱，下一轮就该认，不该等重启）', async () => {
    const resolveOne = vi.fn(async () => null)
    const runA = makeEmailFullTextResolver(resolveOne)
    expect(await runA('client-1')).toBeNull()
    expect(await runA('client-1')).toBeNull()
    expect(resolveOne).toHaveBeenCalledTimes(1)
    const runB = makeEmailFullTextResolver(resolveOne)
    await runB('client-1')
    expect(resolveOne).toHaveBeenCalledTimes(2)
  })
})
