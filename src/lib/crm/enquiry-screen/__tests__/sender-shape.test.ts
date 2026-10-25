import { describe, expect, it } from 'vitest'
import { registrableParts, senderShapeOf, type SenderShapeCategory } from '../sender-shape'

interface Case {
  label: string
  email: string | null
  displayName: string | null
  expected: SenderShapeCategory | null
}

const CASES: Case[] = [
  // MUST be bulk_marketing
  { label: 'mailchimp relay', email: 'anzacvn@221832422.mailchimpapp.com', displayName: null, expected: 'bulk_marketing' },
  { label: 'mcsv relay', email: 'x@mcsv.net', displayName: null, expected: 'bulk_marketing' },
  { label: 'afterpay e subdomain', email: 'hello@info.e.afterpay.com', displayName: null, expected: 'bulk_marketing' },
  { label: 'em subdomain', email: 'y@em.somebrand.co.nz', displayName: null, expected: 'bulk_marketing' },
  { label: 'news subdomain', email: 'z@news.anotherbrand.com', displayName: null, expected: 'bulk_marketing' },
  { label: 'campaign subdomain', email: 'p@campaign.shop.com.au', displayName: null, expected: 'bulk_marketing' },

  // MUST be machine_sender
  { label: 'noreply', email: 'noreply@someplatform.io', displayName: null, expected: 'machine_sender' },
  { label: 'no-reply', email: 'no-reply@bookingbot.ai', displayName: null, expected: 'machine_sender' },
  { label: 'MAILER-DAEMON', email: 'MAILER-DAEMON@mx.example.com', displayName: null, expected: 'machine_sender' },
  { label: 'notifications', email: 'notifications@app.example.com', displayName: null, expected: 'machine_sender' },
  { label: 'bounce+tag', email: 'bounce+tag@x.com', displayName: null, expected: 'machine_sender' },
  { label: 'noreply2', email: 'noreply2@foo.com', displayName: null, expected: 'machine_sender' },

  // MUST be null — confirmed false positives from the previous rule set
  { label: 'tsinghua mail prefix', email: 'zhangwei@mail.tsinghua.edu.cn', displayName: null, expected: null },
  { label: 'ncku mail prefix', email: 'lin@mail.ncku.edu.tw', displayName: null, expected: null },
  { label: 'sysu mail prefix', email: 'chen@mail.sysu.edu.cn', displayName: null, expected: null },
  { label: 'info subdomain co.nz', email: 'sue@info.smithtours.co.nz', displayName: null, expected: null },
  { label: 'mail subdomain co.nz', email: 'john@mail.kiwicoachtours.co.nz', displayName: null, expected: null },
  { label: 'm subdomain ac.nz', email: 'a@m.lincoln.ac.nz', displayName: null, expected: null },
  { label: 't govt.nz', email: 'enquiries@t.govt.nz', displayName: null, expected: null },
  { label: 'info.co.nz', email: 'hi@info.co.nz', displayName: null, expected: null },
  { label: 'news.com.au', email: 'reporter@news.com.au', displayName: null, expected: null },
  { label: 'email.com.au', email: 'b@email.com.au', displayName: null, expected: null },
  { label: 'info.govt.nz', email: 'h@info.govt.nz', displayName: null, expected: null },
  { label: 'chinatravel own domain', email: 'chinatravel@chinatravel.co.nz', displayName: null, expected: null },
  { label: 'smithfamily own domain', email: 'smithfamily@smithfamily.co.nz', displayName: null, expected: null },
  { label: 'stmarys school', email: 'stmarys@stmarys.school.nz', displayName: null, expected: null },
  { label: 'rotaryclub org.nz', email: 'rotaryclub@rotaryclub.org.nz', displayName: null, expected: null },
  { label: 'flightcentre partnerships', email: 'partnerships@flightcentre.co.nz', displayName: null, expected: null },
  { label: 'aucklandtours collab', email: 'collab@aucklandtours.co.nz', displayName: null, expected: null },
  { label: 'trip.com bd', email: 'bd@trip.com', displayName: null, expected: null },
  { label: 'jtb.co.jp biz', email: 'biz@jtb.co.jp', displayName: null, expected: null },
  { label: 'google corporate', email: 'jane.smith@google.com', displayName: null, expected: null },
  { label: 'microsoft corporate', email: 'li.wei@microsoft.com', displayName: null, expected: null },
  { label: 'meta corporate', email: 'sam@meta.com', displayName: null, expected: null },

  // MUST be null — ordinary real people / trade partners
  { label: 'gmail', email: 'jane.doe@gmail.com', displayName: 'Jane Doe', expected: null },
  { label: 'xtra', email: 'r.sgoodin@xtra.co.nz', displayName: 'R Sgoodin', expected: null },
  { label: 'tasukitravel', email: 'sales@tasukitravel.com', displayName: null, expected: null },
  { label: 'cnsst', email: 'jenny.wang@cnsst.org.nz', displayName: 'Jenny Wang', expected: null },
  { label: 'youtravelwarkworth', email: 'kerrie@youtravelwarkworth.co.nz', displayName: 'Kerrie', expected: null },
  { label: 'turistinpuglia', email: 'info@turistinpuglia.it', displayName: null, expected: null },

  // MUST be null — judgements we deliberately gave up
  { label: 'outreach local', email: 'outreach@nzingadigital.com', displayName: null, expected: null },
  { label: 'self-brand local', email: 'chajense@chajense.com', displayName: null, expected: null },
  { label: 'twilio vendor', email: 'numbers-regulatory-review@twilio.com', displayName: null, expected: null },

  // MUST be null — display name is not used to judge
  { label: 'meta business agent', email: null, displayName: 'Meta Business Agent', expected: null },
  { label: 'no email, no name', email: null, displayName: null, expected: null },
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
    const input = { email: 'noreply@someplatform.io', displayName: null }
    expect(senderShapeOf(input)).toEqual(senderShapeOf(input))
  })

  it('is pure for a null verdict too', () => {
    const input = { email: 'jane.doe@gmail.com', displayName: 'Jane Doe' }
    expect(senderShapeOf(input)).toEqual(senderShapeOf(input))
  })
})

describe('registrableParts', () => {
  it('info.e.afterpay.com → prefix [info, e], root afterpay.com', () => {
    expect(registrableParts('info.e.afterpay.com')).toEqual({
      prefixLabels: ['info', 'e'],
      root: 'afterpay.com',
    })
  })

  it('info.co.nz → prefix [], root info.co.nz', () => {
    expect(registrableParts('info.co.nz')).toEqual({
      prefixLabels: [],
      root: 'info.co.nz',
    })
  })

  it('mail.tsinghua.edu.cn → prefix [mail], root tsinghua.edu.cn', () => {
    expect(registrableParts('mail.tsinghua.edu.cn')).toEqual({
      prefixLabels: ['mail'],
      root: 'tsinghua.edu.cn',
    })
  })

  it('gmail.com → prefix [], root gmail.com', () => {
    expect(registrableParts('gmail.com')).toEqual({
      prefixLabels: [],
      root: 'gmail.com',
    })
  })

  it('a.b.c.co.uk → prefix [a, b], root c.co.uk', () => {
    expect(registrableParts('a.b.c.co.uk')).toEqual({
      prefixLabels: ['a', 'b'],
      root: 'c.co.uk',
    })
  })
})
