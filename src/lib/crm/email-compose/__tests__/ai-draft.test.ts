import { beforeEach, describe, expect, it, vi } from 'vitest'

const tables: Record<string, unknown> = {}
vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'in']) q[m] = () => q
    q.maybeSingle = async () => ({ data: tables[table] ?? null })
    q.then = (res: (v: unknown) => unknown) => res({ data: tables[table] ?? [] })
    return q
  }
  return { supabaseAdmin: { from: (t: string) => chain(t) } }
})
vi.mock('@/lib/messenger/brief', () => ({
  loadClientIdentity: vi.fn(async () => ({ name: 'Acme Tours', industry: 'travel', country: 'NZ' })),
  loadClientFacts: vi.fn(async () => ({ status: 'ok', entries: [] })),
  clientFactsBlock: vi.fn(() => '\nCLIENT FACTS — x\n- fact\n'),
  currencyRuleFor: (c: string | null | undefined) => (c === 'NZ' ? 'CURRENCY — NZD in the Chinese fields.\n' : ''),
}))
const askJson = vi.fn()
vi.mock('@/lib/ai/failover', () => ({ askJson: (...a: unknown[]) => askJson(...a) }))

import { loadClientFacts } from '@/lib/messenger/brief'
import { buildDraftSystemPrompt, generateFirstEmailDraft, renderKnownContext } from '../ai-draft'

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(p).not.toContain('Chinese fields')
    expect(p).toMatch(/Never invent prices, dates/)
    expect(p).toMatch(/never send/i)
  })
  it('states no currency rule when country unknown', () => {
    expect(buildDraftSystemPrompt('X', null, '')).not.toContain('CURRENCY')
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

  it('model failure → no_ai, never throws', async () => {
    askJson.mockRejectedValueOnce(new Error('all down'))
    const r = await generateFirstEmailDraft('c1', 'p1')
    expect(r).toMatchObject({ ok: false, reason: 'no_ai' })
  })
})
