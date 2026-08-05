/**
 * 分段规则。
 *
 * 这份规则决定销售今天打给谁，所以顺序就是产品本身：一个说过「别再联系」
 * 的人，无论后面多少条规则想把他捞回来，都必须先被挡住。
 *
 * 场景全部取自 CTS 真实数据的形状（335 人、634 触点）。
 */

import { describe, expect, it } from 'vitest'
import {
  segmentContact, todayWorklist, segmentCounts, engagementFromMetadata, reachableChannel,
  type ContactLike, type TouchpointLike,
} from '../segments'

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
    // 昨天打的 —— 三天之内还值得真人再试一次
    const c = contact({ touchpoints: [form('2026-07-25T00:00:00Z'), call('2026-07-25T00:00:00Z', 'no_answer')] })
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
    const c = contact({ touchpoints: [call('2026-07-25T00:00:00Z', 'no_answer')] })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('retry_channel')
    expect(r.reason).toContain('没人接')
    expect(r.reason).not.toContain('打不通')
  })

  /**
   * 这一组是「以后才走」这批人的分水岭：以前只要说过出行时间就被无限期
   * 压在培育里，到了日子也没有任何东西把人叫醒 —— 系统亲手把最明确的
   * 购买意图放凉。CTS 19 个人卡在这个状态。
   */
  it('出行时间还早 —— 留在培育里，现在打是打扰', () => {
    const c = contact({
      touchpoints: [call('2026-07-14T00:00:00Z', 'spoke', { travelWindow: '明年三月' })],
    })
    expect(segmentContact(c, NOW).segment).toBe('nurture_future')
  })

  /**
   * PM 2026-08-03 拿掉了「快出行了，该定了」这一批：它靠 AI 从通话里解析出的
   * 月份去推断「他该定了」—— 是猜的，不是客人说的。这一页现在只认客人**真的
   * 说过话 / 真的动过手**。
   *
   * 拿掉之后不能把人弄丢：到了出行月份的人**照旧留在今天的名单上**，只是
   * 理由老实写「聊过一轮就断了」，不假装知道他急不急。
   */
  it('出行时间到了 —— 不再单独成批，但人必须还在名单上', () => {
    const c = contact({
      touchpoints: [call('2026-06-19T00:00:00Z', 'spoke', { travelWindow: '下个月左右' })],
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('stale_conversation')
    // 关键：还在今天的名单里（warm），没有掉进折叠区
    expect(r.temperature).toBe('warm')
  })

  it('出行时间算不出来的（「看情况」）不瞎猜，留在培育里', () => {
    const c = contact({
      touchpoints: [call('2026-06-19T00:00:00Z', 'spoke', { travelWindow: '看情况再说' })],
    })
    expect(segmentContact(c, NOW).segment).toBe('nurture_future')
  })

  /** 拿掉「快出行了」之后，今天刚进线的人排在聊过就断了的人前面 —— 线索会凉。 */
  it('今天刚进线的排在「聊过就断了」前面', () => {
    const stale = contact({
      id: 'stale',
      touchpoints: [call('2026-06-19T00:00:00Z', 'spoke', { travelWindow: '下个月左右' })],
    })
    const fresh = contact({ id: 'fresh', touchpoints: [form('2026-07-26T06:00:00Z')] })
    expect(todayWorklist([fresh, stale], NOW).map((c) => c.id)).toEqual(['fresh', 'stale'])
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
    // 三个都在「打了没接」的 3 天窗口内 —— 同一桶，才验得到桶内排序
    const sameBucket: ContactLike[] = [
      contact({ id: 'waited-1day', touchpoints: [call('2026-07-25T00:00:00Z', 'no_answer')] }),
      contact({ id: 'waited-almost3days', touchpoints: [call('2026-07-23T18:00:00Z', 'no_answer')] }),
      contact({ id: 'waited-2days', touchpoints: [call('2026-07-24T00:00:00Z', 'no_answer')] }),
    ]
    expect(todayWorklist(sameBucket, NOW).map((c) => c.id)).toEqual([
      'waited-almost3days',
      'waited-2days',
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

// ── 邮件行为信号 vs 真人消息（2026-08-02 P0）─────────────────────────────────
//
// 邮件反应同步一上线，「打开了邮件」以 inbound 身份进了触点表，把最高优先桶
// 从 15 人撑到 200 人 —— 15 个真在等回复的客户被 185 个自动打开埋掉。
// Apple 隐私保护还会替用户自动打开邮件，所以「打开」连「他看过」都不算。
describe('邮件打开 / 点击不能冒充「客户回话了」', () => {
  const NOW = new Date('2026-08-02T00:00:00Z')
  const base = (tps: TouchpointLike[]): ContactLike => ({
    id: 'c1', displayName: '张三', doNotContact: false, touchpoints: tps,
  })

  const ourEmail = { channel: 'email', direction: 'outbound' as const, occurredAt: '2026-07-10T00:00:00Z' }
  const opened = {
    channel: 'email', direction: 'inbound' as const,
    occurredAt: '2026-07-11T00:00:00Z', engagement: 'open' as const,
  }
  const clicked = {
    channel: 'email', direction: 'inbound' as const,
    occurredAt: '2026-07-20T00:00:00Z', engagement: 'click' as const,
  }

  it('🔴 只是打开了邮件 → 绝不是「客户回话了」', () => {
    const seg = segmentContact(base([ourEmail, opened]), NOW)
    expect(seg.segment).not.toBe('replied')
  })

  it('🔴 只是打开、没点链接 → 也不进「看了行程」桶（Apple 会替用户自动打开）', () => {
    // 不加这一条，把「打开」当「点击」的实现会悄悄溜过去：CTS 有 221 人打开过
    // 邮件、只有 44 人真点了链接，混为一谈等于这个桶又变成一大坨。
    expect(segmentContact(base([ourEmail, opened]), NOW).segment).not.toBe('clicked_link')
  })

  it('真人回信仍然判「客户回话了」（别把真信号一起误伤）', () => {
    const realReply = { channel: 'email', direction: 'inbound' as const, occurredAt: '2026-07-11T00:00:00Z' }
    expect(segmentContact(base([ourEmail, realReply]), NOW).segment).toBe('replied')
  })

  it('点了行程链接、之后没人跟 → 进「看了行程，还没人跟」', () => {
    const seg = segmentContact(base([ourEmail, clicked]), NOW)
    expect(seg.segment).toBe('clicked_link')
    expect(seg.temperature).toBe('warm')
    expect(seg.reason).toContain('点开了')
  })

  it('点完之后已经有人真人联系过 → 不再进这个桶', () => {
    const calledAfter = { channel: 'phone', direction: 'outbound' as const, occurredAt: '2026-07-25T00:00:00Z' }
    expect(segmentContact(base([ourEmail, clicked, calledAfter]), NOW).segment).not.toBe('clicked_link')
  })

  it('点击太久远（超 60 天）→ 不再算数', () => {
    const oldClick = { ...clicked, occurredAt: '2026-01-01T00:00:00Z' }
    expect(segmentContact(base([ourEmail, oldClick]), NOW).segment).not.toBe('clicked_link')
  })

  it('说了「以后才走」但刚点了链接 → 捞回名单，不埋进培育桶', () => {
    const spoken = {
      channel: 'phone', direction: 'outbound' as const,
      occurredAt: '2026-07-01T00:00:00Z', travelWindow: '明年三月',
    }
    expect(segmentContact(base([spoken, clicked]), NOW).segment).toBe('clicked_link')
  })

  it('打开邮件不会把「等了几天」重置 —— 排序仍按真人消息算', () => {
    const seg = segmentContact(base([ourEmail, opened]), NOW)
    expect(seg.lastTouchAt).toBe('2026-07-10T00:00:00.000Z')
  })
})

describe('engagementFromMetadata —— 两个读模型共用的判据', () => {
  it('点击优先于打开（点了必然也打开了，要认更强的那个）', () => {
    expect(engagementFromMetadata({ email_opened: true, email_clicked: true })).toBe('click')
  })
  it('只打开', () => {
    expect(engagementFromMetadata({ email_opened: true, email_clicked: false })).toBe('open')
  })
  it('普通触点（电话 / 表单 / 真人回信）不是行为信号', () => {
    expect(engagementFromMetadata({ outcome: 'no_answer' })).toBeNull()
    expect(engagementFromMetadata(null)).toBeNull()
    expect(engagementFromMetadata(undefined)).toBeNull()
  })
})

/**
 * 建议的渠道必须落在这个人真的能被联系到的地方。
 *
 * 真实数据：CTS 名单 476 人里 124 人（26%）没有电话号码，其中 106 人只有
 * Facebook 身份（从私信补挂进来的）。而「新客人，还没打过」这个桶的说明写着
 * 「越早打通越容易成」—— 销售照着打，打到的是一个空号码位。
 */
describe('建议的渠道必须真的能联系到人', () => {
  const reach = (over: Partial<ContactLike>) =>
    contact({ touchpoints: [form('2026-07-26T00:00:00Z')], hasPhone: false, hasEmail: false, hasMessenger: false, ...over })

  it('新客人有电话 → 还是打电话', () => {
    expect(segmentContact(reach({ hasPhone: true }), NOW).suggestedChannel).toBe('phone')
  })

  it('新客人没电话、只有 Facebook → 改成私信，绝不建议打电话', () => {
    const r = segmentContact(reach({ hasMessenger: true }), NOW)
    expect(r.segment).toBe('new_untouched')
    expect(r.suggestedChannel).toBe('messenger')
  })

  it('新客人没电话、只有邮箱 → 改成邮件', () => {
    expect(segmentContact(reach({ hasEmail: true }), NOW).suggestedChannel).toBe('email')
  })

  it('三样都没有 → 老实说联系不上，不瞎给一个渠道', () => {
    expect(segmentContact(reach({}), NOW).suggestedChannel).toBe('none')
  })

  it('打不通要改发短信的人，如果压根没号码 → 退到私信', () => {
    const c = contact({
      touchpoints: [form('2026-07-25T00:00:00Z'), call('2026-07-25T00:00:00Z', 'no_answer')],
      hasPhone: false, hasEmail: false, hasMessenger: true,
    })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('retry_channel')
    expect(r.suggestedChannel).toBe('messenger')
  })

  it('已经排除的人，就算有电话也仍然是「不联系」', () => {
    const c = contact({ doNotContact: true, hasPhone: true, touchpoints: [form('2026-07-26T00:00:00Z')] })
    expect(segmentContact(c, NOW).suggestedChannel).toBe('none')
  })

  /**
   * 向后兼容：老调用方（脚本 / 还没改的读模型）不传这三个字段，此时不能替它猜
   * ——把所有人都判成「联系不上」比判错渠道更糟。
   */
  it('调用方没给联系方式信息 → 保持规则原本的建议，不擅自降级', () => {
    const c = contact({ touchpoints: [form('2026-07-26T00:00:00Z')] })
    expect(segmentContact(c, NOW).suggestedChannel).toBe('phone')
  })

  it('优先级：电话 > 私信 > 邮件（能当场把事办了的排前面）', () => {
    expect(reachableChannel('email', { hasPhone: true, hasEmail: true, hasMessenger: true })).toBe('email')
    expect(reachableChannel('phone', { hasPhone: false, hasEmail: true, hasMessenger: true })).toBe('messenger')
    expect(reachableChannel('phone', { hasPhone: false, hasEmail: true, hasMessenger: false })).toBe('email')
  })
})

/**
 * 推迟。
 *
 * PM 2026-08-03 问「能不能手动切换分组」。答案是不给那个开关，但给「推迟」——
 * 因为它不是把结果按住，而是**告诉系统一个事实**（这人现在不该联系），
 * 系统据此重算。区别在这几条上：
 *   · 到期**自己回来**，不需要任何人记得去解除 —— 手动状态列就是死在「没人回去改」
 *   · 挡不住「别再联系」这类更硬的结论
 *   · 到期后照常参与所有规则，不留后遗症
 */
describe('推迟：到点自己回来，不用人记得', () => {
  const hot = () => [
    { channel: 'email', direction: 'inbound' as const, occurredAt: '2026-07-26T11:00:00Z' },
    call('2026-07-20T00:00:00Z', 'spoke'),
  ]

  it('推迟到以后 → 不进今天的名单', () => {
    const c = contact({ snoozeUntil: '2026-09-01T00:00:00Z', touchpoints: hot() })
    const r = segmentContact(c, NOW)
    expect(r.segment).toBe('excluded')
    expect(r.suggestedChannel).toBe('none')
  })

  /** 这条是「推迟」和「手动改分组」的全部区别 —— 没有它就又是一个没人维护的状态列。 */
  it('到期之后自己回来，不需要任何人去解除', () => {
    const c = contact({ snoozeUntil: '2026-07-20T00:00:00Z', touchpoints: hot() })
    expect(segmentContact(c, NOW).segment).toBe('replied')
  })

  it('刚好到期的当下就算回来了，不多压一天', () => {
    const c = contact({ snoozeUntil: NOW.toISOString(), touchpoints: hot() })
    expect(segmentContact(c, NOW).segment).toBe('replied')
  })

  /** 合规优先级不能被一个普通的「先放放」盖过去。 */
  it('挡不住「别再联系」—— 那句话更硬', () => {
    const c = contact({ doNotContact: true, snoozeUntil: '2026-09-01T00:00:00Z' })
    expect(segmentContact(c, NOW).reason).toBe('客户明确说过别再联系')
  })

  it('没设推迟的人完全不受影响', () => {
    expect(segmentContact(contact({ touchpoints: hot() }), NOW).segment).toBe('replied')
  })

  /**
   * 理由说的是日期不是天数：销售脑子里记的是「10 月 3 日」，
   * 而天数每天都在变，看两眼就不信了。
   */
  it('理由里说的是哪天回来，不是「还有几天」', () => {
    const c = contact({ snoozeUntil: '2026-10-03T00:00:00Z' })
    expect(segmentContact(c, NOW).reason).toContain('10 月 3 日')
    expect(segmentContact(c, NOW).reason).not.toContain('天后')
  })

  it.each([
    ['2026-07-27T12:00:00Z', '明天'],
    ['2026-07-28T12:00:00Z', '后天'],
  ])('近的两档说人话（%s → %s）', (until, word) => {
    expect(segmentContact(contact({ snoozeUntil: until }), NOW).reason).toContain(word)
  })

  /** 存了一句坏数据也不能让整块看板炸掉。 */
  it('推迟时间是坏数据 → 当没推迟处理，不炸', () => {
    const c = contact({ snoozeUntil: '不是个时间', touchpoints: hot() })
    expect(segmentContact(c, NOW).segment).toBe('replied')
  })
})

/**
 * 打了没接：三天之内人再试，超过三天交给系统。
 *
 * PM 2026-08-03 定的规则。三天是个真实的判断 —— 中午没接的人晚上会接、周一没接的
 * 周二会接；但打到第四天还没接上，再打的收益已经很低，那段时间应该还给真的有人
 * 在等的那一批。关键是**他一开口就要跳回最上面**，交给系统不等于放弃。
 */
describe('打了没接：三天之内人再试，之后交给系统', () => {
  const noAnswerAt = (at: string) => contact({ touchpoints: [call(at, 'no_answer')] })

  it.each([
    ['今天', '2026-07-26T06:00:00Z'],
    ['昨天', '2026-07-25T00:00:00Z'],
    ['两天前', '2026-07-24T00:00:00Z'],
  ])('%s打的 → 还让人再试一次', (_label, at) => {
    expect(segmentContact(noAnswerAt(at), NOW).segment).toBe('retry_channel')
  })

  it.each([
    ['三天前', '2026-07-23T00:00:00Z'],
    ['五天前', '2026-07-21T00:00:00Z'],
    ['二十天前', '2026-07-06T00:00:00Z'],
  ])('%s打的 → 交给系统跟，不再占人的时间', (_label, at) => {
    const r = segmentContact(noAnswerAt(at), NOW)
    expect(r.segment).toBe('handoff_sop')
    expect(r.reason).toContain('交给系统')
  })

  /**
   * 「交给系统」不是放弃。这批人仍然是 warm —— 他一旦回消息或点链接，
   * 上面那些规则会先命中，人自己跳回最上面那层。
   */
  it('交给系统的人还是 warm —— 他一开口就跳回去，不是被埋掉', () => {
    expect(segmentContact(noAnswerAt('2026-07-06T00:00:00Z'), NOW).temperature).toBe('warm')
  })

  it('他后来回话了 → 立刻回到「客人在等你」，三天规则拦不住', () => {
    const c = contact({
      touchpoints: [
        call('2026-07-06T00:00:00Z', 'no_answer'),
        { channel: 'messenger', direction: 'inbound', occurredAt: '2026-07-26T10:00:00Z' },
      ],
    })
    expect(segmentContact(c, NOW).segment).toBe('replied')
  })
})

/**
 * 进线很久、一直没人联系过的人 —— 不是「新客人」，是积压。
 *
 * 这条界是 2026-08-03 改「AI 秒回不算我们回过」时**被迫补上的**：在那之前，
 * Meta 的自动回复被算成「我们联系过」，于是 2019 年留过言、只收到一句自动问候
 * 的人因为 lastOutbound > 0 而进不了「新客人」—— 那是一层**意外的保护**。
 * 把自动回复滤掉之后这层保护没了，CTS 有 63 个人超过一年没动静，会一股脑冒进
 * 「还没搭上话」，写着「进线 43800 小时还没人联系」。
 *
 * 所以这一组钉的是：**今天真的新的人要在，陈年积压不许挤进来。**
 */
describe('从没人联系过：新的留在名单上，陈年积压交给系统', () => {
  const enquiredAt = (at: string) => contact({ touchpoints: [form(at)] })

  it.each([
    ['今天', '2026-07-26T06:00:00Z'],
    ['三天前', '2026-07-23T00:00:00Z'],
    ['十三天前', '2026-07-13T12:00:00Z'],
  ])('%s进线、还没人碰 → 还是新客人，留在名单上', (_label, at) => {
    const r = segmentContact(enquiredAt(at), NOW)
    expect(r.segment).toBe('new_untouched')
    expect(r.suggestedChannel).toBe('phone')
  })

  it.each([
    ['十四天前', '2026-07-12T00:00:00Z'],
    ['两个月前', '2026-05-26T00:00:00Z'],
    ['五年前', '2021-07-26T00:00:00Z'],
  ])('%s进线、一直没人碰 → 交给系统，别占今天的时间', (_label, at) => {
    const r = segmentContact(enquiredAt(at), NOW)
    expect(r.segment).toBe('handoff_sop')
    expect(r.reason).toContain('一直没人联系过')
  })

  /** 五年前的人绝不能显示成「进线 43800 小时还没人联系」。 */
  it('陈年的人不说荒唐的小时数', () => {
    const r = segmentContact(enquiredAt('2021-07-26T00:00:00Z'), NOW)
    expect(r.reason).not.toContain('小时')
    expect(r.reason).toContain('天')
  })

  /** 交给系统 ≠ 放弃：他哪天回话了，立刻回到最上面那层。 */
  it('陈年积压的人一开口，立刻回到「客人在等你」', () => {
    const c = contact({
      touchpoints: [
        form('2021-07-26T00:00:00Z'),
        call('2026-07-20T00:00:00Z', 'spoke'),
        { channel: 'messenger', direction: 'inbound', occurredAt: '2026-07-26T10:00:00Z' },
      ],
    })
    expect(segmentContact(c, NOW).segment).toBe('replied')
  })

  it('陈年积压仍然是 warm —— 不是被埋进折叠区就等于扔了', () => {
    expect(segmentContact(enquiredAt('2021-07-26T00:00:00Z'), NOW).temperature).toBe('warm')
  })
})
