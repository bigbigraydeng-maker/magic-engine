// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredFindings } from '@/lib/tools-lab/site-check/leads'
import { NextRequest } from 'next/server'

// ── module mocks (hoisted) ──────────────────────────────────────────────────
const rpcMock = vi.fn()
const fromMock = vi.fn()
const callClaudeChatMock = vi.fn()
const recordToolLeadMock = vi.fn()
const inngestSendMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}))

vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: (...args: unknown[]) => callClaudeChatMock(...args),
  MODEL_HAIKU: 'claude-haiku-4-5-20251001',
}))

vi.mock('@/lib/net/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...actual, safeFetchText: vi.fn() }
})

vi.mock('@/lib/tools-lab/lead-events', () => ({ recordToolLead: (...args: unknown[]) => recordToolLeadMock(...args) }))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: (...args: unknown[]) => inngestSendMock(...args) } }))
vi.mock('@/lib/inngest/functions/tools-lab-lead-followup', () => ({ TOOLS_LAB_REPORT_EMAIL_ATTEMPTED_EVENT: 'tools_lab/report_email.attempted' }))

import { safeFetchText } from '@/lib/net/safe-fetch'
import { POST as report } from '@/app/api/public/site-check/report/route'

const safeFetchTextMock = vi.mocked(safeFetchText)

const ENV = { SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 'r' }
const LEAD_ID = '11111111-1111-1111-1111-111111111111'

function req(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  omit: string[] = [],
): NextRequest {
  const all: Record<string, string> = {
    'content-type': 'application/json',
    origin: 'https://magicengine.com.au',
    'x-forwarded-for': '203.0.113.7, 162.158.10.1',
    'cf-connecting-ip': '203.0.113.7',
    ...headers,
  }
  for (const name of omit) delete all[name]
  return new NextRequest(`https://app.magicengine.com.au${path}`, {
    method: 'POST',
    headers: all,
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY
  process.env.RESEND_API_KEY = ENV.RESEND_API_KEY
  safeFetchTextMock.mockReset()
  recordToolLeadMock.mockReset().mockResolvedValue(undefined)
  inngestSendMock.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

// ── report ──────────────────────────────────────────────────────────────────
interface ReportNet {
  calls: string[]
  sendHeaders: Headers[]
}

function reportNet(
  lead: unknown,
  over: {
    claim?: boolean
    claimError?: boolean
    quota?: boolean
    recipient?: boolean
    day?: boolean
    send?: number
  } = {},
): ReportNet {
  const calls: string[] = []
  const sendHeaders: Headers[] = []

  rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'zhangqian_rate_limit_consume') return { data: null, error: { message: 'unknown rpc' } }
    const type = String(args.p_bucket_type)
    calls.push(`quota:${type}`)
    const allowed =
      type === 'site_report_ip' ? over.quota ?? true : type === 'site_report_to' ? over.recipient ?? true : over.day ?? true
    return { data: [{ allowed, post_count: 1 }], error: null }
  })

  fromMock.mockImplementation((table: string) => {
    if (table !== 'discovery_leads') return {}
    return {
      select: () => {
        const chain: Record<string, unknown> = {}
        chain.eq = () => chain
        chain.limit = async () => ({ data: lead ? [lead] : [], error: null })
        return chain
      },
      update: (row: { status?: string }) => {
        calls.push(row.status === 'report_sent' ? 'claim' : 'release')
        const filters: Array<[string, unknown]> = []
        const chain = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return chain
          },
          select: async () => {
            if (over.claimError) return { data: null, error: { message: 'down' } }
            const hasStatus = filters.some(([c, v]) => c === 'status' && v === 'scouted')
            const hasId = filters.some(([c, v]) => c === 'id' && v === LEAD_ID)
            const claimed = row.status === 'report_sent' && (over.claim ?? true) && hasStatus && hasId
            return { data: claimed ? [{ id: LEAD_ID }] : [], error: null }
          },
        }
        return chain
      },
    }
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('api.resend.com')) {
        calls.push('send')
        sendHeaders.push(new Headers(init?.headers))
        return new Response('{}', { status: over.send ?? 200 })
      }
      return new Response('?', { status: 404 })
    }),
  )

  return { calls, sendHeaders }
}

const LEAD: { id: string; url: string; market: string; status: string; findings: StoredFindings } = {
  id: LEAD_ID,
  url: 'https://acme.com/',
  market: 'AU',
  status: 'scouted',
  findings: {
    lang: 'zh',
    context: 'export',
    source: 'homepage',
    reused: false,
    top_opportunity: null,
    summary: '<b>总结</b>',
    findings: [
      {
        severity: 'NOW',
        title: '<script>alert(1)</script>',
        desc: '点 <a href="https://phish.example">这里</a>',
        fix: '改',
        where: '页头',
      },
    ],
  },
}

const send = (body: unknown) => report(req('/api/public/site-check/report', body))

