import { describe, expect, it } from 'vitest'
import {
  isFormNoticeCandidate,
  parseFormNotice,
  type FormNoticeInput,
} from '../mail-form-notice'

function goodInput(): FormNoticeInput {
  const body = [
    'New message — Contact form (Example site)',
    'Name\tJane Test',
    'Email\tjane.test@example.com',
    'Phone\t0211234567',
    'Travel interest\tCustom Itinerary',
    'Submitted\t2026-10-19T01:29:17.009Z',
    'Form URL\t/contact<https://www.example.co.nz/contact>',
    'First landing page\t/contact',
    '',
    'Message',
    '',
    'hello there',
  ].join('\n')

  return {
    ownDomains: ['example.co.nz'],
    replyTo: ['jane.test@example.com'],
    headers: [
      {
        name: 'Authentication-Results',
        value:
          'mx.example 1; spf=pass smtp.mailfrom=send.example.co.nz; dkim=pass header.d=example.co.nz; dmarc=pass action=none header.from=example.co.nz; compauth=pass',
      },
      {
        name: 'DKIM-Signature',
        value:
          'v=1; a=rsa-sha256; q=dns/txt; c=relaxed/simple; s=resend;\td=example.co.nz; t=1; h=From:To',
      },
    ],
    body,
  }
}

describe('isFormNoticeCandidate', () => {
  it('accepts inbound self-sent contact form subject', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'inbound',
        subject: 'Contact form: X — Jane',
        fromAddress: 'info@example.co.nz',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(true)
  })

  it('is case/whitespace insensitive on addresses', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'inbound',
        subject: '  contact form: X  ',
        fromAddress: '  Info@Example.co.nz ',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(true)
  })

  it('rejects Re: prefix', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'inbound',
        subject: 'Re: Contact form: X',
        fromAddress: 'info@example.co.nz',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(false)
  })

  it('rejects Fwd: prefix', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'inbound',
        subject: 'Fwd: Contact form: X',
        fromAddress: 'info@example.co.nz',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(false)
  })

  it('rejects outbound direction', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'outbound',
        subject: 'Contact form: X',
        fromAddress: 'info@example.co.nz',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(false)
  })

  it('rejects other sender', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'inbound',
        subject: 'Contact form: X',
        fromAddress: 'someone@example.com',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(false)
  })

  it('rejects other subject', () => {
    expect(
      isFormNoticeCandidate({
        direction: 'inbound',
        subject: 'Hello there',
        fromAddress: 'info@example.co.nz',
        mailbox: 'info@example.co.nz',
      }),
    ).toBe(false)
  })
})

