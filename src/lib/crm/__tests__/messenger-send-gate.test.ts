import { describe, expect, it } from 'vitest'
import { evaluateMessengerSendGate } from '../messenger-send-gate'

const BASE = {
  clientId: 'client-1',
  contactId: 'contact-1',
  contactFlag: false,
  touches: [],
  inboundMessages: [],
}

describe('evaluateMessengerSendGate', () => {
  it('allows an ordinary inbound conversation', () => {
    expect(
      evaluateMessengerSendGate({
        ...BASE,
        inboundMessages: [{ id: 'm1', body: 'Can you send the itinerary?', sent_at: '2026-08-20T00:00:00Z' }],
      }),
    ).toEqual({ kind: 'allow' })
  })

  it('blocks an existing DNC verdict', () => {
    expect(
      evaluateMessengerSendGate({
        ...BASE,
        touches: [{
          id: 't1',
          occurred_at: '2026-08-20T00:00:00Z',
          source: 'me_manual',
          metadata: { outcome: 'do_not_contact', do_not_contact: true },
        }],
      }),
    ).toEqual({ kind: 'do_not_contact' })
  })

  it('routes an unresolved inbound stop request to review instead of sending', () => {
    expect(
      evaluateMessengerSendGate({
        ...BASE,
        inboundMessages: [{ id: 'm1', body: 'do not follow up', sent_at: '2026-08-20T00:00:00Z' }],
      }),
    ).toEqual({ kind: 'review_required', quote: 'do not follow up' })
  })

  it('allows after a later human review touchpoint', () => {
    expect(
      evaluateMessengerSendGate({
        ...BASE,
        inboundMessages: [{ id: 'm1', body: 'do not follow up', sent_at: '2026-08-20T00:00:00Z' }],
        touches: [{
          id: 't1',
          occurred_at: '2026-08-21T00:00:00Z',
          source: 'me_manual',
          metadata: { outcome: 'spoke' },
        }],
      }),
    ).toEqual({ kind: 'allow' })
  })

  it('honours dnc_cleared as the latest verdict', () => {
    expect(
      evaluateMessengerSendGate({
        ...BASE,
        contactFlag: true,
        inboundMessages: [{ id: 'm1', body: 'do not follow up', sent_at: '2026-08-20T00:00:00Z' }],
        touches: [
          {
            id: 't1',
            occurred_at: '2026-08-20T00:00:00Z',
            source: 'messenger',
            metadata: { outcome: 'do_not_contact', do_not_contact: true },
          },
          {
            id: 't2',
            occurred_at: '2026-08-21T00:00:00Z',
            source: 'me_manual',
            metadata: { outcome: 'dnc_cleared', do_not_contact: false },
          },
        ],
      }),
    ).toEqual({ kind: 'allow' })
  })
})
