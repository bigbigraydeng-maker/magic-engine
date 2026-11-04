import { describe, expect, it } from 'vitest'
import { classifyTouchpoint, normaliseDirection } from '../events'
import type { HardFactsTouchpoint } from '../types'

function tp(over: Partial<HardFactsTouchpoint> = {}): HardFactsTouchpoint {
  return { channel: 'email', direction: 'inbound', occurredAt: '2026-10-01T00:00:00Z', ...over }
}

describe('classifyTouchpoint', () => {
  it('内部备注归为 note', () => {
    const inbound = classifyTouchpoint(tp({ internalNote: true }))
    expect(inbound?.kind).toBe('note')
    expect(inbound?.sub).toBe('other')

    const outbound = classifyTouchpoint(tp({ direction: 'outbound', internalNote: true }))
    expect(outbound?.kind).toBe('note')
    expect(outbound?.sub).toBe('other')
  })

  it('snooze 和 unsnooze 动作归为 note', () => {
    const snooze = classifyTouchpoint(tp({ action: 'snooze' }))
    expect(snooze?.kind).toBe('note')
    expect(snooze?.sub).toBe('other')

    const unsnooze = classifyTouchpoint(tp({ action: 'unsnooze' }))
    expect(unsnooze?.kind).toBe('note')
    expect(unsnooze?.sub).toBe('other')
  })

  it('邮件打开和点击归为 engagement', () => {
    const open = classifyTouchpoint(tp({ engagement: 'open' }))
    expect(open?.kind).toBe('engagement')
    expect(open?.sub).toBe('other')

    const click = classifyTouchpoint(tp({ direction: 'outbound', engagement: 'click' }))
    expect(click?.kind).toBe('engagement')
    expect(click?.sub).toBe('other')
  })

  it('自动消息归为 out_auto', () => {
    const outboundAutomated = classifyTouchpoint(tp({ direction: 'outbound', automated: true }))
    expect(outboundAutomated?.kind).toBe('out_auto')
    expect(outboundAutomated?.sub).toBe('other')

    const outboundBot = classifyTouchpoint(
      tp({ direction: 'outbound', channel: 'messenger', botReply: true }),
    )
    expect(outboundBot?.kind).toBe('out_auto')
    expect(outboundBot?.sub).toBe('other')

    const inboundAutomated = classifyTouchpoint(tp({ automated: true }))
    expect(inboundAutomated?.kind).toBe('out_auto')
    expect(inboundAutomated?.sub).toBe('other')

    const inboundBot = classifyTouchpoint(tp({ botReply: true }))
    expect(inboundBot?.kind).toBe('out_auto')
    expect(inboundBot?.sub).toBe('other')
  })

  it('普通邮件按方向分类', () => {
    const inbound = classifyTouchpoint(tp())
    expect(inbound?.kind).toBe('in_human')
    expect(inbound?.sub).toBe('message')

    const outbound = classifyTouchpoint(tp({ direction: 'outbound' }))
    expect(outbound?.kind).toBe('out_human')
    expect(outbound?.sub).toBe('message')
  })

  it('方向存错时用 isOwnStaffSender 纠正', () => {
    const touchpoint = tp({ senderAddress: 'staff@example.test' })

    const corrected = classifyTouchpoint(touchpoint, {
      isOwnStaffSender: (t) => t.senderAddress === 'staff@example.test',
    })
    expect(corrected?.kind).toBe('out_human')
    expect(corrected?.sub).toBe('message')

    const notStaff = classifyTouchpoint(touchpoint, {
      isOwnStaffSender: () => false,
    })
    expect(notStaff?.kind).toBe('in_human')
    expect(notStaff?.sub).toBe('message')

    const noPredicate = classifyTouchpoint(touchpoint)
    expect(noPredicate?.kind).toBe('in_human')
    expect(noPredicate?.sub).toBe('message')
  })

  it('入站表单归为 in_human/form，出站表单只是普通消息', () => {
    const metaForm = classifyTouchpoint(tp({ channel: 'meta_lead_form' }))
    expect(metaForm?.kind).toBe('in_human')
    expect(metaForm?.sub).toBe('form')

    const webForm = classifyTouchpoint(tp({ channel: 'web_form' }))
    expect(webForm?.kind).toBe('in_human')
    expect(webForm?.sub).toBe('form')

    const outboundForm = classifyTouchpoint(tp({ channel: 'web_form', direction: 'outbound' }))
    expect(outboundForm?.kind).toBe('out_human')
    expect(outboundForm?.sub).toBe('message')
  })

  it('出站电话按通话时长和结果分类', () => {
    const unanswered = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true }),
    )
    expect(unanswered?.kind).toBe('out_attempt')
    expect(unanswered?.sub).toBe('other')

    const voicemail = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', voicemail: true, talkSeconds: 120 }),
    )
    expect(voicemail?.kind).toBe('out_attempt')
    expect(voicemail?.sub).toBe('other')

    const shortTalk = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', talkSeconds: 29 }),
    )
    expect(shortTalk?.kind).toBe('out_attempt')
    expect(shortTalk?.sub).toBe('other')

    const enoughTalk = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', talkSeconds: 30 }),
    )
    expect(enoughTalk?.kind).toBe('out_human')
    expect(enoughTalk?.sub).toBe('call_talk')

    const customThreshold = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', talkSeconds: 15 }),
      { minCallTalkSeconds: 10 },
    )
    expect(customThreshold?.kind).toBe('out_human')
    expect(customThreshold?.sub).toBe('call_talk')

    const loggedContact = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', outcome: 'spoke' }),
    )
    expect(loggedContact?.kind).toBe('out_human')
    expect(loggedContact?.sub).toBe('logged_contact')

    const spokeButUnanswered = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', outcome: 'spoke', unansweredCall: true }),
    )
    expect(spokeButUnanswered?.kind).toBe('out_attempt')
    expect(spokeButUnanswered?.sub).toBe('other')

    const spokeButVoicemail = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', outcome: 'spoke', voicemail: true }),
    )
    expect(spokeButVoicemail?.kind).toBe('out_attempt')
    expect(spokeButVoicemail?.sub).toBe('other')

    const spokeButShort = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', outcome: 'spoke', talkSeconds: 5 }),
    )
    expect(spokeButShort?.kind).toBe('out_attempt')
    expect(spokeButShort?.sub).toBe('other')
  })

  it('出站电话的 promise 只在真实通话时保留', () => {
    const realTalk = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', talkSeconds: 60, promise: true }),
    )
    expect(realTalk?.kind).toBe('out_human')
    expect(realTalk?.sub).toBe('call_talk')
    expect(realTalk?.promise).toBe(true)

    const attempt = classifyTouchpoint(
      tp({ channel: 'phone', direction: 'outbound', unansweredCall: true, promise: true }),
    )
    expect(attempt?.kind).toBe('out_attempt')
    expect(attempt?.promise).toBeUndefined()
  })

  it('入站电话按是否真正通话分类', () => {
    const missed = classifyTouchpoint(tp({ channel: 'phone', talkSeconds: 0 }))
    expect(missed?.kind).toBe('in_human')
    expect(missed?.sub).toBe('missed_call')

    const talked = classifyTouchpoint(tp({ channel: 'phone', talkSeconds: 90 }))
    expect(talked?.kind).toBe('in_human')
    expect(talked?.sub).toBe('call_talk')

    const voicemail = classifyTouchpoint(
      tp({ channel: 'phone', talkSeconds: 90, voicemail: true }),
    )
    expect(voicemail?.kind).toBe('in_human')
    expect(voicemail?.sub).toBe('missed_call')
  })

  it('无效时间戳返回 null', () => {
    const result = classifyTouchpoint(tp({ occurredAt: 'not-a-date' }))
    expect(result).toBeNull()
  })

  it('channel 和 at 原样保留', () => {
    const result = classifyTouchpoint(
      tp({ channel: 'messenger', occurredAt: '2026-10-02T12:34:56Z' }),
    )
    expect(result?.channel).toBe('messenger')
    expect(result?.at).toBe('2026-10-02T12:34:56Z')
  })
})

describe('normaliseDirection', () => {
  it('入站且判定为自家员工时改为出站且不修改原对象', () => {
    const original = tp({ senderAddress: 'staff@example.test' })
    const result = normaliseDirection(original, {
      isOwnStaffSender: (t) => t.senderAddress === 'staff@example.test',
    })
    expect(result.direction).toBe('outbound')
    expect(result).not.toBe(original)
    expect(original.direction).toBe('inbound')
  })

  it('入站但判定不是自家员工时返回同一引用', () => {
    const original = tp({ senderAddress: 'staff@example.test' })
    const result = normaliseDirection(original, { isOwnStaffSender: () => false })
    expect(result).toBe(original)
  })

  it('出站时返回同一引用', () => {
    const original = tp({ direction: 'outbound' })
    const result = normaliseDirection(original, {
      isOwnStaffSender: () => true,
    })
    expect(result).toBe(original)
  })

  it('没有判定函数时返回同一引用', () => {
    const original = tp({ senderAddress: 'staff@example.test' })
    const result = normaliseDirection(original, {})
    expect(result).toBe(original)
  })
})
