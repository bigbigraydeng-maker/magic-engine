import { describe, it, expect } from 'vitest'
import {
  MESSENGER_BRIEF_JSON_SCHEMA,
  MessengerBriefSchema,
  MessengerBriefStrictSchema,
  hasHan,
} from '../brief-schema'

const good = {
  summary: '客人想了解上海周边团',
  intent_level: 'medium',
  customer_needs: ['报价'],
  objections: [],
  promises_made: [],
  next_action: '回他确认价格',
  follow_up_due_at: null,
  risk_flags: [],
  trip: { tour_interest: null, travel_window: null, party_size: null, departure_city: null, first_time_to_china: null, budget_signal: null },
  contact: { phone: null, email: null },
  draft_reply: 'Hi Nilesh, thanks for your message.',
}

describe('严格版 schema 与发给模型的 JSON schema 对齐', () => {
  it('🔴 顶层字段：严格版的键 === JSON schema 的必填键 === 宽松版的键（防漂移）', () => {
    const strictKeys = Object.keys(MessengerBriefStrictSchema.shape).sort()
    const required = [...(MESSENGER_BRIEF_JSON_SCHEMA as unknown as { required: string[] }).required].sort()
    const lenientKeys = Object.keys(MessengerBriefSchema.shape).sort()
    expect(strictKeys).toEqual(required)
    expect(strictKeys).toEqual(lenientKeys)
  })

  it('🔴 嵌套字段也对齐：trip 和 contact 的键一致', () => {
    const props = (MESSENGER_BRIEF_JSON_SCHEMA as unknown as {
      properties: { trip: { required: string[] }; contact: { required: string[] } }
    }).properties
    const trip = Object.keys((MessengerBriefStrictSchema.shape.trip as unknown as { shape: object }).shape).sort()
    const contact = Object.keys((MessengerBriefStrictSchema.shape.contact as unknown as { shape: object }).shape).sort()
    expect(trip).toEqual([...props.trip.required].sort())
    expect(contact).toEqual([...props.contact.required].sort())
  })
})

describe('严格版：不再让默认值把缺失的字段悄悄填空', () => {
  it('完整的卡通过', () => {
    expect(MessengerBriefStrictSchema.safeParse(good).success).toBe(true)
  })

  it('🔴 备用模型只答三个字段 → 宽松版放行（这就是要堵的口子），严格版拒绝', () => {
    const three = { summary: '摘要', intent_level: 'low', draft_reply: 'Hi there' }
    expect(MessengerBriefSchema.safeParse(three).success).toBe(true) // 证明口子真的存在
    expect(MessengerBriefStrictSchema.safeParse(three).success).toBe(false)
  })

  it('每个字段单独缺失都应被拒绝', () => {
    for (const key of Object.keys(good)) {
      const copy: Record<string, unknown> = { ...good }
      delete copy[key]
      expect(MessengerBriefStrictSchema.safeParse(copy).success, `缺 ${key}`).toBe(false)
    }
  })

  it('trip / contact 里缺字段也拒绝', () => {
    expect(MessengerBriefStrictSchema.safeParse({ ...good, contact: { phone: null } }).success).toBe(false)
    expect(MessengerBriefStrictSchema.safeParse({ ...good, trip: { tour_interest: null } }).success).toBe(false)
  })
})

describe('语言闸与空壳闸', () => {
  it('🔴 summary 空白 → 拒绝（空壳卡不合法）', () => {
    expect(MessengerBriefStrictSchema.safeParse({ ...good, summary: '   ' }).success).toBe(false)
  })

  it('🔴 next_action 写成英文 → 拒绝（Claude 在真实邮件卡里 3/8 这样）', () => {
    expect(MessengerBriefStrictSchema.safeParse({ ...good, next_action: 'Send Nilesh a quote' }).success).toBe(false)
  })

  it('next_action 为 null 或空串 → 放行（没有下一步是合法的）', () => {
    expect(MessengerBriefStrictSchema.safeParse({ ...good, next_action: null }).success).toBe(true)
    expect(MessengerBriefStrictSchema.safeParse({ ...good, next_action: '' }).success).toBe(true)
  })

  it('🔴 draft_reply 夹汉字 → 拒绝（它会发给新西兰客人）', () => {
    expect(MessengerBriefStrictSchema.safeParse({ ...good, draft_reply: 'Hi，您好 Nilesh' }).success).toBe(false)
  })

  it('🔴 不对 summary 设汉字闸：英文 summary 放行（现有 805 张里有 40 张这样，设了会误杀主力）', () => {
    expect(MessengerBriefStrictSchema.safeParse({ ...good, summary: 'Nilesh asked about price' }).success).toBe(true)
  })

  it('hasHan 反复问同一个输入结果一致（带 g 标志的正则配 .test() 会一次真一次假）', () => {
    expect(hasHan('中文')).toBe(true)
    expect(hasHan('中文')).toBe(true)
    expect(hasHan('english')).toBe(false)
    expect(hasHan('english')).toBe(false)
  })
})