describe('report', () => {
  it('escapes everything from the site and the model; no links from site content; Chinese email for a Chinese check', async () => {
    const { buildEmail } = await import('@/lib/tools-lab/site-check/report-email')
    const { subject, body } = buildEmail({
      url: 'https://paypal-account-verify.com/',
      findings: {
        ...LEAD.findings,
        findings: [{ ...LEAD.findings.findings[0], desc: '访问 www.phish.example/login 或 https://evil.com/x' }],
      },
    })
    expect(subject).toBe('你的网站诊断结果：共 1 条建议 · Magic Engine')
    expect(subject).not.toContain('paypal-account-verify')
    expect(body).not.toMatch(/www\.phish\.example|https:\/\/evil\.com/)
    expect(body).toContain('phish[.]example')
    expect(body).toContain('paypal-account-verify[.]com')
    expect(body).not.toContain('<script>alert(1)</script>')
    expect(body).toContain('&lt;script&gt;')
    expect(body).not.toContain('href="https://phish.example"')
    expect(body).not.toMatch(/张骞|GST|financial year|Magic Bridge/)
  })

  it('sends once: a lead already sent → 409, nothing emailed', async () => {
    const net = reportNet({ ...LEAD, status: 'report_sent' })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(409)
    expect(net.calls).not.toContain('send')
  })

  it('losing the claim race → 409, nothing emailed', async () => {
    const net = reportNet(LEAD, { claim: false })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(409)
    expect(net.calls).not.toContain('send')
  })

  it('claim DB error → 503 unavailable, nothing emailed', async () => {
    const net = reportNet(LEAD, { claimError: true })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('unavailable')
    expect(net.calls).not.toContain('send')
  })

  it('no consent → consent_required, nothing claimed or sent', async () => {
    const net = reportNet(LEAD)
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: false })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('consent_required')
    expect(net.calls).not.toContain('claim')
    expect(net.calls).not.toContain('send')
  })

  it('a non-boolean consent value → consent_required, nothing claimed or sent', async () => {
    const net = reportNet(LEAD)
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: 'yes' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('consent_required')
    expect(net.calls).not.toContain('claim')
    expect(net.calls).not.toContain('send')
  })

  it('claims only a lead that is still unsent (status filter)', async () => {
    const net = reportNet(LEAD)
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(200)
    expect(net.calls).toContain('claim')
    expect(net.calls).toContain('send')
  })

  it('per-visitor daily cap → 429 daily_limit before claiming or sending', async () => {
    const net = reportNet(LEAD, { quota: false })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('daily_limit')
    expect(net.calls).toEqual(['quota:site_report_ip'])
  })

  it('one report per recipient per day → 429 recipient_limit', async () => {
    const net = reportNet(LEAD, { recipient: false })
    const res = await send({ leadId: LEAD.id, email: 'victim@b.com', consent: true })
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('recipient_limit')
    expect(net.calls).not.toContain('send')
  })

  it('a whole-site daily ceiling → 429 site_busy', async () => {
    const net = reportNet(LEAD, { day: false })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('site_busy')
    expect(net.calls).not.toContain('send')
  })

  it('idempotency key is scoped to the lead and the mailbox', async () => {
    const net = reportNet(LEAD)
    await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    await send({ leadId: LEAD.id, email: 'c@d.com', consent: true })
    expect(net.sendHeaders).toHaveLength(2)
    const first = net.sendHeaders[0].get('Idempotency-Key') ?? ''
    const second = net.sendHeaders[1].get('Idempotency-Key') ?? ''
    expect(first.startsWith(`site-check-report-${LEAD_ID}-`)).toBe(true)
    expect(second.startsWith(`site-check-report-${LEAD_ID}-`)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('email provider fails → lead released (status back to scouted), 502 send_failed', async () => {
    const net = reportNet(LEAD, { send: 500 })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('send_failed')
    expect(net.calls).toContain('release')
    expect(net.calls).toEqual([
      'quota:site_report_ip',
      'quota:site_report_to',
      'quota:site_report_day',
      'claim',
      'send',
      'release',
    ])
  })

  it('a successful send records a Tools Lab lead (the one genuine "wants to talk to us" signal in this flow)', async () => {
    reportNet(LEAD)
    await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(recordToolLeadMock).toHaveBeenCalledWith({
      tool: 'site-check',
      pagePath: '/cn/discover',
      targetHref: LEAD.url,
      dedupeKey: { lead_id: LEAD.id },
      extraMetadata: { url: LEAD.url, market: LEAD.market },
      email: 'a@b.com',
    })
  })

  it('a failed send does not record a lead (nothing was actually delivered)', async () => {
    reportNet(LEAD, { send: 500 })
    await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(recordToolLeadMock).not.toHaveBeenCalled()
  })

  it('a successful send emits a delivered:true receipt', async () => {
    reportNet(LEAD)
    await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: 'tools_lab/report_email.attempted',
      data: expect.objectContaining({ leadId: LEAD.id, delivered: true, failureCode: null }),
    })
  })

  it('a failed send emits a delivered:false receipt with the failure code, and never blocks the 502', async () => {
    reportNet(LEAD, { send: 500 })
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(502)
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: 'tools_lab/report_email.attempted',
      data: expect.objectContaining({ leadId: LEAD.id, delivered: false, failureCode: 'send_failed' }),
    })
  })

  it('a lead-recording failure never turns a delivered report into an error response for the visitor', async () => {
    reportNet(LEAD)
    recordToolLeadMock.mockRejectedValueOnce(new Error('db down'))
    const res = await send({ leadId: LEAD.id, email: 'a@b.com', consent: true })
    expect(res.status).toBe(200)
  })

  it('refuses calls from other sites and made-up lead ids', async () => {
    reportNet(LEAD)
    const other = await report(
      req('/api/public/site-check/report', { leadId: LEAD.id, email: 'a@b.com', consent: true }, { origin: 'https://evil.example' }),
    )
    expect(other.status).toBe(403)
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect((await send({ leadId: 'fallback-123', email: 'a@b.com', consent: true })).status).toBe(400)
  })
})
