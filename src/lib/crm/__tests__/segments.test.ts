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
  segmentContact, todayWorklist, segmentCounts, engagementFromMetadata, reachableChannel, isPhoneVerdict, isFailedReach,
  suggestsAlternativeChannel, offListGroup,
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

  it('明确说没兴趣的也排除', () => {
    const c = contact({ touchpoints: [call('2026-07-01T00:00:00Z', 'not_interested')] })
    expect(segmentContact(c, NOW).segment).toBe('excluded')
  })
})

/**
 * 🔴 **人纠正过「这条别再联系判错了」之后，他得真的回到名单上**
 * （Codex 复审 2026-08-16）。
 *
 * 光让判据返回 false 不够 —— 那条误判的触点还在库里，而这里看的是触点上的
 * 结果值。分段不跟着作废的话，结局是最坏的一种：黄条消失了、人工任务也不再
 * 冒出来（判据说他不是拒联了），**但他照样不出现在今天该联系的人里**，
 * 而且再没有任何按钮可以处理他 —— 看起来修好了，实际人被彻底埋掉。
 */
describe('被推翻过的拒联判词不算数', () => {
  const dnc = (at: string) => call(at, 'do_not_contact')
  const cleared = (at: string) => call(at, 'dnc_cleared')

  it('纠正晚于那条误判 → 回到名单', () => {
    const c = contact({
      touchpoints: [
        dnc('2026-07-01T00:00:00Z'),
        cleared('2026-07-02T00:00:00Z'),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T11:00:00Z' },
      ],
    })
    expect(segmentContact(c, NOW).segment).not.toBe('excluded')
  })

  it('纠正早于那条拒联 → 仍然排除，后来他真的说了', () => {
    const c = contact({
      touchpoints: [cleared('2026-07-01T00:00:00Z'), dnc('2026-07-02T00:00:00Z')],
    })
    expect(segmentContact(c, NOW).segment).toBe('excluded')
  })

  it('🔴 只作废「别再联系」—— 没资格替客人收回「我不买了」', () => {
    const c = contact({
      touchpoints: [
        call('2026-07-01T00:00:00Z', 'not_interested'),
        cleared('2026-07-02T00:00:00Z'),
      ],
    })
    expect(segmentContact(c, NOW).segment).toBe('excluded')
  })
})

/**
 * 🔴 **「号码是坏的」是渠道故障，不是这个人的结局**（PM 2026-08-16 从线上截图抓到）。
 *
 * 线上真实数据：CTS 24 个被标坏号的人里 **23 个后来又来过消息**，15 个一直在跟
 * 我们邮件往来。Sue Masson 7 月 6 号被标坏号，此后来了 11 封信、最后一封是当天，
 * 却一直躺在「号码是坏的·补一个对的就能继续跟」那一栏里没人回。
 *
 * 判据必须分层：**联系方式是渠道属性，成不成是人的状态，两件事不许互相覆盖。**
 */
