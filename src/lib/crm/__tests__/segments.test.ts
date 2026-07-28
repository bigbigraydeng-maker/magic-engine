/**
 * 分段规则。
 *
 * 这份规则决定销售今天打给谁，所以顺序就是产品本身：一个说过「别再联系」
 * 的人，无论后面多少条规则想把他捞回来，都必须先被挡住。
 *
 * 场景全部取自 CTS 真实数据的形状（335 人、634 触点）。
 */

import { describe, expect, it } from 'vitest'
import { segmentContact, todayWorklist, segmentCounts, type ContactLike } from '../segments'

const NOW = new Date('2026-07-26T12:00:00Z')

function contact(over: Partial<ContactLike> = {}): ContactLike {
  return { id: 'c1', displayName: 'Kam', doNotContact: false, touchpoints: [], ...over }
}

const form = (at: string) => ({ channel: 'meta_lead_form', direction: 'inbound' as const, occurredAt: at })
const call = (at: string, outcome: string, extra: Record<string, unknown> = {}) => ({
  channel: 'phone', direction: 'outbound' as const, occurredAt: at, outcome, ...extra,
})

describe('先挡住不该打的人', () => {
  it('说过别再联系的，任何后续规则都捞不回来', () => {
    const c = contact({
      doNotContact: true,
      // 同时具备「客户刚回信」和「约了回电」——最强的两个进名单理由
      touchpoints: [
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T11:00:00Z' },
        call('2026-07-20T00:00:00Z', 'spoke', { callbackAt: '2026-07-25T00:00:00Z' }),
      ],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('excluded')
    expect(r.suggestedChannel).toBe('none')
  })

  it('号码是坏的就别再排进名单', () => {
    const c = contact({ touchpoints: [form('2026-07-01T00:00:00Z'), call('2026-07-01T00:00:00Z', 'bad_number')] })
    expect(segmentContact(c, NOW).segment).toBe('excluded')
  })

  it('明确说没兴趣的也排除', () => {
    const c = contact({ touchpoints: [call('2026-07-01T00:00:00Z', 'not_interested')] })
    expect(segmentContact(c, NOW).segment).toBe('excluded')
  })
})

describe('第一段：客户回了话', () => {
  it('客户的消息晚于我们最后一次外呼 = 他在等我们', () => {
    const c = contact({
      touchpoints: [
        call('2026-07-25T00:00:00Z', 'spoke'),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' },
      ],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('replied')
    expect(r.temperature).toBe('hot')
    expect(r.reason).toContain('10 小时')
  })

  it('时间戳相等不算回信 —— 导入的历史数据表单和通话是同一个时间', () => {
    // 这条是真实数据的形状：Sheet 没记通话时间，只能用表单时间做锚点。
    // 判成「客户在等我们」会让 335 个人全部涌进第一段，名单就废了。
    const t = '2026-07-01T00:00:00Z'
    const c = contact({ touchpoints: [form(t), call(t, 'spoke')] })
    expect(segmentContact(c, NOW).segment).not.toBe('replied')
  })
})

describe('第二段：约好的时间到了', () => {
  it('约的时间已过 → 进名单', () => {
    const c = contact({
      touchpoints: [call('2026-07-20T00:00:00Z', 'callback_set', { callbackAt: '2026-07-26T09:00:00Z' })],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('callback_due')
    expect(r.dueAt).toBe('2026-07-26T09:00:00Z')
  })

  it('约的时间还没到 → 今天不打扰', () => {
    const c = contact({
      touchpoints: [call('2026-07-20T00:00:00Z', 'callback_set', { callbackAt: '2026-07-30T09:00:00Z' })],
    })
    expect(segmentContact(c, NOW).segment).not.toBe('callback_due')
  })
})

describe('第三段：新 lead 待首联', () => {
  it('进线了但一次都没联系过', () => {
    const c = contact({ touchpoints: [form('2026-07-26T00:00:00Z')] })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('new_untouched')
    expect(r.reason).toContain('12 小时')
  })
})

describe('数据里存在、但手工表没有的三段', () => {
  it('打不通的人改渠道，而不是明天再空打一次', () => {
    // 110 个人卡在这里，是最大的一块
    const c = contact({ touchpoints: [form('2026-07-01T00:00:00Z'), call('2026-07-01T00:00:00Z', 'no_answer')] })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('retry_channel')
    expect(r.suggestedChannel).toBe('sms')
  })

  it('说了明年才走的人，现在打是打扰', () => {
    const c = contact({
      touchpoints: [call('2026-07-01T00:00:00Z', 'spoke', { travelWindow: '明年三月' })],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('nurture_future')
    expect(r.temperature).toBe('cold')
    expect(r.reason).toContain('明年三月')
  })

  it('以后才走优先于「新 lead」—— 否则会被当成待首联反复打', () => {
    const c = contact({
      touchpoints: [form('2026-07-01T00:00:00Z'), call('2026-07-01T00:00:00Z', 'spoke', { travelWindow: '2027 年三月' })],
    })
    expect(segmentContact(c, NOW).segment).toBe('nurture_future')
  })

  /**
   * 「聊过一轮就断了」以前被兜底并进「以后才走」，还被贴上「打了是打扰」的标签
   * 埋进折叠区 —— 客户根本没说过以后才走，是系统替他说的，这批最该回头捞的
   * 温线索就此消失。现在必须单独成桶、并且进今天的名单。
   */
  it('聊过一轮没约下次 ≠ 以后才走 —— 单独成桶，且必须留在今天名单里', () => {
    const c = contact({ touchpoints: [call('2026-07-20T00:00:00Z', 'spoke')] })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('stale_conversation')
    expect(r.temperature).toBe('warm')
    expect(r.reason).toContain('6 天')
  })

  it('客户真说了以后才走，才归「以后才走」—— 两者不能混', () => {
    const spoke = segmentContact(contact({ touchpoints: [call('2026-07-20T00:00:00Z', 'spoke')] }), NOW)
    const later = segmentContact(
      contact({ touchpoints: [call('2026-07-20T00:00:00Z', 'spoke', { travelWindow: '明年三月' })] }),
      NOW,
    )
    expect(spoke.segment).not.toBe(later.segment)
    expect(later.segment).toBe('nurture_future')
  })

  it('「打过没人接」不能说成「打不通」—— 只知道打了没接，晚上可能就接了', () => {
    const c = contact({ touchpoints: [call('2026-07-23T00:00:00Z', 'no_answer')] })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('retry_channel')
    expect(r.reason).toContain('没人接')
    expect(r.reason).not.toContain('打不通')
  })

  it('带上最后来往时间 —— 卡片要显示「等了几天」，同桶排序也靠它', () => {
    const c = contact({ touchpoints: [call('2026-07-20T00:00:00Z', 'spoke')] })
    expect(segmentContact(c, NOW).lastTouchAt).toBe('2026-07-20T00:00:00.000Z')
  })
})

describe('今天的名单', () => {
  const people: ContactLike[] = [
    contact({ id: 'cold', touchpoints: [call('2026-07-01T00:00:00Z', 'spoke', { travelWindow: '明年' })] }),
    contact({ id: 'new', touchpoints: [form('2026-07-26T06:00:00Z')] }),
    contact({ id: 'replied', touchpoints: [call('2026-07-25T00:00:00Z', 'spoke'), { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T05:00:00Z' }] }),
    contact({ id: 'dnc', doNotContact: true, touchpoints: [form('2026-07-26T06:00:00Z')] }),
    contact({ id: 'due', touchpoints: [call('2026-07-20T00:00:00Z', 'callback_set', { callbackAt: '2026-07-26T08:00:00Z' })] }),
  ]

  it('按 PM 手工表的顺序排：回信 → 约好的 → 新 lead', () => {
    expect(todayWorklist(people, NOW).map((c) => c.id)).toEqual(['replied', 'due', 'new'])
  })

  it('冷的和排除的不进今天的名单', () => {
    const ids = todayWorklist(people, NOW).map((c) => c.id)
    expect(ids).not.toContain('cold')
    expect(ids).not.toContain('dnc')
  })

  it('计数覆盖每一个人，一个都不能漏', () => {
    const counts = segmentCounts(people, NOW)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(people.length)
  })

  /**
   * 同一桶里 priority 相同、dueAt 多半是 null —— 没有这层排序，顺序基本是随机的，
   * 销售会问「凭什么先打这个」。等得最久的排前面才说得通。
   */
  it('同一桶里，等得最久的排前面', () => {
    const sameBucket: ContactLike[] = [
      contact({ id: 'waited-1day', touchpoints: [call('2026-07-25T00:00:00Z', 'no_answer')] }),
      contact({ id: 'waited-20days', touchpoints: [call('2026-07-06T00:00:00Z', 'no_answer')] }),
      contact({ id: 'waited-6days', touchpoints: [call('2026-07-20T00:00:00Z', 'no_answer')] }),
    ]
    expect(todayWorklist(sameBucket, NOW).map((c) => c.id)).toEqual([
      'waited-20days',
      'waited-6days',
      'waited-1day',
    ])
  })

  it('「聊过了没下文」进名单，但排在所有该打电话的后面', () => {
    const mixed: ContactLike[] = [
      contact({ id: 'stale', touchpoints: [call('2026-07-01T00:00:00Z', 'spoke')] }),
      contact({ id: 'new', touchpoints: [form('2026-07-26T06:00:00Z')] }),
    ]
    expect(todayWorklist(mixed, NOW).map((c) => c.id)).toEqual(['new', 'stale'])
  })
})

describe('员工推进过的阶段要真的消名单', () => {
  // 这一段是「改阶段」有没有用的分水岭：改完人还留在名单上，它就退化成
  // 又一个没人填的状态列，跟 CTS 那份手工 CRM 死法一样。
  it('推进到成交 / 转售后 / 停止营销的人，不再出现在今天的名单', () => {
    const c = contact({
      stageSuppressed: true,
      stageLabel: '已付全款',
      // 同时具备最强的两个进名单理由：客户刚回信 + 约好的时间到了
      touchpoints: [
        call('2026-07-20T00:00:00Z', 'callback_set', { callbackAt: '2026-07-25T00:00:00Z' }),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T11:00:00Z' },
      ],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('excluded')
    expect(r.suggestedChannel).toBe('none')
    // 理由要说人话，销售看得懂为什么这个人不在名单上
    expect(r.reason).toContain('已付全款')
  })

  it('还在跟进的阶段不影响原本的分段', () => {
    const c = contact({
      stageSuppressed: false,
      stageLabel: '已报价',
      touchpoints: [form('2026-07-26T06:00:00Z')],
    })
    expect(segmentContact(c, NOW).segment).toBe('new_untouched')
  })

  it('「别再联系」优先于阶段 —— 合规话术不能被阶段文案盖掉', () => {
    const c = contact({ doNotContact: true, stageSuppressed: true, stageLabel: '已付全款' })
    expect(segmentContact(c, NOW).reason).toBe('客户明确说过别再联系')
  })

  it('没配阶段的人（stage 为空）照旧走原有分段', () => {
    const c = contact({ touchpoints: [form('2026-07-26T06:00:00Z')] })
    expect(segmentContact(c, NOW).segment).toBe('new_untouched')
  })
})

describe('员工推进过的阶段要真的消名单', () => {
  // 这一段是「改阶段」有没有用的分水岭：改完人还留在名单上，它就退化成
  // 又一个没人填的状态列，跟 CTS 那份手工 CRM 死法一样。
  it('推进到成交 / 转售后 / 停止营销的人，不再出现在今天的名单', () => {
    const c = contact({
      stageSuppressed: true,
      stageLabel: '已付全款',
      // 同时具备最强的两个进名单理由：客户刚回信 + 约好的时间到了
      touchpoints: [
        call('2026-07-20T00:00:00Z', 'callback_set', { callbackAt: '2026-07-25T00:00:00Z' }),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T11:00:00Z' },
      ],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('excluded')
    expect(r.suggestedChannel).toBe('none')
    // 理由要说人话，销售看得懂为什么这个人不在名单上
    expect(r.reason).toContain('已付全款')
  })

  it('还在跟进的阶段不影响原本的分段', () => {
    const c = contact({
      stageSuppressed: false,
      stageLabel: '已报价',
      touchpoints: [form('2026-07-26T06:00:00Z')],
    })
    expect(segmentContact(c, NOW).segment).toBe('new_untouched')
  })

  it('「别再联系」优先于阶段 —— 合规话术不能被阶段文案盖掉', () => {
    const c = contact({ doNotContact: true, stageSuppressed: true, stageLabel: '已付全款' })
    expect(segmentContact(c, NOW).reason).toBe('客户明确说过别再联系')
  })

  it('没配阶段的人（stage 为空）照旧走原有分段', () => {
    const c = contact({ touchpoints: [form('2026-07-26T06:00:00Z')] })
    expect(segmentContact(c, NOW).segment).toBe('new_untouched')
  })
})
