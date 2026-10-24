import { describe, expect, it } from 'vitest'
import { senderShapeOf, type SenderShapeCategory } from '../sender-shape'

interface Case {
  label: string
  email: string | null
  displayName: string | null
  expected: SenderShapeCategory | null
}

const CASES: Case[] = [
  // vendor_notice
  { label: 'twilio regulatory', email: 'numbers-regulatory-review@twilio.com', displayName: null, expected: 'vendor_notice' },
  { label: 'afterpay subdomain', email: 'hello@info.e.afterpay.com', displayName: null, expected: 'vendor_notice' },
  { label: 'microsoft billing', email: 'billing@microsoft.com', displayName: null, expected: 'vendor_notice' },
  { label: 'testflight apple', email: 'noreply@testflight.apple.com', displayName: null, expected: 'vendor_notice' },

  // bulk_marketing
  { label: 'mailchimp relay', email: 'anzacvn@221832422.mailchimpapp.com', displayName: null, expected: 'bulk_marketing' },
  { label: 'mail subdomain', email: 'x@mail.grokbot.com', displayName: null, expected: 'bulk_marketing' },
  { label: 'em subdomain', email: 'y@em.somebrand.co.nz', displayName: null, expected: 'bulk_marketing' },
  { label: 'news subdomain', email: 'z@news.anotherbrand.com', displayName: null, expected: 'bulk_marketing' },

  // cold_outreach
  { label: 'outreach local', email: 'outreach@nzingadigital.com', displayName: null, expected: 'cold_outreach' },
  { label: 'link-building local', email: 'link-building@agency.io', displayName: null, expected: 'cold_outreach' },
  { label: 'self-brand local', email: 'chajense@chajense.com', displayName: null, expected: 'cold_outreach' },

  // system_account
  { label: 'meta business agent', email: null, displayName: 'Meta Business Agent', expected: 'system_account' },
  { label: 'meta platform testflight', email: null, displayName: 'Meta Platform,lnc. via TestFlight', expected: 'system_account' },
  { label: 'microsoft name', email: null, displayName: 'Microsoft', expected: 'system_account' },
  { label: 'facebook user cn', email: null, displayName: 'Facebook 用户', expected: 'system_account' },
  { label: 'whatsapp business', email: null, displayName: 'WhatsApp Business', expected: 'system_account' },

  // null — real people / real trade partners
  { label: 'gmail', email: 'jane.doe@gmail.com', displayName: 'Jane Doe', expected: null },
  { label: 'xtra', email: 'r.sgoodin@xtra.co.nz', displayName: 'R Sgoodin', expected: null },
  { label: 'tasukitravel', email: 'sales@tasukitravel.com', displayName: null, expected: null },
  { label: 'cnsst', email: 'jenny.wang@cnsst.org.nz', displayName: 'Jenny Wang', expected: null },
  { label: 'youtravelwarkworth', email: 'kerrie@youtravelwarkworth.co.nz', displayName: 'Kerrie', expected: null },
  { label: 'turistinpuglia', email: 'info@turistinpuglia.it', displayName: null, expected: null },
  { label: 'invisibleinc', email: 'pauline@invisibleinc.co.nz', displayName: 'Pauline', expected: null },
  { label: 'eduvel', email: 'd.tanaka@eduvel.jp', displayName: 'D Tanaka', expected: null },
  { label: 'protonmail', email: 'ethancaldwell42@protonmail.com', displayName: 'Ethan Caldwell', expected: null },
  { label: 'hotmail', email: 'fairyofautumn@hotmail.com', displayName: null, expected: null },
  { label: 'gmail numeric', email: 'ailikemua44@gmail.com', displayName: null, expected: null },
  { label: 'no email, name only', email: null, displayName: 'Sharyn Goodin', expected: null },
  { label: 'no email, no name', email: null, displayName: null, expected: null },
  { label: 'www not a bulk label', email: 'bob@www.example.com', displayName: 'Bob', expected: null },
  { label: 'chinatravel own domain', email: 'ray@chinatravel.co.nz', displayName: 'Ray', expected: null },
]

describe('senderShapeOf', () => {
  it.each(CASES)('$label → $expected', ({ email, displayName, expected }) => {
    const verdict = senderShapeOf({ email, displayName })
    if (expected === null) {
      expect(verdict).toBeNull()
    } else {
      expect(verdict).not.toBeNull()
      expect(verdict?.category).toBe(expected)
      expect(typeof verdict?.reason).toBe('string')
      expect(verdict?.reason.length).toBeGreaterThan(0)
    }
  })

  it('is pure: same input yields an equal verdict', () => {
    const input = { email: 'outreach@nzingadigital.com', displayName: null }
    expect(senderShapeOf(input)).toEqual(senderShapeOf(input))
  })

  it('is pure for a null verdict too', () => {
    const input = { email: 'jane.doe@gmail.com', displayName: 'Jane Doe' }
    expect(senderShapeOf(input)).toEqual(senderShapeOf(input))
  })
})