describe('号码打不通 ≠ 这个人不要了', () => {
  const badNumberThenEmail = (over: Partial<ContactLike> = {}) =>
    contact({
      touchpoints: [
        form('2026-07-01T00:00:00Z'),
        call('2026-07-02T00:00:00Z', 'bad_number'),
        // 标了坏号之后，他自己发邮件回来了 —— 这个人显然还活着
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' },
      ],
      hasPhone: true,
      hasEmail: true,
      ...over,
    })

  it('坏号之后客人又来信 → 照旧进「客户回话了」，不再被埋掉', () => {
    const r = segmentContact(badNumberThenEmail(), NOW)
    expect(r.segment).toBe('replied')
  })

  it('坏号的人建议渠道降级到邮件 —— 绝不让销售再打那个号', () => {
    expect(segmentContact(badNumberThenEmail(), NOW).suggestedChannel).toBe('email')
  })

  it('只有 Messenger 的坏号客人 → 降级到 Messenger', () => {
    const r = segmentContact(
      badNumberThenEmail({ hasEmail: false, hasMessenger: true }),
      NOW,
    )
    expect(r.suggestedChannel).toBe('messenger')
  })

  /**
   * 卡片必须分得清「没留电话」和「号是坏的」—— 对一个抽屉里明明存着号码的人
   * 说「没留电话」，销售一眼就能戳穿，而这一页最贵的资产是「它说的话可信」。
   */
  it('库里有号码但打不通 → 标出来，好让卡片说对话', () => {
    expect(segmentContact(badNumberThenEmail(), NOW).phoneUnusable).toBe(true)
  })

  it('压根没留过电话的人 → 不许说成「号打不通」', () => {
    const r = segmentContact(
      badNumberThenEmail({ hasPhone: false, hasEmail: true }),
      NOW,
    )
    expect(r.phoneUnusable).toBe(false)
  })

  /** 电话打不通、又真的没有第二条路 —— 这时候才该退出名单。 */
  it('坏号 + 没邮箱 + 没 Messenger → 仍然排除，并说清缺什么', () => {
    const r = segmentContact(
      badNumberThenEmail({ hasEmail: false, hasMessenger: false }),
      NOW,
    )
    expect(r.segment).toBe('excluded')
    expect(r.reason).toContain('补个联系方式')
  })

  /**
   * 🔴 **坏号不是永久判决**（Codex 复审 2026-08-16）。
   *
   * 号码会被改对（FDE 补一个新号），当初也可能就标错了。语音桥接接通时会写
   * 一条 `spoke` —— 「标错之后又打通了」是真实可发生的。永久判死的话，一个
   * 已经打得通的号会被永远藏起来，销售还会看到「这个号打不通」，
   * 而他手上刚打通过 —— 这一页当场失去可信度。
   */
  it('后来真的打通过 → 电话这条路恢复，不再说它打不通', () => {
    const c = contact({
      touchpoints: [
        form('2026-07-01T00:00:00Z'),
        call('2026-07-02T00:00:00Z', 'bad_number'),
        call('2026-07-20T00:00:00Z', 'spoke'),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' },
      ],
      hasPhone: true,
      hasEmail: true,
    })
    const r = segmentContact(c, NOW)
    expect(r.phoneUnusable).toBe(false)
    expect(r.suggestedChannel).toBe('phone')
  })

  /** 「打了没人接」不是「号码是坏的」—— 中午没接的人晚上会接。 */
  it('坏号之后只是没人接 → 仍然算打不通，别把电话又推回去', () => {
    const c = contact({
      touchpoints: [
        call('2026-07-02T00:00:00Z', 'bad_number'),
        call('2026-07-20T00:00:00Z', 'no_answer'),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' },
      ],
      hasPhone: true,
      hasEmail: true,
    })
    expect(segmentContact(c, NOW).phoneUnusable).toBe(true)
  })

  /**
   * 调用方一个联系方式字段都没给（老调用方）→ 不凭空判他联系不上。
   * 本文件一贯的偏向：多一个人是噪音，少一个是丢单。
   */
  it('没告诉我们有哪些联系方式 → 不替他判死刑', () => {
    const c = contact({
      touchpoints: [form('2026-07-01T00:00:00Z'), call('2026-07-02T00:00:00Z', 'bad_number')],
    })
    expect(segmentContact(c, NOW).segment).not.toBe('excluded')
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

/**
 * 「什么算对电话线的判决」必须**只有一份**（Codex 复审 2026-08-16 第二轮）。
 *
 * today 路由分「号码要修」那一组时读的是原始 DB 行，没法直接调 `segmentContact`。
 * 它原先自己写了一套「最新的任意一条结果是不是坏号」，于是跟分段判据裂开：
 * 一个只有坏号、之后又打了一次没人接的人，分段判他「号码打不通」，分组却把他
 * 丢进「不要再联系」—— **补号码这件该有人动手的事又一次被藏起来**。
 *
 * 现在两边共用这个谓词。它一改，两边一起改。
 */
describe('什么算对电话线的判决', () => {
  it('坏号和打通了都算', () => {
    expect(isPhoneVerdict('bad_number')).toBe(true)
    expect(isPhoneVerdict('spoke')).toBe(true)
  })

  it('打了没人接不算 —— 中午没接的人晚上会接', () => {
    expect(isPhoneVerdict('no_answer')).toBe(false)
  })

  it('跟电话无关的结果都不算', () => {
    for (const o of ['not_interested', 'callback_set', 'unknown', '', null, undefined]) {
      expect(isPhoneVerdict(o)).toBe(false)
    }
  })

  /**
   * 🔴 **手打笔记里那个 `spoke` 不算打通了电话**（Codex 复审 2026-08-16 第四轮）。
   *
   * `recordManualTouchpoint` 把每条手记都写成 `channel: 'phone'`，而 `classifyNote`
   * 的**兜底值就是 `spoke`** —— 任何没命中规则的普通备注都会变成它。于是销售给
   * 坏号客人记一句「已经邮件发他了」，电话当场被判成「打通了」，那个明知打不通
   * 的号又变回可拨。**而这类记录恰恰是坏号客人的常态**（他们本来就只能靠邮件联系）。
   *
   * 一个兜底值不许推翻一个人明确按下的判断。
   */
  it('手打笔记里的 spoke 不算打通 —— 它只是兜底值', () => {
    expect(isPhoneVerdict('spoke', 'me_manual')).toBe(false)
  })

  it('语音桥接写的 spoke 才算打通', () => {
    expect(isPhoneVerdict('spoke', 'voice_bridge')).toBe(true)
  })

  /** 「号码是坏的」从来不是兜底值，是有人明说的 —— 两边都认。 */
  it('手打的「号码是坏的」照旧算数', () => {
    expect(isPhoneVerdict('bad_number', 'me_manual')).toBe(true)
  })
})

/**
 * 端到端把上面那条钉在分段结果上：坏号客人之后记了一句普通的邮件沟通，
 * 号码**不许**变回可拨。
 */
describe('给坏号客人记一句邮件沟通，号码不许复活', () => {
  it('手记之后照旧是打不通', () => {
    const c = contact({
      touchpoints: [
        { channel: 'phone', direction: 'outbound', occurredAt: '2026-07-02T00:00:00Z', outcome: 'bad_number', source: 'me_manual' },
        // 销售在抽屉里记的一句「已经邮件发他了」—— 走的是同一条手记通道，
        // channel 被写死成 phone，outcome 兜底成 spoke
        { channel: 'phone', direction: 'outbound', occurredAt: '2026-07-20T00:00:00Z', outcome: 'spoke', source: 'me_manual' },
      ],
      hasPhone: true,
      hasEmail: true,
    })
    const r = segmentContact(c, NOW)
    expect(r.phoneUnusable).toBe(true)
    expect(r.suggestedChannel).not.toBe('phone')
  })
})

/**
 * 「这一笔算不算我们今天跟进过他」—— today 路由和 day-list 共用这一份。
 *
 * 拨到一个空号**没有到达客人**：他什么都没收到，正确的下一步（改用邮件 /
 * 私信）一次都还没做。算成「今天出手过」的话，卡片当场折进「今天已处理」、
 * 进度条算完成、群发邮件还会把他排除掉 —— 待办被藏起来（铁律 3）。
 */
describe('拨到空号不算我们出手过', () => {
  it('号码是坏的 → 不算', () => {
    expect(isFailedReach('bad_number')).toBe(true)
  })

  /** 「打了没人接」是一次正常尝试 —— 今天试过了、晚点再试，那就是做过了。 */
  it('打了没人接 → 算做过了', () => {
    expect(isFailedReach('no_answer')).toBe(false)
  })

  it('其余结果都算做过了', () => {
    for (const o of ['spoke', 'callback_set', 'not_interested', 'unknown', null, undefined]) {
      expect(isFailedReach(o)).toBe(false)
    }
  })
})

/**
 * 🔴 **「暂时不考虑」的人不许从名单上消失**（PM 2026-08-16 给的业务事实）。
 *
 * 系统在此之前只有一个「不感兴趣」，而它是终结性的 —— 一句「明年再说」
 * 会让这个人从此不出现在任何名单上，没有任何东西会把他叫醒。
 * 跟「号码是坏的」是同一个病：一个软信号被当成了最终结论。
 */
describe('暂时不考虑的人交给系统跟，不是停掉', () => {
  const softNo = (over: Partial<ContactLike> = {}) =>
    contact({
      touchpoints: [
        form('2026-07-01T00:00:00Z'),
        call('2026-07-10T00:00:00Z', 'not_interested_now'),
      ],
      hasPhone: true,
      hasEmail: true,
      ...over,
    })

  it('不排除 —— 人还在，自动跟进照发', () => {
    const r = segmentContact(softNo(), NOW)
    expect(r.segment).toBe('handoff_sop')
    expect(r.segment).not.toBe('excluded')
  })

  it('理由说人话，不用真人一个个打', () => {
    expect(segmentContact(softNo(), NOW).reason).toContain('现在先不考虑')
  })

  /** 对照：明确说不要了的，照旧停掉 —— 这两种的下场必须不一样。 */
  it('对照：明确不要了 → 停掉', () => {
    const hardNo = contact({
      touchpoints: [call('2026-07-10T00:00:00Z', 'not_interested')],
      hasPhone: true,
      hasEmail: true,
    })
    expect(segmentContact(hardNo, NOW).segment).toBe('excluded')
  })

  /**
   * 🔴 **系统自己群发的那封邮件，不许抹掉客人那句「现在先不考虑」**
   * （Codex 复审 2026-08-16）。
   *
   * 这个人落在「交给系统跟」，而那一桶提供的动作就是一次性群发。群发走的是
   * 同一条手记通道，备注是系统写的「群发了一封邮件」，兜底成 `spoke` ——
   * 用「最新的任意结果」判的话，第二天这个人就掉回「聊过了没下文」，
   * **又被推回真人逐个打电话的名单**。等于我们打给一个刚说过别现在打的人。
   */
  it('群发一封邮件之后，他照旧是「暂时不考虑」', () => {
    const r = segmentContact(
      softNo({
        touchpoints: [
          form('2026-07-01T00:00:00Z'),
          call('2026-07-10T00:00:00Z', 'not_interested_now'),
          // 系统群发写下的那一笔：兜底 outcome 是 spoke
          {
            channel: 'phone',
            direction: 'outbound' as const,
            occurredAt: '2026-07-12T00:00:00Z',
            outcome: 'spoke',
          },
        ],
      }),
      NOW,
    )
    expect(r.segment).toBe('handoff_sop')
  })

  /** 他一开口就跳回最上面 —— 「客户回话了」排在这条规则前面。 */
  it('说完「再说吧」之后他又来消息 → 立刻回到最高优先', () => {
    const r = segmentContact(
      softNo({
        touchpoints: [
          form('2026-07-01T00:00:00Z'),
          call('2026-07-10T00:00:00Z', 'not_interested_now'),
          { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' },
        ],
      }),
      NOW,
    )
    expect(r.segment).toBe('replied')
  })
})

/**
 * 🔴 缺口①（PO 授权 corrective，2026-08-17）：**坏号 + 别再联系(DNC) 的人，
 * 系统不得再建议任何替代联系渠道** —— 换渠道 = 绕过客户「别联系我」的意愿。
 *
 * 判据由 DNC 驱动、与坏号相互独立、fail-closed。四象限 + 单独直测每道闸。
 */
describe('suggestsAlternativeChannel：坏号+DNC 不得建议换渠道', () => {
  it('🔴 坏号 + DNC → false（defer/suppress，本 corrective 的核心 case）', () => {
    expect(suggestsAlternativeChannel({ doNotContact: true, phoneUnusable: true })).toBe(false)
  })

  it('坏号 + 非DNC → true（坏号闸独立有效，非 DNC 照旧提示换渠道）', () => {
    expect(suggestsAlternativeChannel({ doNotContact: false, phoneUnusable: true })).toBe(true)
  })

  it('好号 + DNC → false（DNC 单独就否决，不依赖坏号）', () => {
    expect(suggestsAlternativeChannel({ doNotContact: true, phoneUnusable: false })).toBe(false)
  })

  it('好号 + 非DNC → false（没坏号，本就不提示）', () => {
    expect(suggestsAlternativeChannel({ doNotContact: false, phoneUnusable: false })).toBe(false)
  })

  /**
   * 单独直测闸①：DNC 必须在**坏号存在时**仍然否决，而不是被坏号顺带挡住。
   * 对照上面两条 `doNotContact:true`：不管坏号真假，结果都是 false —— 说明
   * 决定 false 的是 DNC，不是坏号。删掉函数里 `if (x.doNotContact) return false`
   * 这一行（变异），坏号+DNC 这条会从 false 翻成 true → 本用例转红。
   */
  it('闸①承重：坏号真/假两种，DNC 都把结果压成 false', () => {
    expect(suggestsAlternativeChannel({ doNotContact: true, phoneUnusable: true })).toBe(false)
    expect(suggestsAlternativeChannel({ doNotContact: true, phoneUnusable: false })).toBe(false)
  })
})

/**
 * 🔴 缺口① 的**主修复**（子牙 / 狄仁杰复审）：off-list 分组里 DNC 必须压过坏号，
 * 否则坏号+DNC 落进 `fix_number`（组表头「补一个对的就能继续跟」怂恿继续联系）。
 */
describe('offListGroup：DNC 压过坏号，不进 fix_number', () => {
  const base = { doNotContact: false, snoozed: false, phoneLineDead: false, won: false, nurtureFuture: false }

  it('🔴 坏号 + DNC → stop（不是 fix_number）—— 主漏点断言', () => {
    expect(offListGroup({ ...base, doNotContact: true, phoneLineDead: true })).toBe('stop')
  })

  it('坏号 + 非DNC → fix_number（坏号分组独立有效，没被误伤）', () => {
    expect(offListGroup({ ...base, phoneLineDead: true })).toBe('fix_number')
  })

  it('DNC 压过 snoozed / won / later —— 与 segmentContact 次序对齐', () => {
    expect(offListGroup({ ...base, doNotContact: true, snoozed: true })).toBe('stop')
    expect(offListGroup({ ...base, doNotContact: true, won: true })).toBe('stop')
    expect(offListGroup({ ...base, doNotContact: true, nurtureFuture: true })).toBe('stop')
  })

  it('非DNC 时其余次序不变：snoozed > fix_number > won > later > stop', () => {
    expect(offListGroup({ ...base, snoozed: true, phoneLineDead: true })).toBe('snoozed')
    expect(offListGroup({ ...base, won: true })).toBe('won')
    expect(offListGroup({ ...base, nurtureFuture: true })).toBe('later')
    expect(offListGroup({ ...base })).toBe('stop')
  })
})
