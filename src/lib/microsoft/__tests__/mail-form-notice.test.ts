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
      travelWindow: null,
      budgetBand: null,
      unknownExtras: [],
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

describe('官网新增两行（Travel window / Budget per person）的兼容', () => {
  // 官网 PM 要求加两个必填问题；通知邮件表格会新增这两行，已有行与主题不变。旧页面提交的邮件缺这两行，也必须正常解析。
  const rows = (sep: string) =>
    `New tour enquiry — Example website\nName${sep}Jane Test\nEmail${sep}jane.test@example.com\nPhone${sep}0211234567\nTour${sep}Best of China — 15 Days\nURL${sep}/tours/china/example\nSource${sep}tour-page\nAd source${sep}facebook\nFacebook click ID${sep}fb.1.123.abc\nTravel window${sep}March – May 2027\nBudget per person (NZD)${sep}$3,000 – $5,000\nSubmitted${sep}2026-10-20T01:00:00.000Z\n\nMessage\n\nhello`

  for (const [label, sep] of [['制表符分隔', '\t'], ['多空格分隔', '    '], ['单空格分隔', ' ']] as const) {
    it(`新增两行（${label}）→ 不报错，其它字段不受影响`, () => {
      const r = parseFormNotice({ ...goodInput(), body: rows(sep) })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.lead.kind).toBe('tour_enquiry')
        expect(r.lead.email).toBe('jane.test@example.com')
        expect(r.lead.name).toBe('Jane Test')
        expect(r.lead.phone).toBe('0211234567')
        expect(r.lead.interest).toBe('Best of China — 15 Days')
        expect(r.lead.formUrl).toBe('/tours/china/example')
        expect(r.lead.submittedAt).toBe('2026-10-20T01:00:00.000Z')
        expect(r.lead.message).toBe('hello')
      }
    })
  }

  it('旧页面（缺这两行）仍正常解析', () => {
    const body = rows('\t')
      .split('\n')
      .filter((l) => !/^(Travel window|Budget per person)/.test(l))
      .join('\n')
    const r = parseFormNotice({ ...goodInput(), body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.interest).toBe('Best of China — 15 Days')
  })

  it('留言里伪造这两行不会影响任何字段（只读 Message 之前）', () => {
    const body = rows('\t').replace('hello', 'Travel window\tJune – September 2027\nBudget per person (NZD)\tAbove $8,000')
    const r = parseFormNotice({ ...goodInput(), body })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.message).toContain('Travel window')
      // 留言（Message 之后）里伪造的两行不能被当成真答案：读到 Message 行就必须停（防「去掉 break」的变异）。
      expect(r.lead.travelWindow).toBe('mar_may_2027')
      expect(r.lead.budgetBand).toBe('3000_5000')
    }
  })

  it('真实行缺失（老页面）、留言里却伪造这两行 → 两项仍是 null（Message 之后一律不读）', () => {
    const noRows = rows('\t')
      .split('\n')
      .filter((l) => !/^(Travel window|Budget per person)/.test(l))
      .join('\n')
      .replace('hello', 'Travel window\tJune – September 2027\nBudget per person (NZD)\t$5,000 – $8,000')
    const r = parseFormNotice({ ...goodInput(), body: noRows })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.travelWindow).toBeNull()
      expect(r.lead.budgetBand).toBeNull()
    }
  })

  it('同样的新增行出现在联系表单正文里也不出错', () => {
    const base = goodInput()
    const body = base.body.replace('Submitted\t', 'Travel window\tNot sure yet\nBudget per person (NZD)\tUnder $3,000\nSubmitted\t')
    const r = parseFormNotice({ ...base, body })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.lead.interest).toBe('Custom Itinerary')
  })
})

describe('出发时间 / 预算 → 稳定代码', () => {
  const body = (win: string | null, budget: string | null) =>
    `New tour enquiry — Example website\nName\tJane Test\nEmail\tjane.test@example.com\nTour\tX\n${win === null ? '' : `Travel window\t${win}\n`}${budget === null ? '' : `Budget per person (NZD)\t${budget}\n`}Submitted\t2026-10-20T01:00:00.000Z\n\nMessage\n\nhi`

  it('四个出发时间选项 + 四个预算选项都映射到约定代码', () => {
    const wins: Array<[string, string]> = [['March – May 2027', 'mar_may_2027'], ['June – September 2027', 'jun_sep_2027'], ['October – December 2027', 'oct_dec_2027'], ['Not sure yet', 'not_sure']]
    for (const [text, code] of wins) {
      const r = parseFormNotice({ ...goodInput(), body: body(text, null) })
      expect(r.ok && r.lead.travelWindow).toBe(code)
    }
    const budgets: Array<[string, string]> = [['Under $3,000', 'under_3000'], ['$3,000 – $5,000', '3000_5000'], ['$5,000 – $8,000', '5000_8000'], ['Above $8,000', 'above_8000']]
    for (const [text, code] of budgets) {
      const r = parseFormNotice({ ...goodInput(), body: body(null, text) })
      expect(r.ok && r.lead.budgetBand).toBe(code)
    }
  })

  it('缺这两行（旧页面）→ 两项 null，unknownExtras 为空', () => {
    const r = parseFormNotice({ ...goodInput(), body: body(null, null) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.travelWindow).toBeNull()
      expect(r.lead.budgetBand).toBeNull()
      expect(r.lead.unknownExtras).toEqual([])
    }
  })

  it('映射不到的值 → 存 null 并记入 unknownExtras，不乱存原文', () => {
    const r = parseFormNotice({ ...goodInput(), body: body('Early 2028', '$12,000 – $15,000') })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.travelWindow).toBeNull()
      expect(r.lead.budgetBand).toBeNull()
      expect(r.lead.unknownExtras).toEqual(['travel_window', 'budget_band'])
    }
  })

  it('单空格分隔的真实写法也能取到', () => {
    const r = parseFormNotice({ ...goodInput(), body: body('March – May 2027', 'Above $8,000').replace(/\t/g, ' ') })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.travelWindow).toBe('mar_may_2027')
      expect(r.lead.budgetBand).toBe('above_8000')
    }
  })
})

