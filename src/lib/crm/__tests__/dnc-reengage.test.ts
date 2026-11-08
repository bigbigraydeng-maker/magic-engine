import { describe, it, expect } from 'vitest'
import { decideReengageClear, SAME_CONVERSATION_MS, type ReengageInput, type ReengageTouch, type ReengageMessage } from '../dnc-reengage'

const T0 = '2026-10-01T00:00:00.000Z'
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString()
}

function touch(over: Partial<ReengageTouch> & { id: string }): ReengageTouch {
  return {
    source: null,
    channel: 'phone',
    direction: 'inbound',
    occurredAt: T0,
    ...over,
  }
}

function verdict(id = 'v1', occurredAt = T0): ReengageTouch {
  return touch({
    id,
    direction: 'outbound',
    channel: 'phone',
    source: 'me_manual',
    outcome: 'do_not_contact',
    occurredAt,
  })
}

function msg(
  id: string,
  sentAt: string,
  body: string | null,
  channel: 'messenger' | 'whatsapp' = 'messenger',
): ReengageMessage {
  return { id, channel, sentAt, body }
}

function input(over: Partial<ReengageInput>): ReengageInput {
  return {
    asOf: '2027-01-01T00:00:00.000Z',
    contactFlag: true,
    reason: null,
    touches: [],
    inboundMessages: [],
    ...over,
  }
}

