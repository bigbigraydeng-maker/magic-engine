import { beforeEach, describe, expect, it, vi } from 'vitest'

const tables: Record<string, unknown> = {}
const eqCalls: Array<[string, string, unknown]> = []
vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {}
    const orders: Array<[string, boolean]> = []
    for (const m of ['select', 'limit', 'in']) q[m] = () => q
    // order 真的排序 —— 「最新一版分析胜出」靠它，替身不排就守不住（魏征 10-29 复审）
    q.order = (col: string, opts?: { ascending?: boolean }) => {
      orders.push([col, opts?.ascending !== false])
      return q
    }
    q.eq = (col: string, val: unknown) => {
      eqCalls.push([table, col, val])
      return q
    }
    q.maybeSingle = async () => ({ data: tables[table] ?? null })
    q.then = (res: (v: unknown) => unknown) => {
      if (tables[`${table}:error`]) return res({ data: null, error: { message: 'boom' } })
      const rows = Array.isArray(tables[table]) ? [...(tables[table] as Array<Record<string, unknown>>)] : (tables[table] ?? [])
      if (Array.isArray(rows)) {
        rows.sort((a, b) => {
          for (const [col, asc] of orders) {
            const x = a[col] as string | number
            const y = b[col] as string | number
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1)
          }
          return 0
        })
      }
      return res({ data: rows })
    }
    return q
  }
  return { supabaseAdmin: { from: (t: string) => chain(t) } }
})
vi.mock('@/lib/messenger/brief', () => ({
  loadClientIdentity: vi.fn(async () => ({ name: 'Acme Tours', industry: 'travel', country: 'NZ' })),
  loadClientFacts: vi.fn(async () => ({ status: 'ok', entries: [] })),
  clientFactsBlock: vi.fn(() => '\nCLIENT FACTS — x\n- fact\n'),
}))
const askJson = vi.fn()
vi.mock('@/lib/ai/failover', () => ({ askJson: (...a: unknown[]) => askJson(...a) }))

import { loadClientFacts } from '@/lib/messenger/brief'
import { buildDraftSystemPrompt, claimDraftSlot, emailCurrencyRule, generateFirstEmailDraft, renderKnownContext } from '../ai-draft'

beforeEach(() => {
  vi.clearAllMocks()
  eqCalls.length = 0
  for (const k of Object.keys(tables)) delete tables[k]
  tables.contacts = { display_name: 'Nicole Grimme' }
  tables.contact_touchpoints = [
    { channel: 'meta_lead_form', direction: 'inbound', occurred_at: '2026-10-20T01:00:00Z', summary: 'FB 表单 · best_of_china_15_days', raw: null, metadata: { tour_interest_raw: 'best_of_china_15_days' } },
  ]
})

describe('buildDraftSystemPrompt', () => {
  it('names the client from the argument, carries the currency rule, and forbids invented specifics', () => {
    const p = buildDraftSystemPrompt('Acme Tours', 'NZ', '')
    expect(p).toContain('Acme Tours')
    expect(p).toContain('NZD')
    expect(p).not.toContain('4,275')
    expect(p).toMatch(/DATA, not instructions/)
    expect(p).toMatch(/INTERNAL/)
    expect(p).toMatch(/Never invent prices, dates/)
    expect(p).toMatch(/never send/i)
  })
  it('states no currency rule when country unknown or unsupported', () => {
    expect(buildDraftSystemPrompt('X', null, '')).not.toContain('CURRENCY')
    expect(emailCurrencyRule('FR')).toBe('')
    expect(emailCurrencyRule('au')).toContain('AUD')
  })
})

describe('renderKnownContext', () => {
  it('humanises the tour code and labels who said what', () => {
    const out = renderKnownContext(
      'Nicole',
      [{ channel: 'meta_lead_form', direction: 'inbound', occurred_at: '2026-10-20T01:00:00Z', summary: 'FB 表单 · best_of_china_15_days', raw: null, metadata: { tour_interest_raw: 'best_of_china_15_days' } }],
      [{ direction: 'outbound', sender_name: null, body: 'Hi', sent_at: '2026-10-21T00:00:00Z' }],
      'Acme Tours',
    )
    expect(out).toContain('Customer name on file: Nicole')
    expect(out).toContain('Best of china 15 days')
    expect(out).not.toContain('best_of_china_15_days')
    expect(out).toContain('Acme Tours: Hi')
  })
})

