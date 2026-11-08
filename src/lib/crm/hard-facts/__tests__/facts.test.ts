import { describe, expect, it } from 'vitest'
import { computeEventFacts, computeHardFacts } from '../facts'
import type {
  HardFactEvent,
  HardFactsOptions,
  HardFactsTouchpoint,
} from '../types'

const TZ = 'Pacific/Auckland'
const NOW = new Date('2026-10-30T20:00:00Z') // 2026-10-31 09:00 NZDT
const opts: HardFactsOptions = { now: NOW, timeZone: TZ }

function tp(over: Partial<HardFactsTouchpoint> = {}): HardFactsTouchpoint {
  return { channel: 'email', direction: 'inbound', occurredAt: '2026-10-01T00:00:00Z', ...over }
}

function iso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()
}

function facts(
  touchpoints: HardFactsTouchpoint[],
  o: Partial<HardFactsOptions> = {},
) {
  return computeHardFacts({ touchpoints }, { ...opts, ...o })
}

const staffPredicate = (t: HardFactsTouchpoint): boolean =>
  t.senderAddress === 'staff@example.test'

describe('whoIsWaiting', () => {
  it('只有一条入站邮件时，客户在等我们回复', () => {
    const r = facts([tp({ occurredAt: iso(5) })])
    expect(r.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(r.waitingSince).toBe(iso(5))
    expect(r.waitingDays).toBe(5)
  })

  it('我们回复后客户又追问，等待从第一次未回复的追问算起', () => {
    const r = facts([
      tp({ occurredAt: iso(6) }),
      tp({ direction: 'outbound', occurredAt: iso(4) }),
      tp({ occurredAt: iso(3) }),
      tp({ occurredAt: iso(2) }),
    ])
    expect(r.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(r.waitingSince).toBe(iso(3))
    expect(r.waitingDays).toBe(3)
  })

  it('我们回复后客户没再说话，是我们在等客户', () => {
    const r = facts([
      tp({ occurredAt: iso(6) }),
      tp({ direction: 'outbound', occurredAt: iso(4) }),
    ])
    expect(r.whoIsWaiting).toBe('we_waiting_on_customer')
    expect(r.waitingSince).toBe(iso(4))
    expect(r.waitingDays).toBe(4)
  })

  it('我们的外联超过 30 天就不再算作我们在等客户', () => {
    const touchpoints = [
      tp({ occurredAt: iso(40) }),
      tp({ direction: 'outbound', occurredAt: iso(31) }),
    ]
    const r = facts(touchpoints)
    expect(r.whoIsWaiting).toBe('nobody')
    expect(r.waitingSince).toBeNull()
    expect(r.waitingDays).toBeNull()

    const r60 = facts(touchpoints, { weWaitingMaxDays: 60 })
    expect(r60.whoIsWaiting).toBe('we_waiting_on_customer')
    expect(r60.waitingSince).toBe(iso(31))
  })

  it('只有表单填写不算客户在等回复，且标记为从未联系过', () => {
    const r = facts([tp({ channel: 'meta_lead_form', occurredAt: iso(2) })])
    expect(r.whoIsWaiting).toBe('nobody')
    expect(r.waitingSince).toBeNull()
    expect(r.freshNeverContacted).toBe(true)
  })

  it('打开和点击邮件不算客户说话', () => {
    const r = facts([
      tp({ occurredAt: iso(10) }),
      tp({ direction: 'outbound', occurredAt: iso(8) }),
      tp({ engagement: 'open', occurredAt: iso(2) }),
      tp({ engagement: 'click', occurredAt: iso(1) }),
    ])
    expect(r.whoIsWaiting).toBe('we_waiting_on_customer')
    expect(r.waitingSince).toBe(iso(8))
  })

  it('自动群发和机器人回复不算我们的人工回复', () => {
    const r = facts([
      tp({ occurredAt: iso(5) }),
      tp({ direction: 'outbound', automated: true, occurredAt: iso(3) }),
      tp({ channel: 'messenger', direction: 'outbound', botReply: true, occurredAt: iso(2) }),
    ])
    expect(r.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(r.waitingSince).toBe(iso(5))
  })

  it('内部备注不算我们的人工回复', () => {
    const r = facts([
      tp({ occurredAt: iso(5) }),
      tp({ direction: 'outbound', internalNote: true, occurredAt: iso(3) }),
    ])
    expect(r.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(r.waitingSince).toBe(iso(5))
  })

  it('我们自己的回复被存成入站时，需要注入判断才能识别', () => {
    const touchpoints = [
      tp({ occurredAt: iso(6) }),
      tp({ occurredAt: iso(4), senderAddress: 'staff@example.test' }),
    ]

    const withPredicate = facts(touchpoints, { isOwnStaffSender: staffPredicate })
    expect(withPredicate.whoIsWaiting).toBe('we_waiting_on_customer')
    expect(withPredicate.waitingSince).toBe(iso(4))

    const withoutPredicate = facts(touchpoints)
    expect(withoutPredicate.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(withoutPredicate.waitingSince).toBe(iso(6))
  })

  it('语音留言不算我们回复了客户', () => {
    const r = facts([
      tp({ occurredAt: iso(5) }),
      tp({
        channel: 'phone',
        direction: 'outbound',
        voicemail: true,
        talkSeconds: 60,
        occurredAt: iso(3),
      }),
    ])
    expect(r.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(r.waitingSince).toBe(iso(5))
  })

  it('通话中承诺过事情，客户在等我们兑现', () => {
    const promiseCall = tp({
      channel: 'phone',
      direction: 'outbound',
      talkSeconds: 300,
      promise: true,
      occurredAt: iso(4),
    })

    const onlyPromise = facts([promiseCall])
    expect(onlyPromise.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(onlyPromise.waitingSince).toBe(iso(4))

    const withLaterEmail = facts([
      promiseCall,
      tp({ direction: 'outbound', occurredAt: iso(2) }),
    ])
    expect(withLaterEmail.whoIsWaiting).toBe('we_waiting_on_customer')
    expect(withLaterEmail.waitingSince).toBe(iso(2))

    const withLaterFailedCall = facts([
      promiseCall,
      tp({
        channel: 'phone',
        direction: 'outbound',
        unansweredCall: true,
        occurredAt: iso(2),
      }),
    ])
    expect(withLaterFailedCall.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(withLaterFailedCall.waitingSince).toBe(iso(4))
  })

  it('客户打来未接通的电话，客户在等我们回电', () => {
    const r = facts([
      tp({ channel: 'phone', talkSeconds: 0, occurredAt: iso(3) }),
    ])
    expect(r.whoIsWaiting).toBe('customer_waiting_on_us')
    expect(r.waitingSince).toBe(iso(3))
  })

  it('输入顺序不影响结果', () => {
    const touchpoints = [
      tp({ occurredAt: iso(6) }),
      tp({ direction: 'outbound', occurredAt: iso(4) }),
      tp({ occurredAt: iso(3) }),
      tp({ occurredAt: iso(2) }),
    ]
    const forward = facts(touchpoints)
    const reversed = facts([...touchpoints].reverse())
    expect(reversed.whoIsWaiting).toBe(forward.whoIsWaiting)
    expect(reversed.waitingSince).toBe(forward.waitingSince)
    expect(reversed.waitingDays).toBe(forward.waitingDays)
  })

  it('没有触点时所有字段都是空值', () => {
    const r = facts([])
    expect(r.whoIsWaiting).toBe('nobody')
    expect(r.waitingSince).toBeNull()
    expect(r.waitingDays).toBeNull()
    expect(r.lastRealHumanMessage).toBeNull()
    expect(r.consecutiveUnansweredCalls).toBe(0)
    expect(r.daysSinceOurLastHumanContactWithNoReply).toBeNull()
    expect(r.freshNeverContacted).toBe(false)
    expect(r.returningEnquirer).toBe(false)
    expect(r.returning).toBeNull()
  })
})

describe('lastRealHumanMessage', () => {
  it('取两个方向中最新的一条真实消息', () => {
    const r = facts([
      tp({ occurredAt: iso(5) }),
      tp({ direction: 'outbound', occurredAt: iso(2) }),
    ])
    expect(r.lastRealHumanMessage).not.toBeNull()
    expect(r.lastRealHumanMessage?.direction).toBe('outbound')
    expect(r.lastRealHumanMessage?.at).toBe(iso(2))
  })

  it('排除打开、群发、机器人、备注、语音留言和未接来电', () => {
    const r = facts([
      tp({ occurredAt: iso(9) }),
      tp({ engagement: 'open', occurredAt: iso(8) }),
      tp({ direction: 'outbound', automated: true, occurredAt: iso(7) }),
      tp({ channel: 'messenger', direction: 'outbound', botReply: true, occurredAt: iso(6) }),
      tp({ direction: 'outbound', internalNote: true, occurredAt: iso(5) }),
      tp({
        channel: 'phone',
        direction: 'outbound',
        voicemail: true,
        talkSeconds: 60,
        occurredAt: iso(4),
      }),
      tp({ channel: 'phone', talkSeconds: 0, occurredAt: iso(3) }),
    ])
    expect(r.lastRealHumanMessage).not.toBeNull()
    expect(r.lastRealHumanMessage?.direction).toBe('inbound')
    expect(r.lastRealHumanMessage?.at).toBe(iso(9))
    expect(r.lastRealHumanMessage?.sub).toBe('message')
  })

  it('只有自动、打开和备注时为空', () => {
    const r = facts([
      tp({ engagement: 'open', occurredAt: iso(5) }),
      tp({ direction: 'outbound', automated: true, occurredAt: iso(4) }),
      tp({ direction: 'outbound', internalNote: true, occurredAt: iso(3) }),
    ])
    expect(r.lastRealHumanMessage).toBeNull()
  })

  it('真实通话算作真实消息', () => {
    const r = facts([
      tp({
        channel: 'phone',
        direction: 'outbound',
        talkSeconds: 120,
        occurredAt: iso(2),
      }),
    ])
    expect(r.lastRealHumanMessage).not.toBeNull()
    expect(r.lastRealHumanMessage?.sub).toBe('call_talk')
    expect(r.lastRealHumanMessage?.direction).toBe('outbound')
  })
})

describe('consecutiveUnansweredCalls', () => {
  it('连续三次未接通的去电计为 3', () => {
    const r = facts([
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(5) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(4) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(3) }),
    ])
    expect(r.consecutiveUnansweredCalls).toBe(3)
  })

  it('真实通话会重置计数', () => {
    const r = facts([
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(6) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(5) }),
      tp({ channel: 'phone', direction: 'outbound', talkSeconds: 200, occurredAt: iso(4) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(3) }),
    ])
    expect(r.consecutiveUnansweredCalls).toBe(1)
  })

  it('客户发来消息会重置计数', () => {
    const r = facts([
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(6) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(5) }),
      tp({ occurredAt: iso(4) }),
    ])
    expect(r.consecutiveUnansweredCalls).toBe(0)
  })

  it('语音留言算未接通，未接通的邮件不算', () => {
    const r = facts([
      tp({
        channel: 'phone',
        direction: 'outbound',
        voicemail: true,
        talkSeconds: 60,
        occurredAt: iso(5),
      }),
      tp({ direction: 'outbound', unansweredCall: true, occurredAt: iso(4) }),
    ])
    expect(r.consecutiveUnansweredCalls).toBe(1)
  })

  it('员工记录的通话会重置计数', () => {
    const r = facts([
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(6) }),
      tp({ channel: 'phone', direction: 'outbound', outcome: 'spoke', occurredAt: iso(5) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(4) }),
    ])
    expect(r.consecutiveUnansweredCalls).toBe(1)
  })
})