describe('decideReengageClear', () => {
  it('1. not_dnc when contact is not flagged', () => {
    const decision = decideReengageClear(input({ contactFlag: false }))
    expect(decision).toEqual({ clear: false, why: 'not_dnc' })
  })

  it('2. not_a_customer when reason matches NOT_A_CUSTOMER', () => {
    const decision = decideReengageClear(
      input({
        reason: '假冒 Meta 的钓鱼私信',
        touches: [verdict(), touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY) })],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'not_a_customer' })
  })

  it('3. same-conversation message within 30 minutes does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [verdict()],
        inboundMessages: [msg('m1', at(10 * MIN), 'ok thanks')],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('4. boundary: exactly at cutoff does not count, 1s after goes to review', () => {
    const atCutoff = decideReengageClear(
      input({
        touches: [verdict()],
        inboundMessages: [msg('m1', at(SAME_CONVERSATION_MS), 'hello')],
      }),
    )
    expect(atCutoff).toEqual({ clear: false, why: 'no_reengage' })

    const afterCutoff = decideReengageClear(
      input({
        touches: [verdict()],
        inboundMessages: [msg('m1', at(SAME_CONVERSATION_MS + 1000), 'hello')],
      }),
    )
    expect(afterCutoff).toEqual({
      clear: false,
      why: 'needs_review',
      dncAt: T0,
      trigger: { kind: 'message', ref: 'm1', at: at(SAME_CONVERSATION_MS + 1000), channel: 'messenger' },
    })
  })

  it('5. real inbound message 2h after verdict is listed for review, never auto-cleared', () => {
    const decision = decideReengageClear(
      input({
        touches: [verdict()],
        inboundMessages: [msg('m1', at(2 * HOUR), 'Hi, is the Japan tour still available?')],
      }),
    )
    expect(decision).toEqual({
      clear: false,
      why: 'needs_review',
      dncAt: T0,
      trigger: { kind: 'message', ref: 'm1', at: at(2 * HOUR), channel: 'messenger' },
    })
  })

  it('6. Mailchimp email does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [verdict(), touch({ id: 'e1', channel: 'email', source: 'mailchimp', occurredAt: at(DAY) })],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('7. auto-reply email does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({
            id: 'e1',
            channel: 'email',
            source: 'microsoft_mail',
            subject: 'Automatic reply: your enquiry',
            occurredAt: at(DAY),
          }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('8. automated email does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({
            id: 'e1',
            channel: 'email',
            source: 'microsoft_mail',
            subject: 'Re: tour',
            automated: true,
            occurredAt: at(DAY),
          }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('9. stop email does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({
            id: 'e1',
            channel: 'email',
            source: 'microsoft_mail',
            subject: 'Re: tour',
            body: 'Do not follow up please',
            occurredAt: at(DAY),
          }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('10. real email reply is listed for review, never auto-cleared', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({
            id: 'e1',
            channel: 'email',
            source: 'microsoft_mail',
            subject: 'Re: tour',
            body: 'Can you send the itinerary?',
            occurredAt: at(DAY),
          }),
        ],
      }),
    )
    expect(decision).toEqual({
      clear: false,
      why: 'needs_review',
      dncAt: T0,
      trigger: { kind: 'email', ref: 'e1', at: at(DAY), channel: 'email' },
    })
  })

  it('11. meta lead form clears', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({
      clear: true,
      dncAt: T0,
      dncAtSource: 'touch',
      trigger: { kind: 'form', ref: 'f1', at: at(DAY), channel: 'meta_lead_form' },
    })
  })

  it('12. website form is review-only (public endpoint, anyone can post a phone/email)', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({ id: 'w1', channel: 'web_form', source: 'some_site', occurredAt: at(DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({
      clear: false,
      why: 'needs_review',
      dncAt: T0,
      trigger: { kind: 'web_form', ref: 'w1', at: at(DAY), channel: 'web_form' },
    })
  })

  it('13. answered inbound call clears, inbound phone from me_manual does not', () => {
    const call = decideReengageClear(
      input({
        touches: [verdict(), touch({ id: 'c1', channel: 'phone', source: 'twilio', outcome: 'spoke', talkSeconds: 28, occurredAt: at(DAY) })],
      }),
    )
    expect(call).toEqual({
      clear: true,
      dncAt: T0,
      dncAtSource: 'touch',
      trigger: { kind: 'inbound_call', ref: 'c1', at: at(DAY), channel: 'phone' },
    })

    const manual = decideReengageClear(
      input({
        touches: [verdict(), touch({ id: 'c2', channel: 'phone', source: 'me_manual', occurredAt: at(DAY) })],
      }),
    )
    expect(manual).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('14. outbound touches never count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({
            id: 'f1',
            channel: 'meta_lead_form',
            source: 'meta_lead_form',
            direction: 'outbound',
            occurredAt: at(DAY),
          }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('15. messenger touch (not message) does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({ id: 't1', channel: 'messenger', source: 'messenger', occurredAt: at(DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('16. column-only with no touches or messages has no verdict time', () => {
    const decision = decideReengageClear(input({ contactFlag: true }))
    expect(decision).toEqual({ clear: false, why: 'no_verdict_time' })
  })

  it('17. column-only + stop message: form clears with stop_message source', () => {
    const decision = decideReengageClear(
      input({
        touches: [touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY) })],
        inboundMessages: [msg('s1', T0, '别再联系我了')],
      }),
    )
    expect(decision).toEqual({
      clear: true,
      dncAt: T0,
      dncAtSource: 'stop_message',
      trigger: { kind: 'form', ref: 'f1', at: at(DAY), channel: 'meta_lead_form' },
    })
  })

  it('18. column-only + stop message: later DM does not count', () => {
    const decision = decideReengageClear(
      input({
        inboundMessages: [msg('s1', T0, '别再联系我了'), msg('m1', at(2 * HOUR), 'hello again')],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('19. column-only + stop message: later real email does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          touch({
            id: 'e1',
            channel: 'email',
            source: 'microsoft_mail',
            subject: 'Re: tour',
            body: 'Can you send the itinerary?',
            occurredAt: at(DAY),
          }),
        ],
        inboundMessages: [msg('s1', T0, '别再联系我了')],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('20. form before verdict does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(-DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('21. already cleared by a human is not_dnc', () => {
    const decision = decideReengageClear(
      input({
        contactFlag: true,
        touches: [
          verdict(),
          touch({ id: 'x', direction: 'outbound', outcome: 'dnc_cleared', occurredAt: at(HOUR) }),
          touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'not_dnc' })
  })

  it('22. re-flagged after a clear uses the latest verdict', () => {
    const base: ReengageTouch[] = [
      verdict('v1', T0),
      touch({ id: 'x', direction: 'outbound', outcome: 'dnc_cleared', occurredAt: at(HOUR) }),
      verdict('v2', at(2 * DAY)),
    ]

    const before = decideReengageClear(
      input({
        touches: [...base, touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY) })],
      }),
    )
    expect(before).toEqual({ clear: false, why: 'no_reengage' })

    const after = decideReengageClear(
      input({
        touches: [...base, touch({ id: 'f2', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(3 * DAY) })],
      }),
    )
    expect(after).toEqual({
      clear: true,
      dncAt: at(2 * DAY),
      dncAtSource: 'touch',
      trigger: { kind: 'form', ref: 'f2', at: at(3 * DAY), channel: 'meta_lead_form' },
    })
  })

  it('23. flagged touch counts as verdict', () => {
    const decision = decideReengageClear(
      input({
        contactFlag: false,
        touches: [
          touch({
            id: 'v',
            direction: 'inbound',
            channel: 'email',
            source: 'microsoft_mail',
            flagged: true,
            occurredAt: T0,
          }),
          touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({
      clear: true,
      dncAt: T0,
      dncAtSource: 'touch',
      trigger: { kind: 'form', ref: 'f1', at: at(DAY), channel: 'meta_lead_form' },
    })
  })

  it('24. an auto kind (form) wins over earlier DM/email; earliest auto wins', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          verdict(),
          touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(3 * DAY) }),
          touch({ id: 'f2', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(4 * DAY) }),
          touch({
            id: 'e1',
            channel: 'email',
            source: 'microsoft_mail',
            subject: 'Re: tour',
            body: 'Can you send the itinerary?',
            occurredAt: at(2 * DAY),
          }),
        ],
        inboundMessages: [msg('m1', at(DAY), 'hello again')],
      }),
    )
    expect(decision).toEqual({
      clear: true,
      dncAt: T0,
      dncAtSource: 'touch',
      trigger: { kind: 'form', ref: 'f1', at: at(3 * DAY), channel: 'meta_lead_form' },
    })
  })

  it('25. empty or whitespace message body does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [verdict()],
        inboundMessages: [msg('m1', at(DAY), '   '), msg('m2', at(DAY), null)],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('26. stop message after verdict does not count', () => {
    const decision = decideReengageClear(
      input({
        touches: [verdict()],
        inboundMessages: [msg('m1', at(DAY), '别再联系我了')],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it.each(['STOP', 'Unsubscribe', 'please stop contacting me', "Don't email me again", 'not interested thanks'])(
    '27. English stop phrase "%s" after verdict does not count (message and email)',
    (phrase) => {
      const viaMessage = decideReengageClear(
        input({ touches: [verdict()], inboundMessages: [msg('m1', at(DAY), phrase)] }),
      )
      expect(viaMessage).toEqual({ clear: false, why: 'no_reengage' })

      const viaEmail = decideReengageClear(
        input({
          touches: [
            verdict(),
            touch({ id: 'e1', channel: 'email', source: 'microsoft_mail', occurredAt: at(DAY), subject: 'Re: hi', body: phrase }),
          ],
        }),
      )
      expect(viaEmail).toEqual({ clear: false, why: 'no_reengage' })
    },
  )

  it('29. a later stop message moves the verdict: friendly DM before it does not clear', () => {
    const decision = decideReengageClear(
      input({
        contactFlag: false,
        touches: [verdict('v1', T0)],
        inboundMessages: [
          msg('m1', at(3 * HOUR), "Thanks. I'll phone you when I get home in November."),
          msg('m2', at(5 * HOUR), 'Unsubscribe'),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('30. a later stop message moves the verdict: a real DM after it goes to review', () => {
    const decision = decideReengageClear(
      input({
        touches: [verdict('v1', T0)],
        inboundMessages: [msg('m2', at(5 * HOUR), 'Unsubscribe'), msg('m3', at(10 * DAY), 'Is May still open?')],
      }),
    )
    expect(decision).toMatchObject({ clear: false, why: 'needs_review', dncAt: at(5 * HOUR), trigger: { ref: 'm3' } })
  })

  it('28. ordinary English reply goes to review (not swallowed by the stop list)', () => {
    const decision = decideReengageClear(
      input({ touches: [verdict()], inboundMessages: [msg('m1', at(DAY), 'Hi, is the May tour still available?')] }),
    )
    expect(decision).toMatchObject({ clear: false, why: 'needs_review' })
  })

  it.each([
    ['missed', { outcome: 'missed_inbound', talkSeconds: 40 }],
    ['too short', { outcome: 'spoke', talkSeconds: 14 }],
    ['no duration', { outcome: 'spoke', talkSeconds: null }],
  ])('31. inbound call that was %s does not count', (_label, over) => {
    const decision = decideReengageClear(
      input({ touches: [verdict(), touch({ id: 'c1', channel: 'phone', source: 'twilio', occurredAt: at(DAY), ...over })] }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('32. form opt-out verdict is never lifted by a later form (contract 5426843158)', () => {
    const decision = decideReengageClear(
      input({
        touches: [
          touch({ id: 'o1', channel: 'meta_lead_form', source: 'meta_lead_form', flagged: true, occurredAt: T0 }),
          touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(10 * DAY) }),
        ],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'form_opt_out' })
  })

  it('33. hostile DM the stop list misses is review-only, never cleared', () => {
    const decision = decideReengageClear(
      input({ touches: [verdict()], inboundMessages: [msg('m1', at(DAY), 'Why are you still messaging me')] }),
    )
    expect(decision.clear).toBe(false)
  })

  it('34. a form dated in the future (client-controlled time) is ignored', () => {
    const decision = decideReengageClear(
      input({
        asOf: at(DAY),
        touches: [verdict(), touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY + HOUR) })],
      }),
    )
    expect(decision).toEqual({ clear: false, why: 'no_reengage' })
  })

  it('35. a form a few minutes "ahead" (clock skew within tolerance) still counts', () => {
    const decision = decideReengageClear(
      input({
        asOf: at(DAY),
        touches: [verdict(), touch({ id: 'f1', channel: 'meta_lead_form', source: 'meta_lead_form', occurredAt: at(DAY + 2 * MIN) })],
      }),
    )
    expect(decision.clear).toBe(true)
  })
})
