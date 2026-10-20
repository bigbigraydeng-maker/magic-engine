import { describe, expect, it } from 'vitest'
import {
  applyFormNotices,
  emptyFormStats,
  formLeadRaw,
  formLeadMetadata,
  mirrorFormThread,
  FORM_NEW_PEOPLE_CAP,
  type FormIngestDeps,
} from '../mail-form-ingest'
import { planMailIngest } from '../mail-ingest'
import type { MailMessage } from '../mail-graph'

const MAILBOX = 'info@example.co.nz'
const OWN = ['example.co.nz']

function body(email: string, name = 'Jane Test', phone = '0211234567'): string {
  return `New message — Contact form (Example site)\nName\t${name}\nEmail\t${email}\nPhone\t${phone}\nTravel interest\tCustom Itinerary\nSubmitted\t2026-10-19T01:29:17.009Z\nForm URL\t/contact<https://www.example.co.nz/contact>\n\nMessage\n\nhello there`
}

const GOOD_HEADERS = [
  { name: 'Authentication-Results', value: 'mx.example 1; dkim=pass header.d=example.co.nz; dmarc=pass action=none header.from=example.co.nz' },
  { name: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; s=resend;\td=example.co.nz; t=1' },
]

function msg(id: string, over: Partial<MailMessage> = {}): MailMessage {
  return {
    id,
    conversationId: 'conv-1',
    subject: 'Contact form: Custom Itinerary — Jane',
    preview: 'Name Jane Test Email jane@example.com Phone 0211234567',
    receivedAt: '2026-10-19T01:29:20Z',
    counterparty: { address: MAILBOX, name: 'CTS Tours' },
    direction: 'inbound',
    hasAttachment: false,
    ...over,
  }
}

function deps(emailByMsg: Record<string, string>, existing: Record<string, string> = {}): FormIngestDeps {
  return {
    fetchSource: async (_t, id) => {
      const email = emailByMsg[id]
      if (email === undefined) return { ok: false, error: 'HTTP 429' }
      return { ok: true, source: { body: body(email), replyTo: [email], headers: GOOD_HEADERS } }
    },
    findContactByEmail: async (_c, email) => existing[email] ?? null,
  }
}

async function run(messages: MailMessage[], d: FormIngestDeps) {
  const stats = emptyFormStats()
  const out = await applyFormNotices({ token: 't', mailbox: MAILBOX, clientId: 'c1', ownDomains: OWN, messages, stats, deps: d })
  return { out, stats }
}

describe('applyFormNotices', () => {
  it('表单通知 → 对方改写成客人、摘要不含电话和邮箱', async () => {
    const { out, stats } = await run([msg('m1')], deps({ m1: 'jane@example.com' }))
    expect(out).toHaveLength(1)
    expect(out[0].counterparty).toEqual({ address: 'jane@example.com', name: 'Jane Test' })
    expect(out[0].formLead?.email).toBe('jane@example.com')
    expect(out[0].preview).not.toContain('0211234567')
    expect(out[0].preview).not.toContain('jane@example.com')
    expect(stats).toMatchObject({ recognised: 1, parsed: 1, created: 1, matched: 0, failed: 0 })
  })

  it('不是表单通知的邮件原样通过，不去读全文', async () => {
    let fetched = 0
    const d = { ...deps({}), fetchSource: async () => { fetched += 1; return { ok: false as const, error: 'x' } } }
    const other = msg('m2', { subject: 'Re: Contact form: X', counterparty: { address: MAILBOX, name: null } })
    const sent = msg('m3', { direction: 'outbound' })
    const { out, stats } = await run([other, sent], d)
    expect(out).toHaveLength(2)
    expect(fetched).toBe(0)
    expect(stats.recognised).toBe(0)
  })

  it('读取失败 / 认证不过 → 丢掉并计数，不抛出', async () => {
    const { out, stats } = await run([msg('m4')], deps({}))
    expect(out).toHaveLength(0)
    expect(stats.failed).toBe(1)
    expect(stats.failedReasons.fetch_error).toBe(1)
  })

  it('邮箱已属于已有联系人 → matched，不算新建', async () => {
    const { stats } = await run([msg('m5')], deps({ m5: 'old@example.com' }, { 'old@example.com': 'contact-1' }))
    expect(stats).toMatchObject({ matched: 1, created: 0 })
  })

  it('表单里填自家域邮箱（员工测试单）→ 计 staffTest，且仍被 planMailIngest 跳过', async () => {
    const { out, stats } = await run([msg('m6')], deps({ m6: 'baker@example.co.nz' }))
    expect(stats.staffTest).toBe(1)
    expect(stats.created).toBe(0)
    const plan = planMailIngest(out, { ownDomains: OWN })
    expect(plan.threads).toHaveLength(0)
    expect(plan.skipped[0]?.why).toBe('公司内部邮箱')
  })

  it(`单轮新建超过 ${FORM_NEW_PEOPLE_CAP} 人 → 超出的不入库并计 over_cap`, async () => {
    const ids = Array.from({ length: FORM_NEW_PEOPLE_CAP + 3 }, (_, i) => `x${i}`)
    const map = Object.fromEntries(ids.map((id, i) => [id, `p${i}@example.com`]))
    const { out, stats } = await run(ids.map((id) => msg(id, { conversationId: 'same' })), deps(map))
    expect(out).toHaveLength(FORM_NEW_PEOPLE_CAP)
    expect(stats.failedReasons.over_cap).toBe(3)
  })
})

describe('表单通知的线程', () => {
  it('同一会话里两位同主题客人各自一条线程，对方是各自的邮箱', async () => {
    const { out } = await run(
      [msg('a1'), msg('a2', { receivedAt: '2026-10-19T01:30:00Z' })],
      deps({ a1: 'one@example.com', a2: 'two@example.com' }),
    )
    const plan = planMailIngest(out, { ownDomains: OWN })
    expect(plan.threads.map((t) => t.counterparty.address).sort()).toEqual(['one@example.com', 'two@example.com'])
    expect(plan.threads.every((t) => t.hasInbound)).toBe(true)
  })
})

describe('mirrorFormThread / formLeadRaw', () => {
  const lead = { kind: 'contact_form' as const, email: 'jane@example.com', name: 'Jane', phone: '0211234567', interest: 'Custom Itinerary', message: 'hello', submittedAt: null, formUrl: '/contact' }

  it('raw 只含兴趣和留言，不含电话和邮箱', () => {
    const raw = formLeadRaw(lead)
    expect(raw).toBe('兴趣: Custom Itinerary\n留言: hello')
  })

  it('只带邮箱一个身份（phone 传 null）、leadId=邮件 id', async () => {
    const calls: Array<Record<string, unknown>> = []
    const id = await mirrorFormThread({
      clientId: 'c1',
      messages: [{ id: 'mid-1', receivedAt: '2026-10-19T01:29:20Z', formLead: lead }],
      mirror: async (i) => { calls.push(i as unknown as Record<string, unknown>); return { contactId: 'ct-1', skipped: null } },
    })
    expect(id).toBe('ct-1')
    expect(calls[0]).toMatchObject({ leadId: 'mid-1', phone: null, email: 'jane@example.com', name: 'Jane' })
  })

  it('skipped=error 一律抛出（交给「一条失败就停」）', async () => {
    await expect(
      mirrorFormThread({
        clientId: 'c1',
        messages: [{ id: 'mid-2', receivedAt: 'x', formLead: lead }],
        mirror: async () => ({ contactId: null, skipped: 'error' }),
      }),
    ).rejects.toThrow()
  })
})

describe('魏征复审补充（429 / 重复邮箱 / 系统地址）', () => {
  it('Graph 返回 429 → 本轮不再读剩余候选，记 rate_limited 与 deferred，不抛出', async () => {
    let calls = 0
    const d: FormIngestDeps = {
      fetchSource: async () => { calls += 1; return { ok: false, error: 'HTTP 429', status: 429 } },
      findContactByEmail: async () => null,
    }
    const { out, stats } = await run([msg('r1'), msg('r2', { conversationId: 'c2' }), msg('r3', { conversationId: 'c3' })], d)
    expect(calls).toBe(1)
    expect(out).toHaveLength(0)
    expect(stats.failedReasons.rate_limited).toBe(1)
    expect(stats.failedReasons.rate_limited_deferred).toBe(2)
  })

  it('同一新邮箱本轮两封通知：只算一次新建，不重复占名额', async () => {
    const { stats } = await run(
      [msg('d1'), msg('d2', { conversationId: 'c2' })],
      deps({ d1: 'same@example.com', d2: 'same@example.com' }),
    )
    expect(stats.created).toBe(1)
    expect(stats.matched).toBe(1)
  })

  it('表单里填的是系统地址（accounts@…）→ 不算员工测试，计 system_address 并丢弃', async () => {
    const { out, stats } = await run([msg('s1')], deps({ s1: 'accounts@gmail.com' }))
    expect(out).toHaveLength(0)
    expect(stats.staffTest).toBe(0)
    expect(stats.failedReasons.system_address).toBe(1)
  })

  it('改写后的主题和摘要不含客人名、电话、邮箱', async () => {
    const { out } = await run([msg('p1')], deps({ p1: 'jane@example.com' }))
    expect(out[0].subject).toBe('Contact form: Custom Itinerary')
    expect(out[0].subject).not.toContain('Jane')
  })
})

describe('第二期：Tour enquiry（团页表单）', () => {
  function tourBody(email: string): string {
    return `New tour enquiry — Example website\nName\tJane Test\nEmail\t${email}\nPhone\t0211234567\nTour\tBest of China — 15 Days\nURL\t/tours/china/signature/example\nSource\ttour-page\nAd source\tfacebook\nFacebook click ID\tfb.1.123.abc\nSubmitted\t2026-10-20T01:00:00.000Z\n\nMessage\n\nwhen is the next departure`
  }
  const tourDeps = (email: string): FormIngestDeps => ({
    fetchSource: async () => ({ ok: true, source: { body: tourBody(email), replyTo: [email], headers: GOOD_HEADERS } }),
    findContactByEmail: async () => null,
  })
  const tourMsg = () => msg('t1', { subject: 'Tour enquiry: Best of China — 15 Days — Jane' })

  it('团页表单通知 → 识别为 tour_enquiry、兴趣取 Tour 行、主题和摘要改写且不含客人信息', async () => {
    const { out, stats } = await run([tourMsg()], tourDeps('jane@example.com'))
    expect(out).toHaveLength(1)
    expect(out[0].formLead?.kind).toBe('tour_enquiry')
    expect(out[0].formLead?.interest).toBe('Best of China — 15 Days')
    expect(out[0].formLead?.formUrl).toBe('/tours/china/signature/example')
    expect(out[0].subject).toBe('Tour enquiry: Best of China — 15 Days')
    expect(out[0].preview).toBe('网站团页表单 · Best of China — 15 Days')
    expect(out[0].preview).not.toContain('0211234567')
    expect(stats).toMatchObject({ recognised: 1, parsed: 1, created: 1, failed: 0 })
  })

  it('「Facebook click ID」「Ad source」这类多词标签不会被当成留言或抢走字段', async () => {
    const { out } = await run([tourMsg()], tourDeps('jane@example.com'))
    expect(out[0].formLead?.message).toBe('when is the next departure')
    expect(out[0].formLead?.email).toBe('jane@example.com')
  })
})

describe('出发时间 / 预算进触点 metadata', () => {
  const lead = { kind: 'tour_enquiry' as const, email: 'jane@example.com', name: 'Jane', phone: '0211234567', interest: 'X', message: 'hi', submittedAt: null, formUrl: '/t' }

  it('formLeadMetadata：只含有值的稳定代码；都缺 → null（不写 null、不当 0）', () => {
    expect(formLeadMetadata({ ...lead, travelWindow: 'mar_may_2027', budgetBand: '3000_5000' })).toEqual({ form_travel_window: 'mar_may_2027', form_budget_band: '3000_5000' })
    expect(formLeadMetadata({ ...lead, travelWindow: 'not_sure', budgetBand: null })).toEqual({ form_travel_window: 'not_sure' })
    expect(formLeadMetadata({ ...lead, travelWindow: null, budgetBand: null })).toBeNull()
    expect(formLeadMetadata(lead)).toBeNull()
  })

  it('mirrorFormThread 把稳定代码作为 metadata 传给 mirrorWebFormLead', async () => {
    const calls: Array<Record<string, unknown>> = []
    await mirrorFormThread({
      clientId: 'c1',
      messages: [{ id: 'mid-9', receivedAt: '2026-10-20T01:00:00Z', formLead: { ...lead, travelWindow: 'jun_sep_2027', budgetBand: 'above_8000' } }],
      mirror: async (i) => { calls.push(i as unknown as Record<string, unknown>); return { contactId: 'ct-9', skipped: null } },
    })
    expect(calls[0].metadata).toEqual({ form_travel_window: 'jun_sep_2027', form_budget_band: 'above_8000' })
  })

  it('两项缺失时 metadata 为 null（与改动前一致）', async () => {
    const calls: Array<Record<string, unknown>> = []
    await mirrorFormThread({
      clientId: 'c1',
      messages: [{ id: 'mid-10', receivedAt: 'x', formLead: lead }],
      mirror: async (i) => { calls.push(i as unknown as Record<string, unknown>); return { contactId: 'ct-10', skipped: null } },
    })
    expect(calls[0].metadata).toBeNull()
  })

  it('applyFormNotices：映射不到的值计 unknownExtras', async () => {
    const d: FormIngestDeps = {
      fetchSource: async () => ({
        ok: true,
        source: {
          body: `New tour enquiry — Example website\nName\tJane\nEmail\tu@example.com\nTour\tX\nTravel window\tEarly 2028\nSubmitted\t2026-10-20T01:00:00Z\n\nMessage\n\nhi`,
          replyTo: ['u@example.com'],
          headers: GOOD_HEADERS,
        },
      }),
      findContactByEmail: async () => null,
    }
    const { stats } = await run([msg('u1', { subject: 'Tour enquiry: X — Jane' })], d)
    expect(stats.unknownExtras).toBe(1)
  })
})