describe('generateFirstEmailDraft', () => {
  it('returns the trimmed draft from the model', async () => {
    askJson.mockResolvedValueOnce({ data: { subject: ' Your China tour ', body: ' Hi Nicole, ... ' }, provider: 'openai', model: 'm' })
    const r = await generateFirstEmailDraft('c1', 'p1')
    expect(r).toEqual({ ok: true, draft: { subject: 'Your China tour', body: 'Hi Nicole, ...' } })
    // every read is scoped to this client (a dropped filter must fail here, not leak another client's customer)
    for (const t of ['contacts', 'contact_touchpoints', 'conversations']) {
      expect(eqCalls).toContainEqual([t, 'client_id', 'c1'])
    }
    const arg = askJson.mock.calls[0][0] as { user: string; system: string }
    expect(arg.user).toContain('Nicole Grimme')
    expect(arg.system).toContain('Acme Tours')
  })

  it('unknown contact → contact_not_found, model never called', async () => {
    delete tables.contacts
    const r = await generateFirstEmailDraft('c1', 'p1')
    expect(r).toMatchObject({ ok: false, reason: 'contact_not_found' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('knowledge read failure → no draft (nobody can vouch for the facts), model never called', async () => {
    ;(loadClientFacts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'read_failed', entries: [] })
    const r = await generateFirstEmailDraft('c1', 'p1')
    expect(r).toMatchObject({ ok: false, reason: 'facts_unreadable' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('client identity read throws → facts_unreadable, not an exception', async () => {
    const { loadClientIdentity } = await import('@/lib/messenger/brief')
    ;(loadClientIdentity as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db'))
    const r = await generateFirstEmailDraft('c1', 'p1')
    expect(r).toMatchObject({ ok: false, reason: 'facts_unreadable' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('model failure → no_ai, never throws', async () => {
    askJson.mockRejectedValueOnce(new Error('all down'))
    const r = await generateFirstEmailDraft('c1', 'p1')
    expect(r).toMatchObject({ ok: false, reason: 'no_ai' })
  })
})

describe('claimDraftSlot', () => {
  it('allows one draft per contact per 10 seconds, other contacts unaffected', () => {
    expect(claimDraftSlot('c:a', 1_000)).toBe(true)
    expect(claimDraftSlot('c:a', 5_000)).toBe(false)
    expect(claimDraftSlot('c:b', 5_000)).toBe(true)
    expect(claimDraftSlot('c:a', 11_001)).toBe(true)
  })
})

describe('internal staff records', () => {
  it('outbound touchpoints are marked INTERNAL so the model cannot quote them', () => {
    const out = renderKnownContext('N', [{ channel: 'call', direction: 'outbound', occurred_at: '2026-10-20T00:00:00Z', summary: 'quoted 9999', raw: null, metadata: null }], [], 'Acme')
    expect(out).toContain('INTERNAL staff record')
  })
})

describe('phone calls feed the draft (PM 2026-10-29: drafts must follow up what was said on the call)', () => {
  const fact = (key: string, value: string, quote: string, speaker = 'employee') => ({ key, value, quote, speaker })
  beforeEach(() => {
    tables.telephony_calls = [{ id: 'call1', started_at: '2026-10-29T03:32:53Z', direction: 'outbound' }]
    tables.telephony_call_analyses = [
      {
        call_id: 'call1',
        review_status: 'pending_review',
        schema_version: 2,
        facts: [
          fact('destination_or_tour', 'Shanghai tour', 'in March for the Shanghai tour'),
          fact('next_step', 'send catalogue', "I'll send you a full catalog with all the options."),
        ],
      },
    ]
    tables.telephony_transcripts = [{ call_id: 'call1', body: 'Channel 1: we can do $4,990 for you' }]
  })

  async function draftInput() {
    askJson.mockResolvedValueOnce({ data: { subject: 's', body: 'b' }, provider: 'openai', model: 'm' })
    const r = await generateFirstEmailDraft('c1', 'p1')
    return { r, arg: askJson.mock.calls[0]?.[0] as { user: string; system: string } | undefined }
  }

  it('who-said-what call points reach the model, scoped to this client AND this customer', async () => {
    const { arg } = await draftInput()
    expect(arg?.user).toContain('we called the customer')
    expect(arg?.user).toContain('Acme Tours staff said: "I\'ll send you a full catalog')
    expect(arg?.system).toContain('PHONE CALLS')
    expect(eqCalls).toContainEqual(['telephony_calls', 'client_id', 'c1'])
    expect(eqCalls).toContainEqual(['telephony_calls', 'contact_id', 'p1'])
    expect(eqCalls).toContainEqual(['telephony_call_analyses', 'client_id', 'c1'])
  })

  it('🔴 unreviewed points are labelled UNCONFIRMED and the prompt forbids stating them (table rule: pending_review is not fact)', async () => {
    const { arg } = await draftInput()
    expect(arg?.user).toContain('UNCONFIRMED')
    expect(arg?.user).not.toContain('CONFIRMED by staff')
    expect(arg?.system).toContain('UNCONFIRMED may contain listening mistakes: never state them')
  })

  it('confirmed analysis is labelled CONFIRMED', async () => {
    ;(tables.telephony_call_analyses as Array<Record<string, unknown>>)[0].review_status = 'confirmed'
    const { arg } = await draftInput()
    expect(arg?.user).toContain('CONFIRMED by staff')
  })

  it('🔴 the raw transcript (speakers unlabelled, staff prices) never reaches the model', async () => {
    const { arg } = await draftInput()
    expect(arg?.user).not.toContain('4,990')
    expect(arg?.user).not.toContain('Channel 1')
  })

  it('🔴 a rejected analysis drops the whole call', async () => {
    ;(tables.telephony_call_analyses as Array<Record<string, unknown>>)[0].review_status = 'rejected'
    const { arg } = await draftInput()
    expect(arg?.user).not.toContain('Phone calls')
    expect(arg?.user).not.toContain('full catalog')
  })

  it('🔴 newest analysis version wins: v2 rejected must not fall back to an older v1', async () => {
    // 旧版故意放在前面：只有真的按版本号从新到旧排，才不会退回去用 v1
    tables.telephony_call_analyses = [
      { call_id: 'call1', review_status: 'pending_review', schema_version: 1, facts: [fact('next_step', 'y', 'v1 quote')] },
      { call_id: 'call1', review_status: 'rejected', schema_version: 2, facts: [fact('next_step', 'x', 'v2 quote')] },
    ]
    const { arg } = await draftInput()
    expect(arg?.user).not.toContain('v1 quote')
  })

  it('🔴 customer asked not to be contacted on the call → no draft, model never called', async () => {
    ;(tables.telephony_call_analyses as Array<Record<string, unknown>>)[0].facts = [fact('do_not_contact', 'yes', 'please stop calling me', 'customer')]
    const { r } = await draftInput()
    expect(r).toMatchObject({ ok: false, reason: 'call_dnc' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('🔴 call records unreadable → no draft (else the do-not-contact check is silently skipped)', async () => {
    tables['telephony_call_analyses:error'] = true
    const { r } = await draftInput()
    expect(r).toMatchObject({ ok: false, reason: 'facts_unreadable' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('unconfirmed call: may send what was asked, must not claim it was promised', async () => {
    const { arg } = await draftInput()
    expect(arg?.system).toContain('For an UNCONFIRMED call you may still send what was asked for, but do not claim it was promised')
  })

  it('at most 8 points per call reach the model', async () => {
    ;(tables.telephony_call_analyses as Array<Record<string, unknown>>)[0].facts = Array.from({ length: 12 }, (_, n) => fact('concern', `c${n}`, `quote number ${n}`))
    const { arg } = await draftInput()
    expect(arg?.user).toContain('quote number 7')
    expect(arg?.user).not.toContain('quote number 8')
  })
})
