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