describe('parseFormNotice', () => {
  it('parses a valid notice', () => {
    const result = parseFormNotice(goodInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead).toEqual({
      kind: 'contact_form',
      email: 'jane.test@example.com',
      name: 'Jane Test',
      phone: '0211234567',
      interest: 'Custom Itinerary',
      message: 'hello there',
      submittedAt: '2026-10-19T01:29:17.009Z',
      formUrl: '/contact',
    })
  })

  it('fails with bad_marker when first line is wrong', () => {
    const input = goodInput()
    input.body = input.body.replace('New message — Contact form', 'Hello')
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'bad_marker',
    })
  })

  it('fails with reply_to_count when two reply-to addresses', () => {
    const input = goodInput()
    input.replyTo = ['jane.test@example.com', 'other@example.com']
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'reply_to_count',
    })
  })

  it('fails with reply_to_count when zero reply-to addresses', () => {
    const input = goodInput()
    input.replyTo = []
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'reply_to_count',
    })
  })

  it('fails with email_mismatch when reply-to differs', () => {
    const input = goodInput()
    input.replyTo = ['other@example.com']
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'email_mismatch',
    })
  })

  it('normalises trailing spaces and uppercase in body email', () => {
    const input = goodInput()
    input.body = input.body.replace(
      'Email\tjane.test@example.com',
      'Email\t  Jane.Test@Example.com  ',
    )
    const result = parseFormNotice(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.email).toBe('jane.test@example.com')
  })

  it('fails with bad_email for comma-separated addresses', () => {
    const input = goodInput()
    input.body = input.body.replace(
      'Email\tjane.test@example.com',
      'Email\ta@b.com, c@d.com',
    )
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'bad_email',
    })
  })

  it('fails with bad_email when body has no Email', () => {
    const input = goodInput()
    input.body = input.body.replace('Email\tjane.test@example.com\n', '')
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'bad_email',
    })
  })

  it('fails with auth_failed for header.from suffix attack', () => {
    const input = goodInput()
    input.headers[0] = {
      name: 'Authentication-Results',
      value:
        'mx.example 1; dkim=pass header.d=example.co.nz; dmarc=pass action=none header.from=example.co.nz.evil.com',
    }
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'auth_failed',
    })
  })

  it('fails with auth_failed when dmarc=fail', () => {
    const input = goodInput()
    input.headers[0] = {
      name: 'Authentication-Results',
      value:
        'mx.example 1; dkim=pass header.d=example.co.nz; dmarc=fail action=none header.from=example.co.nz',
    }
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'auth_failed',
    })
  })

  it('fails with auth_failed when DKIM-Signature missing', () => {
    const input = goodInput()
    input.headers = [input.headers[0]]
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'auth_failed',
    })
  })

  it('fails with auth_failed for non-allowed dkim selector', () => {
    const input = goodInput()
    input.headers[1] = {
      name: 'DKIM-Signature',
      value:
        'v=1; a=rsa-sha256; q=dns/txt; c=relaxed/simple; s=other;\td=example.co.nz; t=1; h=From:To',
    }
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'auth_failed',
    })
  })

  it('uses only the first Authentication-Results header', () => {
    const input = goodInput()
    input.headers = [
      {
        name: 'Authentication-Results',
        value:
          'mx.example 1; dkim=pass header.d=example.co.nz; dmarc=fail action=none header.from=example.co.nz',
      },
      {
        name: 'Authentication-Results',
        value:
          'mx.example 1; dkim=pass header.d=example.co.nz; dmarc=pass action=none header.from=example.co.nz',
      },
      input.headers[1],
    ]
    expect(parseFormNotice(input)).toEqual({
      ok: false,
      reason: 'auth_failed',
    })
  })

  it('ignores Email labels after the Message line', () => {
    const input = goodInput()
    input.body = input.body.replace(
      'hello there',
      'hello there\nEmail\tvictim@example.org',
    )
    const result = parseFormNotice(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.email).toBe('jane.test@example.com')
  })

  it('truncates message to 200 chars', () => {
    const input = goodInput()
    const long = 'x'.repeat(300)
    input.body = input.body.replace('hello there', long)
    const result = parseFormNotice(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.message).not.toBeNull()
    expect(result.lead.message?.length).toBe(200)
  })

  it('strips the <...> part from Form URL', () => {
    const input = goodInput()
    const result = parseFormNotice(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.lead.formUrl).toBe('/contact')
  })
})