describe('daysSinceOurLastHumanContactWithNoReply', () => {
  it('我们发邮件后客户没回复，返回天数', () => {
    const r = facts([tp({ direction: 'outbound', occurredAt: iso(7) })])
    expect(r.daysSinceOurLastHumanContactWithNoReply).toBe(7)
  })

  it('客户回复后返回空', () => {
    const r = facts([
      tp({ direction: 'outbound', occurredAt: iso(7) }),
      tp({ occurredAt: iso(3) }),
    ])
    expect(r.daysSinceOurLastHumanContactWithNoReply).toBeNull()
  })

  it('客户只填了表单不算回复', () => {
    const r = facts([
      tp({ direction: 'outbound', occurredAt: iso(7) }),
      tp({ channel: 'meta_lead_form', occurredAt: iso(3) }),
    ])
    expect(r.daysSinceOurLastHumanContactWithNoReply).toBe(7)
  })

  it('打开和点击不算回复', () => {
    const r = facts([
      tp({ direction: 'outbound', occurredAt: iso(7) }),
      tp({ engagement: 'open', occurredAt: iso(3) }),
      tp({ engagement: 'open', occurredAt: iso(2) }),
    ])
    expect(r.daysSinceOurLastHumanContactWithNoReply).toBe(7)
  })

  it('只有自动外联时返回空', () => {
    const r = facts([
      tp({ direction: 'outbound', automated: true, occurredAt: iso(7) }),
    ])
    expect(r.daysSinceOurLastHumanContactWithNoReply).toBeNull()
  })
})

