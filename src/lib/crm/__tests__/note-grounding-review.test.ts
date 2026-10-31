/**
 * 魏征复审 PR #3417 的发现，逐条钉住：
 *   P1-1 短而真的笔记不是「没内容」（回电不能丢）
 *   P2-a 意思翻转 / 已完成状态 / 拒绝类说法，摘要必须有原话依据
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: () => ({ responses: { create } }),
}))

import { firstUngroundedClaim, groundNoteParse, noteIsContentFree } from '../note-grounding'
import { parseNote, type NoteParse } from '../note-parser'
import { segmentContact, type ContactLike } from '../segments'

const BASE: NoteParse = {
  outcome: 'spoke',
  do_not_contact: false,
  travel_window: null,
  tour_interest: null,
  competitor: null,
  callback_at: null,
  mentioned_next_step: false,
  summary: '',
}

beforeEach(() => {
  create.mockReset()
  process.env.OPENAI_API_KEY = 'test-key'
})

describe('P1-1：短而真的笔记不是「没内容」', () => {
  it.each([
    '周五回电',
    '明天再打',
    '周五报价',
    '下周再联系',
    '下周一回电',
    '跟他约周三',
    '发了报价',
    '客户说贵',
    '想去新疆',
  ])('「%s」有内容，要送去整理', (n) => {
    expect(noteIsContentFree(n)).toBe(false)
  })

  it.each(['测试数据', 'ok', '.', '测试', 'test', '好', 'a'])('「%s」仍然没内容', (n) => {
    expect(noteIsContentFree(n)).toBe(true)
  })

  it('「周五回电」→ 回电时间保留，且那天排进「约好回电」（callback_due）', async () => {
    const friday = '2026-10-30T20:00:00.000Z' // 新西兰周六早 9 点前的周五晚，仅需落在「今天」之前的合理窗口
    create.mockResolvedValue({
      output_text: JSON.stringify({ ...BASE, callback_at: friday, mentioned_next_step: true, summary: '周五回电。' }),
    })
    const now = new Date('2026-10-28T02:00:00.000Z')
    const r = await parseNote('周五回电', { now })
    expect(create).toHaveBeenCalledTimes(1)
    expect(r.callback_at).toBe(friday)

    // 周五晚过后，这个回电约定把他排成 callback_due。
    const c: ContactLike = {
      id: 'c',
      displayName: 'X',
      doNotContact: false,
      hasPhone: true,
      touchpoints: [
        { channel: 'phone', direction: 'outbound', occurredAt: '2026-10-28T02:00:00.000Z', source: 'me_manual', outcome: 'callback_set', callbackAt: r.callback_at },
      ],
    }
    const seg = segmentContact(c, new Date('2026-10-30T22:00:00.000Z'))
    expect(seg.segment).toBe('callback_due')
    expect(seg.afterCall).not.toBe(true)
  })
})

describe('P2-a：意思翻转的改写一律退回原话', () => {
  const cases: Array<[string, string]> = [
    ['客户不要报价', '客户要求报价。'],
    ['客户可能感兴趣', '客户明确拒绝，不再联系。'],
    ['customer wants to book', '客户已预订并付款。'],
    ['客户没兴趣', '客户感兴趣。'],
    ['no quote needed thanks', '客户要求报价。'],
    ['想订团，还没付钱', '客户已付款。'],
  ]
  it.each(cases)('「%s」→「%s」被拦', (note, summary) => {
    expect(firstUngroundedClaim(summary, note)).not.toBeNull()
    const g = groundNoteParse(note, { ...BASE, summary })
    expect(g.summary).toBe(note)
  })

  it('原话真的写了就放行：已订、已付、拒绝、别再联系', () => {
    expect(firstUngroundedClaim('客户已预订。', '客户已经订了 Silk Road')).toBeNull()
    expect(firstUngroundedClaim('客户已付款。', 'deposit paid today')).toBeNull()
    expect(firstUngroundedClaim('客户拒绝了。', '客户说不去了')).toBeNull()
    expect(firstUngroundedClaim('客户说不再联系。', '他说别再联系了')).toBeNull()
    expect(firstUngroundedClaim('客户要求报价。', '他要报价')).toBeNull()
  })

  it('凭空出现的否定单独拦（不靠别的规则兜底）：原话没有任何否定，摘要却说「不愿意」', () => {
    expect(firstUngroundedClaim('客户不太愿意。', '客户可能感兴趣')).not.toBeNull()
    expect(groundNoteParse('客户可能感兴趣', { ...BASE, summary: '客户不太愿意。' }).summary).toBe('客户可能感兴趣')
  })

  it('已完成状态单独拦：只是「想订团」，摘要不能写「订了团」', () => {
    expect(firstUngroundedClaim('客户订了团。', '想订团')).not.toBeNull()
    expect(groundNoteParse('想订团', { ...BASE, summary: '客户订了团。' }).summary).toBe('想订团')
    // 原话真的说订了就放行
    expect(firstUngroundedClaim('客户订了团。', '他订了团')).toBeNull()
  })

  it('预订和付款是两件事：只说订了，摘要不能多出「付款」', () => {
    expect(firstUngroundedClaim('客户预订并付款。', '想报名 Silk Road')).not.toBeNull()
    expect(firstUngroundedClaim('客户预订。', '想报名 Silk Road')).toBeNull()
  })
})

describe('子牙 P1：出行时间不被「原话里有否定」错杀', () => {
  const g = (note: string, travel: string, summary: string) =>
    groundNoteParse(note, { ...BASE, travel_window: travel, summary })

  it('「他没空，明年3月去」保留「明年3月」', () => {
    expect(g('他没空，明年3月去', '明年3月', '客户明年3月去，现在没空。').travel_window).toBe('明年3月')
  })
  it('「客户说现在不考虑，明年三月再走」保留「明年三月」', () => {
    expect(g('客户说现在不考虑，明年三月再走', '明年三月', '客户现在不考虑，明年三月再走。').travel_window).toBe('明年三月')
  })
  it('「No rush, going March 2027」保留（英文月份对得上「3月」）', () => {
    expect(g('No rush, going March 2027', '2027年3月', '客户不急，2027年3月去。').travel_window).toBe('2027年3月')
  })
  it('出行时间里的数字原话里真没有 → 仍然置空', () => {
    expect(g('他没空，改天再说', '2027年3月', '客户没空。').travel_window).toBeNull()
  })
  it('只对「整句摘要」查否定翻转：不要报价→要求报价 仍被拦', () => {
    const r = g('客户不要报价', '', '客户要求报价。')
    expect(r.summary).toBe('客户不要报价')
  })
})

describe('子牙 (c)：中文数字与地名', () => {
  it('「两个人」→「三人出行」被拦；「两人」放行', () => {
    expect(firstUngroundedClaim('客户三人出行。', '两个人想去')).not.toBeNull()
    expect(firstUngroundedClaim('客户两人出行。', '两个人想去')).toBeNull()
    expect(groundNoteParse('两个人想去', { ...BASE, summary: '客户三人出行。' }).summary).toBe('两个人想去')
  })
  it('「十二天」「二十人」换算正确', () => {
    expect(firstUngroundedClaim('客户想去12天。', '想去十二天')).toBeNull()
    expect(firstUngroundedClaim('客户想去12天。', '想去十三天')).not.toBeNull()
    expect(firstUngroundedClaim('共20人。', '二十个人')).toBeNull()
  })
  it('「一直」「一下」不会被当成数字 1', () => {
    expect(firstUngroundedClaim('客户一直想去。', '想去')).toBeNull()
  })
  it('「想去北京」→「想去上海」被拦；「想去北京」→「客户想去北京」放行', () => {
    expect(firstUngroundedClaim('客户想去上海。', '想去北京')).not.toBeNull()
    expect(firstUngroundedClaim('客户想去北京。', '想去北京')).toBeNull()
  })
  it('英文地名对得上中文：want to visit Shanghai → 想去上海 放行；→ 想去北京 被拦', () => {
    expect(firstUngroundedClaim('客户想去上海。', 'want to visit Shanghai')).toBeNull()
    expect(firstUngroundedClaim('客户想去北京。', 'want to visit Shanghai')).not.toBeNull()
  })
})

describe('Codex 复审 559352e：中文钟点、完成态、否定范围、英文月份', () => {
  const at = '2026-11-02T20:00:00.000Z'

  it.each(['明早十点联系', '下午三点联系', '十一点联系'])(
    '「%s」经 parseNote 保留回电时间，到点后进 callback_due',
    async (note) => {
      create.mockResolvedValue({
        output_text: JSON.stringify({
          ...BASE,
          callback_at: at,
          mentioned_next_step: true,
          summary: note,
        }),
      })
      const r = await parseNote(note, { now: new Date('2026-10-31T02:00:00.000Z') })
      expect(create).toHaveBeenCalled()
      expect(r.callback_at).toBe(at)
      expect(r.mentioned_next_step).toBe(true)

      const c: ContactLike = {
        id: 'c',
        displayName: 'X',
        doNotContact: false,
        hasPhone: true,
        touchpoints: [
          {
            channel: 'phone',
            direction: 'outbound',
            occurredAt: '2026-10-31T02:00:00.000Z',
            source: 'me_manual',
            outcome: 'callback_set',
            callbackAt: r.callback_at,
          },
        ],
      }
      const seg = segmentContact(c, new Date('2026-11-02T22:00:00.000Z'))
      expect(seg.segment).toBe('callback_due')
    },
  )

  it('完成态按动作核对：报价已发不能证明预订、付款或确认', () => {
    const cases: Array<[string, string]> = [
      ['已发报价，客户想预订', '客户已预订。'],
      ['已发报价，客户想付钱', '客户已付款。'],
      ['已发报价，客户想确认', '客户已确认。'],
    ]
    for (const [note, summary] of cases) {
      expect(firstUngroundedClaim(summary, note)).not.toBeNull()
      expect(groundNoteParse(note, { ...BASE, summary }).summary).toBe(note)
    }
    expect(firstUngroundedClaim('客户已预订。', '客户已经订了 Silk Road')).toBeNull()
    expect(firstUngroundedClaim('客户已付款。', '订金付了')).toBeNull()
    expect(firstUngroundedClaim('客户已确认。', '客户确认了行程')).toBeNull()
    expect(firstUngroundedClaim('已发报价，客户想预订。', '已发报价，客户想预订')).toBeNull()
  })

  it('否定必须修饰同一个判断；对不上就退回原话', () => {
    const note = '客户没空，但有兴趣'
    const flipped = '客户有空，但没兴趣'
    expect(firstUngroundedClaim(flipped, note)).not.toBeNull()
    expect(groundNoteParse(note, { ...BASE, summary: flipped }).summary).toBe(note)
    expect(firstUngroundedClaim('客户有兴趣，但现在没空。', note)).toBeNull()
    expect(
      firstUngroundedClaim('Customer is free but not interested.', 'Customer is not free but interested'),
    ).not.toBeNull()
  })

  it('英文月份算作出行时间依据', () => {
    const keep = (note: string, travel: string) =>
      groundNoteParse(note, { ...BASE, travel_window: travel, summary: note }).travel_window
    expect(keep('wants to travel in March', 'March')).toBe('March')
    expect(keep('going in June', 'June')).toBe('June')
    expect(keep('wants to travel someday', 'March')).toBeNull()
  })
})
