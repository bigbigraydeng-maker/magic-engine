import { describe, expect, it } from 'vitest'
import {
  applyFormNotices,
  emptyFormStats,
  formLeadRaw,
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
  const lead = { email: 'jane@example.com', name: 'Jane', phone: '0211234567', interest: 'Custom Itinerary', message: 'hello', submittedAt: null, formUrl: '/contact' }

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
