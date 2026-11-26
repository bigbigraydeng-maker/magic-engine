// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CRM_PROVIDER_EVENT_RECEIVED, buildProviderEventReceived, parseProviderEventReceived } from '../events'

describe('crm.provider_event.received', () => {
  it('is keyed by the provider event id (Inngest runs the consumer once per receipt) and carries no personal data', () => {
    const event = buildProviderEventReceived({ account: 'system', providerEventId: 'msg_2abc' })
    expect(event).toEqual({
      id: 'provider_event:resend:system:msg_2abc',
      name: CRM_PROVIDER_EVENT_RECEIVED,
      data: { provider: 'resend', account: 'system', provider_event_id: 'msg_2abc' },
    })
    expect(parseProviderEventReceived(event.data)).toEqual({ ok: true, provider: 'resend', account: 'system', providerEventId: 'msg_2abc' })
  })

  it('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      [],
      'x',
      { provider: 'mailchimp', account: 'system', provider_event_id: 'msg_1' },
      { provider: 'resend', account: 'System', provider_event_id: 'msg_1' },
      { provider: 'resend', account: 'system', provider_event_id: 'msg 1' },
      { provider: 'resend', account: 'system', provider_event_id: 'x'.repeat(201) },
      { provider: 'resend', account: 'system' },
    ]
    for (const data of bad) expect(parseProviderEventReceived(data).ok).toBe(false)
  })
})