describe('真实通知的单空格多词标签', () => {
  it('"Travel interest Custom Itinerary"（标签后只有一个空格）也能取到兴趣', () => {
    const base = goodInput()
    const body = base.body.replace('Travel interest\tCustom Itinerary', 'Travel interest Custom Itinerary')
    const r = parseFormNotice({ ...base, body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.interest).toBe('Custom Itinerary')
  })
})

describe('魏征 R1：DKIM 必须是验证通过的', () => {
  it('Authentication-Results 里没有 dkim=pass，只有手写的 DKIM-Signature 头 → auth_failed', () => {
    const base = goodInput()
    const headers = base.headers.map((h) =>
      h.name === 'Authentication-Results'
        ? { ...h, value: 'mx 1; spf=pass smtp.mailfrom=example.co.nz; dmarc=pass action=none header.from=example.co.nz' }
        : h,
    )
    expect(parseFormNotice({ ...base, headers })).toEqual({ ok: false, reason: 'auth_failed' })
  })

  it('dkim=pass 但 header.d 是别人的域名 → auth_failed', () => {
    const base = goodInput()
    const headers = base.headers.map((h) =>
      h.name === 'Authentication-Results'
        ? { ...h, value: 'mx 1; dkim=pass header.d=amazonses.com; dmarc=pass header.from=example.co.nz' }
        : h,
    )
    expect(parseFormNotice({ ...base, headers })).toEqual({ ok: false, reason: 'auth_failed' })
  })
})

describe('第二期：Tour enquiry 通知', () => {
  const tourBody =
    'New tour enquiry — Example website\nName\tJane Test\nEmail\tjane.test@example.com\nPhone\t0211234567\nTour\tBest of China — 15 Days\nURL\t/tours/china/signature/example\nSource\ttour-page\nAd source\tfacebook\nFacebook click ID\tfb.1.123.abc\nSubmitted\t2026-10-20T01:00:00.000Z\n\nMessage\n\nhello'

  it('isFormNoticeCandidate：Tour enquiry 主题通过；Re:/Fwd: 开头仍不通过', () => {
    const base = { direction: 'inbound' as const, fromAddress: 'info@example.co.nz', mailbox: 'info@example.co.nz' }
    expect(isFormNoticeCandidate({ ...base, subject: 'Tour enquiry: Best of China — Jane' })).toBe(true)
    expect(isFormNoticeCandidate({ ...base, subject: 'Re: Tour enquiry: Best of China — Jane' })).toBe(false)
    expect(isFormNoticeCandidate({ ...base, subject: 'Fwd: Tour enquiry: X' })).toBe(false)
    expect(isFormNoticeCandidate({ ...base, subject: 'Tour enquiries weekly digest' })).toBe(false)
  })

  it('解析：kind、兴趣取 Tour 行、URL 取 formUrl', () => {
    const r = parseFormNotice({ ...goodInput(), body: tourBody })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.kind).toBe('tour_enquiry')
      expect(r.lead.interest).toBe('Best of China — 15 Days')
      expect(r.lead.formUrl).toBe('/tours/china/signature/example')
      expect(r.lead.name).toBe('Jane Test')
    }
  })

  it('Contact form 仍解析为 contact_form，且不会误把 Tour 行当兴趣', () => {
    const r = parseFormNotice(goodInput())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.kind).toBe('contact_form')
  })

  it('标记行既不是联系表单也不是团页表单 → bad_marker', () => {
    expect(parseFormNotice({ ...goodInput(), body: tourBody.replace('New tour enquiry', 'New tour quote') })).toEqual({ ok: false, reason: 'bad_marker' })
  })

  it('团页通知同样必须过认证：dkim 伪造 → auth_failed', () => {
    const base = goodInput()
    const headers = base.headers.map((h) =>
      h.name === 'Authentication-Results' ? { ...h, value: 'mx 1; dmarc=pass header.from=example.co.nz' } : h,
    )
    expect(parseFormNotice({ ...base, headers, body: tourBody })).toEqual({ ok: false, reason: 'auth_failed' })
  })

  it('留言里伪造「Email」行骗不过（只读 Message 之前）', () => {
    const body = tourBody.replace('hello', 'Email\tvictim@example.org')
    const r = parseFormNotice({ ...goodInput(), body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.email).toBe('jane.test@example.com')
  })
})

describe('魏征第二期复审补充', () => {
  const single =
    'New tour enquiry — Example website\nName Jane Test\nEmail jane.test@example.com\nPhone 0211234567\nTour Best of China — 15 Days\nURL /tours/china/example\nSource tour-page\nAd source facebook\nFacebook click ID fb.1.123.abc\nSubmitted 2026-10-20T01:00:00.000Z\n\nMessage\n\nhello'

  it('标签后只有一个空格（真实写法之一）：Tour / URL / Name / Email 仍能取到', () => {
    const r = parseFormNotice({ ...goodInput(), body: single })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.interest).toBe('Best of China — 15 Days')
      expect(r.lead.formUrl).toBe('/tours/china/example')
      expect(r.lead.name).toBe('Jane Test')
      expect(r.lead.email).toBe('jane.test@example.com')
    }
  })

  it('"Tour pages viewed" 不会被 "Tour" 抢走成兴趣', () => {
    const body = single.replace('Source tour-page', 'Tour pages viewed /tours/a, /tours/b')
    const r = parseFormNotice({ ...goodInput(), body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.interest).toBe('Best of China — 15 Days')
  })

  it('联系表单正文里即使有 Tour 行，兴趣仍取 Travel interest', () => {
    const base = goodInput()
    const body = base.body.replace('Travel interest\tCustom Itinerary', 'Travel interest\tCustom Itinerary\nTour\tSomething Else')
    const r = parseFormNotice({ ...base, body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.interest).toBe('Custom Itinerary')
  })

  it('兴趣超过 200 字被截断', () => {
    const body = single.replace('Best of China — 15 Days', 'x'.repeat(500))
    const r = parseFormNotice({ ...goodInput(), body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.interest).toHaveLength(200)
  })

  it('主题写 Contact form 但正文标记是 Tour enquiry：按正文标记判 kind（认证仍必须通过）', () => {
    const r = parseFormNotice({ ...goodInput(), body: single })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.kind).toBe('tour_enquiry')
  })
})
