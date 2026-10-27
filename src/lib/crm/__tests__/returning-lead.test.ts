import { describe, it, expect } from 'vitest'
import type { TouchpointLike } from '../segments'
import {
  detectReturningLead,
  engagementLine,
  summariseEngagement,
  returningReason,
  returningStory,
  humanizeFormCode,
  humanizeFormSummary,
} from '../returning-lead'

/** 构造一个 touchpoint，默认字段可被 extra 覆盖。 */
function t(
  channel: string,
  direction: 'inbound' | 'outbound',
  iso: string,
  extra: Partial<TouchpointLike> = {},
): TouchpointLike {
  return { channel, direction, occurredAt: iso, ...extra } as TouchpointLike
}

/** 真实（匿名化）样本。 */
function realShape(): TouchpointLike[] {
  return [
    t('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z'),
    t('phone', 'outbound', '2026-06-15T07:55:00Z', { unansweredCall: true }),
    t('messenger', 'outbound', '2026-06-15T07:55:00Z'),
    t('messenger', 'inbound', '2026-06-15T07:57:00Z'),
    t('email', 'inbound', '2026-10-08T07:51:00Z', { engagement: 'click' }),
    t('email', 'outbound', '2026-10-09T08:47:00Z'),
    t('email', 'outbound', '2026-10-24T01:11:00Z'),
    t('meta_lead_form', 'inbound', '2026-10-26T23:47:00Z'),
  ]
}

describe('detectReturningLead', () => {
  it('识别真实样本：回头客', () => {
    const info = detectReturningLead(realShape())
    expect(info).not.toBeNull()
    // 真人联系：messenger(06-15) + email(10-09) + email(10-24) = 3
    expect(info!.ourContacts).toBe(3)
    expect(info!.earlierForms).toBe(1)
    expect(info!.firstEnquiryAt).toBe('2026-06-15T07:55:00.000Z')
    expect(info!.ourLastContactAt).toBe('2026-10-24T01:11:00.000Z')
    expect(info!.latestFormAt).toBe('2026-10-26T23:47:00.000Z')
  })

  it('首次填表、我们从未联系 → null', () => {
    const touches = [t('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z')]
    expect(detectReturningLead(touches)).toBeNull()
  })

  it('只有机器发出的联系 → null', () => {
    const touches = [
      t('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z'),
      t('email', 'outbound', '2026-06-16T07:55:00Z', { automated: true }),
      t('meta_lead_form', 'inbound', '2026-06-20T07:55:00Z'),
    ]
    expect(detectReturningLead(touches)).toBeNull()
  })

  it('只有没人接的电话 → null', () => {
    const touches = [
      t('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z'),
      t('phone', 'outbound', '2026-06-16T07:55:00Z', { unansweredCall: true }),
      t('meta_lead_form', 'inbound', '2026-06-20T07:55:00Z'),
    ]
    expect(detectReturningLead(touches)).toBeNull()
  })

  it('表在我们最后一次联系之前 → null', () => {
    const touches = [
      t('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z'),
      t('email', 'outbound', '2026-06-16T07:55:00Z'),
      t('meta_lead_form', 'inbound', '2026-06-17T07:55:00Z'),
      t('email', 'outbound', '2026-06-20T07:55:00Z'),
    ]
    expect(detectReturningLead(touches)).toBeNull()
  })

  it('同一天 3 小时内重复提交，中间联系过 → null', () => {
    const touches = [
      t('meta_lead_form', 'inbound', '2026-06-15T07:00:00Z'),
      t('email', 'outbound', '2026-06-15T08:00:00Z'),
      t('meta_lead_form', 'inbound', '2026-06-15T10:00:00Z'),
    ]
    expect(detectReturningLead(touches)).toBeNull()
  })

  it('之前只有邮件 OPEN → null', () => {
    const touches = [
      t('email', 'inbound', '2026-06-15T07:55:00Z', { engagement: 'open' }),
      t('email', 'outbound', '2026-06-16T07:55:00Z'),
      t('meta_lead_form', 'inbound', '2026-06-20T07:55:00Z'),
    ]
    expect(detectReturningLead(touches)).toBeNull()
  })

  it('之前是邮件 CLICK → 非 null', () => {
    const touches = [
      t('email', 'inbound', '2026-06-15T07:55:00Z', { engagement: 'click' }),
      t('email', 'outbound', '2026-06-16T07:55:00Z'),
      t('meta_lead_form', 'inbound', '2026-06-20T07:55:00Z'),
    ]
    expect(detectReturningLead(touches)).not.toBeNull()
  })

  it('非法日期不崩溃，其余仍正确', () => {
    const touches = [
      t('meta_lead_form', 'inbound', 'not-a-date'),
      t('meta_lead_form', 'inbound', '2026-06-15T07:55:00Z'),
      t('email', 'outbound', '2026-06-16T07:55:00Z'),
      t('meta_lead_form', 'inbound', '2026-06-20T07:55:00Z'),
    ]
    const info = detectReturningLead(touches)
    expect(info).not.toBeNull()
    expect(info!.firstEnquiryAt).toBe('2026-06-15T07:55:00.000Z')
  })

  it('同一输入调用两次结果相等', () => {
    const a = detectReturningLead(realShape())
    const b = detectReturningLead(realShape())
    expect(a).toEqual(b)
  })
})

describe('summariseEngagement', () => {
  it('真实样本的统计', () => {
    const o = summariseEngagement(realShape())
    expect(o.ours.email).toBe(2)
    expect(o.ours.phoneUnanswered).toBe(1)
    expect(o.ours.messenger).toBe(1)
    expect(o.theirs.forms).toBe(2)
    expect(o.theirs.clicks).toBe(1)
  })
})

