import { describe, expect, it } from 'vitest'
import { hasEnquiryRecord } from '@/lib/crm/email-compose/enquiry-record'

describe('hasEnquiryRecord and phone calls', () => {
  it('an inbound VoIPLine call is an enquiry (a guest who only phoned us is not "never enquired")', () => {
    expect(hasEnquiryRecord([{ channel: 'phone', source: 'voipline', direction: 'inbound' }])).toBe(true)
  })

  it('the existing Twilio inbound source still counts', () => {
    expect(hasEnquiryRecord([{ channel: 'phone', source: 'twilio', direction: 'inbound' }])).toBe(true)
  })

  it('an OUTBOUND call does not make someone an enquirer', () => {
    expect(hasEnquiryRecord([{ channel: 'phone', source: 'voipline', direction: 'outbound' }])).toBe(false)
    expect(hasEnquiryRecord([{ channel: 'phone', source: 'twilio', direction: 'outbound' }])).toBe(false)
  })

  it('a typed note (me_manual) never counts, in either direction', () => {
    expect(hasEnquiryRecord([{ channel: 'phone', source: 'me_manual', direction: 'inbound' }])).toBe(false)
    expect(hasEnquiryRecord([{ channel: 'phone', source: 'me_manual', direction: 'outbound' }])).toBe(false)
  })
})
