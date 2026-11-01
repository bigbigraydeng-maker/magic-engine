/**
 * 员工笔记不许被 AI 编出事实（2026-10-30）。
 *
 * 事故：员工记「测试数据」，存进档案的摘要是「客户下周一要求报价。」；
 * 另一条「大瑞测试，可能感兴趣 14 days China unveiled」被改写成
 * 「客户可能对中国之旅有兴趣。」，团名和天数丢了。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: () => ({ responses: { create } }),
}))

import { firstUngroundedClaim, groundNoteParse, noteIsContentFree } from '../note-grounding'
import { parseNote, type NoteParse } from '../note-parser'

const INVENTED: NoteParse = {
  outcome: 'spoke',
  do_not_contact: false,
  travel_window: '下周一',
  tour_interest: 'Best of China',
  competitor: 'Inspiring Vacations',
  callback_at: '2026-11-02T20:00:00.000Z',
  mentioned_next_step: true,
  summary: '客户下周一要求报价。',
}

function aiReturns(p: Partial<NoteParse>) {
  create.mockResolvedValue({ output_text: JSON.stringify({ ...INVENTED, ...p }) })
}

beforeEach(() => {
  create.mockReset()
  process.env.OPENAI_API_KEY = 'test-key'
})

describe('noteIsContentFree', () => {
  it.each(['测试数据', 'ok', '.', '  ', 'test', 'OK.', '无', '...'])('「%s」没有内容', (n) => {
    expect(noteIsContentFree(n)).toBe(true)
  })
  it.each([
    '客户下周一要求报价',
    '大瑞测试，可能感兴趣 14 days China unveiled',
    'voice message 9 July',
    'very interested but not plan to go until end of next year',
  ])('「%s」有内容', (n) => {
    expect(noteIsContentFree(n)).toBe(false)
  })
})

describe('parseNote：没内容的笔记不送 AI、不编摘要', () => {
  it.each(['测试数据', 'ok', '.'])('「%s」→ 摘要就是原话，没有任何字段被编出来', async (n) => {
    aiReturns({}) // 即使模型会编，也不应被调用
    const r = await parseNote(n)
    expect(create).not.toHaveBeenCalled()
    expect(r.summary).toBe(n.trim())
    expect(r.callback_at).toBeNull()
    expect(r.travel_window).toBeNull()
    expect(r.tour_interest).toBeNull()
    expect(r.competitor).toBeNull()
    expect(r.do_not_contact).toBe(false)
  })

  it('没内容的笔记不记成「真的聊上了」：outcome = unknown（不是兜底的 spoke）', async () => {
    expect((await parseNote('测试数据')).outcome).toBe('unknown')
    expect((await parseNote('ok')).outcome).toBe('unknown')
  })

  it('规则明确命中的短笔记不被改成 unknown（别再联系照样拦）', async () => {
    const r = await parseNote('别再联系')
    expect(r.outcome).toBe('do_not_contact')
    expect(r.do_not_contact).toBe(true)
  })
})

describe('parseNote：模型编出笔记里没有的事实 → 被后验拦下', () => {
  it('有内容但模型编了「下周一要求报价 / 回电 / 竞品」→ 摘要退回原话、字段置空', async () => {
    aiReturns({})
    const r = await parseNote('客户对中国之旅有点兴趣，先放着')
    expect(r.summary).toBe('客户对中国之旅有点兴趣，先放着')
    expect(r.callback_at).toBeNull()
    expect(r.competitor).toBeNull()
    expect(r.tour_interest).toBeNull()
    expect(r.travel_window).toBeNull()
  })

  it('笔记真的写了要报价、周五再联系 → 照常整理，回电保留', async () => {
    aiReturns({
      summary: '客户要求报价，周五再联系。',
      travel_window: null,
      tour_interest: null,
      competitor: null,
      callback_at: '2026-11-06T20:00:00.000Z',
    })
    const note = '客户要求报价，周五再联系他'
    const r = await parseNote(note)
    expect(r.summary).toBe('客户要求报价，周五再联系。')
    expect(r.callback_at).not.toBeNull()
  })

  it('英文笔记 asked for a quote → 「报价」有依据，保留 AI 摘要', async () => {
    aiReturns({
      summary: '客户询问报价。',
      travel_window: null,
      tour_interest: null,
      competitor: null,
      callback_at: null,
      mentioned_next_step: false,
    })
    const r = await parseNote('customer asked for a quote on silk road')
    expect(r.summary.startsWith('客户询问报价')).toBe(true)
  })
})

describe('Nathan：摘要不许丢笔记里的具体词', () => {
  it('「14 days」「China unveiled」补在摘要后面', async () => {
    aiReturns({
      summary: '客户可能对中国之旅有兴趣。',
      travel_window: null,
      tour_interest: 'China unveiled',
      competitor: null,
      callback_at: null,
      mentioned_next_step: false,
    })
    const r = await parseNote('大瑞测试，可能感兴趣 14 days China unveiled')
    expect(r.summary).toContain('客户可能对中国之旅有兴趣')
    expect(r.summary).toContain('14 days')
    expect(r.summary).toContain('China unveiled')
    expect(r.tour_interest).toBe('China unveiled')
  })
})

describe('firstUngroundedClaim / groundNoteParse 单点', () => {
  it('数字、英文专名、日期词、动作词没依据 → 报出来', () => {
    expect(firstUngroundedClaim('客户 3 人出行', '客户想去')).toBe('3')
    expect(firstUngroundedClaim('提到 Flight Centre', 'voice message')).toBe('Flight')
    expect(firstUngroundedClaim('客户下周一回电', 'ok thanks')).not.toBeNull()
    expect(firstUngroundedClaim('客户要求报价', '聊了聊')).not.toBeNull()
  })
  it('有依据 → null', () => {
    expect(firstUngroundedClaim('客户要求报价', '他要报价')).toBeNull()
    expect(firstUngroundedClaim('周五给报价', 'quote on Friday')).toBeNull()
  })
  it('出行时间没有时间性依据 → 置空', () => {
    const g = groundNoteParse('客户人很好', { ...INVENTED, callback_at: null, summary: '客户人很好' })
    expect(g.travel_window).toBeNull()
  })
  it('原话没有任何时间说法 → callback_at 与 mentioned_next_step 一并拿掉', () => {
    const g = groundNoteParse('客户对价格敏感', { ...INVENTED, summary: '客户对价格敏感' })
    expect(g.callback_at).toBeNull()
    expect(g.mentioned_next_step).toBe(false)
  })
})