describe('returningReason', () => {
  it('今天填表 + 6月15日首次咨询', () => {
    const info = {
      firstEnquiryAt: '2026-06-15T07:55:00.000Z',
      latestFormAt: '2026-10-26T23:47:00.000Z',
      ourLastContactAt: '2026-10-24T01:11:00.000Z',
      ourContacts: 3,
      earlierForms: 1,
    }
    const now = new Date('2026-10-27T01:00:00Z')
    const reason = returningReason(info, now, 'Pacific/Auckland')
    expect(reason).toBe(
      '回头了：6月15日就咨询过，我们联系过 3 次，今天又填了表，意向很强',
    )
  })

  it('表是奥克兰日历的昨天 → 含「昨天」', () => {
    const info = {
      firstEnquiryAt: '2026-06-15T07:55:00.000Z',
      latestFormAt: '2026-10-25T23:47:00.000Z',
      ourLastContactAt: '2026-10-24T01:11:00.000Z',
      ourContacts: 3,
      earlierForms: 1,
    }
    const now = new Date('2026-10-27T01:00:00Z')
    const reason = returningReason(info, now, 'Pacific/Auckland')
    expect(reason).toContain('昨天')
  })
})

describe('returningStory', () => {
  it('顺序正确，最后一条带 🔥，零计数渠道不出现', () => {
    const info = {
      firstEnquiryAt: '2026-06-15T07:55:00.000Z',
      latestFormAt: '2026-10-26T23:47:00.000Z',
      ourLastContactAt: '2026-10-24T01:11:00.000Z',
      ourContacts: 3,
      earlierForms: 1,
    }
    const overview = summariseEngagement(realShape())
    const now = new Date('2026-10-27T01:00:00Z')
    const story = returningStory(info, overview, now, 'Pacific/Auckland')

    expect(story[0]).toBe('6月15日就咨询过（之前填过 1 次表）')
    expect(story[1]).toBe('我们联系过：邮件 2 封、电话没接 1 次、私信 1 次')
    expect(story[2]).toBe('他点过我们邮件里的链接 1 次')
    expect(story[story.length - 1]).toBe('🔥 今天又填了表')
    // 没有（标记为接通的）电话就不该出现「拨过电话 N 次」
    expect(story.join('|')).not.toContain('拨过电话')
  })
})

describe('humanizeFormCode', () => {
  it('下划线代码 → 人话', () => {
    expect(humanizeFormCode('best_of_china_–_15_days')).toBe('Best of china – 15 days')
    expect(humanizeFormCode('still_deciding_—_show_me_all_4')).toBe('Still deciding — show me all 4')
  })

  it('null / 空白 → null', () => {
    expect(humanizeFormCode(null)).toBeNull()
    expect(humanizeFormCode(undefined)).toBeNull()
    expect(humanizeFormCode('   ')).toBeNull()
  })

  it('已经是人话 → 原样返回', () => {
    expect(humanizeFormCode('Best of China')).toBe('Best of China')
  })
})

describe('humanizeFormSummary', () => {
  it('转换尾巴里的代码', () => {
    expect(humanizeFormSummary('填了 Facebook 表单 · best_of_china_–_15_days')).toBe(
      '填了 Facebook 表单 · Best of china – 15 days',
    )
  })

  it('已经是人话的句子不动', () => {
    expect(humanizeFormSummary('Re: Tour enquiry — Shanghai')).toBe('Re: Tour enquiry — Shanghai')
  })

  it('null → null', () => {
    expect(humanizeFormSummary(null)).toBeNull()
  })
})


describe('summariseEngagement 的计数口径（审查时补的）', () => {
  const real = [
    { channel: 'meta_lead_form', direction: 'inbound', occurredAt: '2026-06-15T07:55:00Z' },
    { channel: 'messenger', direction: 'inbound', occurredAt: '2026-06-15T07:57:00Z' },
    { channel: 'email', direction: 'inbound', occurredAt: '2026-10-08T07:51:00Z', engagement: 'click' },
    { channel: 'email', direction: 'outbound', occurredAt: '2026-10-09T08:47:00Z' },
    { channel: 'email', direction: 'outbound', occurredAt: '2026-10-24T01:11:00Z' },
    { channel: 'phone', direction: 'outbound', occurredAt: '2026-06-15T07:55:00Z', unansweredCall: true },
    { channel: 'meta_lead_form', direction: 'inbound', occurredAt: '2026-10-26T23:47:00Z' },
  ] as never[]

  it('🔴 一次点击只算「点链接」，不能同时被算成「一条消息」', () => {
    const o = summariseEngagement(real)
    expect(o.theirs.clicks).toBe(1)
    expect(o.theirs.messages).toBe(1) // 只有那条私信
  })

  it('lastAt 是他最近一次主动动作（含点链接）', () => {
    expect(summariseEngagement(real).theirs.lastAt).toBe('2026-10-26T23:47:00.000Z')
  })

  it('engagementLine：写清我们联系过什么、他做过什么', () => {
    expect(engagementLine(summariseEngagement(real))).toBe(
      '我们联系过：邮件 2 封、电话没接 1 次 ｜ 他：填过 2 次表、来过 1 次消息、点过邮件链接 1 次',
    )
  })

  it('我们一次都没联系过时明说「还没联系过」，不是留白', () => {
    const only = [{ channel: 'meta_lead_form', direction: 'inbound', occurredAt: '2026-10-26T23:47:00Z' }] as never[]
    expect(engagementLine(summariseEngagement(only))).toBe('我们还没联系过 ｜ 他：填过 1 次表')
  })

  it('什么记录都没有 → null，不凑空话', () => {
    expect(engagementLine(summariseEngagement([]))).toBeNull()
  })
})