describe('freshNeverContacted', () => {
  it('只有入站消息时为真', () => {
    const r = facts([tp({ occurredAt: iso(5) })])
    expect(r.freshNeverContacted).toBe(true)
  })

  it('入站消息加一次失败去电时为假', () => {
    const r = facts([
      tp({ occurredAt: iso(5) }),
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, occurredAt: iso(3) }),
    ])
    expect(r.freshNeverContacted).toBe(false)
  })

  it('入站消息加自动回复时仍为真', () => {
    const r = facts([
      tp({ occurredAt: iso(5) }),
      tp({ direction: 'outbound', automated: true, occurredAt: iso(3) }),
    ])
    expect(r.freshNeverContacted).toBe(true)
  })

  it('只有我们的外联时为假', () => {
    const r = facts([tp({ direction: 'outbound', occurredAt: iso(5) })])
    expect(r.freshNeverContacted).toBe(false)
  })

  it('没有触点时为假', () => {
    const r = facts([])
    expect(r.freshNeverContacted).toBe(false)
  })
})

describe('returningEnquirer', () => {
  it('两次表单之间有人工联系时算回头客', () => {
    const r = facts([
      tp({ channel: 'meta_lead_form', occurredAt: iso(30) }),
      tp({ direction: 'outbound', occurredAt: iso(25) }),
      tp({ channel: 'meta_lead_form', occurredAt: iso(2) }),
    ])
    expect(r.returningEnquirer).toBe(true)
    expect(r.returning?.earlierForms).toBe(1)
  })

  it('只有一次表单时不算回头客', () => {
    const r = facts([tp({ channel: 'meta_lead_form', occurredAt: iso(2) })])
    expect(r.returningEnquirer).toBe(false)
    expect(r.returning).toBeNull()
  })

  it('员工回复被存成入站时，需要注入判断才能识别回头客', () => {
    const touchpoints = [
      tp({ channel: 'meta_lead_form', occurredAt: iso(30) }),
      tp({ occurredAt: iso(25), senderAddress: 'staff@example.test' }),
      tp({ channel: 'meta_lead_form', occurredAt: iso(2) }),
    ]

    const withPredicate = facts(touchpoints, { isOwnStaffSender: staffPredicate })
    expect(withPredicate.returningEnquirer).toBe(true)

    const withoutPredicate = facts(touchpoints)
    expect(withoutPredicate.returningEnquirer).toBe(false)
  })

  it('群发邮件的打开不算我们的联系', () => {
    const r = facts([
      tp({ channel: 'meta_lead_form', occurredAt: iso(30) }),
      tp({ direction: 'outbound', automated: true, occurredAt: iso(25) }),
      tp({ channel: 'meta_lead_form', occurredAt: iso(2) }),
    ])
    expect(r.returningEnquirer).toBe(false)
  })
})

describe('computeEventFacts direct', () => {
  it('直接传入事件与通过触点得到相同的等待状态', () => {
    const events: HardFactEvent[] = [
      { at: iso(6), kind: 'in_human', sub: 'message', channel: 'email' },
      { at: iso(4), kind: 'out_human', sub: 'message', channel: 'email' },
    ]
    const direct = computeEventFacts(events, opts)

    const viaTouchpoints = facts([
      tp({ occurredAt: iso(6) }),
      tp({ direction: 'outbound', occurredAt: iso(4) }),
    ])

    expect(direct.whoIsWaiting).toBe('we_waiting_on_customer')
    expect(direct.whoIsWaiting).toBe(viaTouchpoints.whoIsWaiting)
    expect(direct.waitingSince).toBe(viaTouchpoints.waitingSince)
    expect(direct.waitingDays).toBe(viaTouchpoints.waitingDays)
  })
})