describe('官网 PR #259 的真实邮件样本（整封 HTML 转纯文本后的写法，合成值）', () => {
  // 结构抄自官网本地真实提交抓到的整封邮件：标题行 → 表格各行（标签 + 值）→ 最后两行是新增的出发时间 / 预算；
  // 没填电话时 Phone 值是「—」；没有 Message 段。值全是合成的，不含任何真实客人信息。
  const sample = (win: string | null, budget: string | null, dash = '–') =>
    [
      'New tour enquiry — CTS website',
      'Name    Local Test Person',
      'Email    local-test@example.invalid',
      'Phone    —',
      'Tour    China Signature — Natural China',
      'URL    /tours/china/signature/landscapes<https://www.example.co.nz/tours/china/signature/landscapes>',
      'Source    Tour Page Enquiry',
      'Ad source    facebook / local_test',
      'Submitted    2026-10-20T02:50:46.398Z',
      'First landing page    /tours/china/signature/landscapes',
      'Submitted from    /tours/china/signature/landscapes',
      'Arrived via    facebook / paid_social / local_test',
      'Tour pages viewed    /tours/china/signature/landscapes',
      ...(win === null ? [] : [`Travel window    ${win.replace('–', dash)}`]),
      ...(budget === null ? [] : [`Budget per person (NZD)    ${budget.replace('–', dash)}`]),
    ].join('\n')
  const input = (body: string) => ({ ...goodInput(), body, replyTo: ['local-test@example.invalid'] })

  it('整封样本解析成功，各字段正确（没有 Message 段也行）', () => {
    const r = parseFormNotice(input(sample('June – September 2027', '$3,000 – $5,000')))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.kind).toBe('tour_enquiry')
      expect(r.lead.interest).toBe('China Signature — Natural China')
      expect(r.lead.travelWindow).toBe('jun_sep_2027')
      expect(r.lead.budgetBand).toBe('3000_5000')
      expect(r.lead.message).toBeNull()
    }
  })

  it('老页面：这两行整行不出现 → 两项 null、不报错', () => {
    const r = parseFormNotice(input(sample(null, null)))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.lead.travelWindow).toBeNull()
      expect(r.lead.budgetBand).toBeNull()
      expect(r.lead.unknownExtras).toEqual([])
    }
  })

  it('四个出发时间 × 四个预算选项（官网标签表）都能映射', () => {
    const wins = [['March – May 2027', 'mar_may_2027'], ['June – September 2027', 'jun_sep_2027'], ['October – December 2027', 'oct_dec_2027'], ['Not sure yet', 'not_sure']]
    const budgets = [['Under $3,000', 'under_3000'], ['$3,000 – $5,000', '3000_5000'], ['$5,000 – $8,000', '5000_8000'], ['Above $8,000', 'above_8000']]
    for (const [w, wc] of wins) {
      for (const [b, bc] of budgets) {
        const r = parseFormNotice(input(sample(w, b)))
        expect(r.ok && r.lead.travelWindow).toBe(wc)
        expect(r.ok && r.lead.budgetBand).toBe(bc)
      }
    }
  })

  it('en dash 换成连字符 / 不间断空格 / 紧贴也能映射（鲁棒性）', () => {
    for (const dash of ['-', '—', '\u2013']) {
      const r = parseFormNotice(input(sample('June – September 2027', '$3,000 – $5,000', dash)))
      expect(r.ok && r.lead.travelWindow).toBe('jun_sep_2027')
      expect(r.ok && r.lead.budgetBand).toBe('3000_5000')
    }
    const nbsp = sample('June – September 2027', '$3,000 – $5,000').replace(/ – /g, '\u00a0–\u00a0')
    const r2 = parseFormNotice(input(nbsp))
    expect(r2.ok && r2.lead.travelWindow).toBe('jun_sep_2027')
    expect(r2.ok && r2.lead.budgetBand).toBe('3000_5000')
  })
})
