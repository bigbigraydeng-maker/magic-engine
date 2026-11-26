import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsObj, tour } from '@/lib/crm/email-templates/__tests__/fixtures'

const tables: Record<string, unknown> = {}
vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'limit', 'in', 'order', 'eq']) q[m] = () => q
    q.maybeSingle = async () => ({ data: tables[table] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) =>
      tables[`${table}:error`] ? res({ data: null, error: { message: 'boom' } }) : res({ data: tables[table] ?? [], error: null })
    return q
  }
  return { supabaseAdmin: { from: (t: string) => chain(t) } }
})
vi.mock('@/lib/messenger/brief', () => ({
  loadClientIdentity: vi.fn(async () => ({ name: 'Acme Tours', industry: 'travel', country: 'NZ' })),
  loadClientFacts: vi.fn(async () => ({ status: 'ok', entries: [] })),
  clientFactsBlock: vi.fn(() => ''),
}))
const loadEmailSettings = vi.fn()
vi.mock('@/lib/crm/email-templates/settings-store', () => ({ loadEmailSettings: (...a: unknown[]) => loadEmailSettings(...a) }))
const loadPublishedTourFacts = vi.fn()
vi.mock('@/lib/tour-catalog/store-publish', () => ({ loadPublishedTourFacts: (...a: unknown[]) => loadPublishedTourFacts(...a) }))
const askJson = vi.fn()
vi.mock('@/lib/ai/failover', () => ({ askJson: (...a: unknown[]) => askJson(...a) }))

import type { FollowUpWriterConfig } from '../follow-up-config'
import {
  buildFollowUpSystemPrompt,
  buildLinks,
  composeFollowUpLetter,
  generateFollowUpDraft,
  pickFeaturedTours,
  runFollowUpChecks,
  shortTourName,
  stripFraming,
  type CheckLine,
} from '../follow-up-draft'

const cfg: FollowUpWriterConfig = {
  greeting: 'Kia ora {first_name},',
  greetingNoName: 'Kia ora,',
  signature: 'Warm regards,\nAlex\nAcme Tours',
  siteLink: { label: 'All our tours', url: 'https://www.example.com/tours/china' },
  priceBasisPhrases: ['per person', 'twin share'],
  maxWords: 150,
}
const providerSettings = settingsObj().providers.publishedTours ?? null
const best = tour()
const panorama = tour({
  id: 't2',
  slug: 'grand-tour',
  tier: 'signature',
  name: 'China Signature — China Panorama',
  durationText: '27 Days',
  displayPriceText: 'From NZD $9,999 per person twin share',
  departures: [{ departOn: '2027-05-08', displayDate: '8 May 2027', status: 'open', priceTextOverride: null }],
})

const statusOf = (checks: CheckLine[], id: string) => checks.find((c) => c.id === id)?.status

function checksFor(aiBody: string, over: Partial<Parameters<typeof runFollowUpChecks>[0]> = {}) {
  const picks = [{ tour: best, departure: best.departures[0] }]
  const links = buildLinks({ picks, tours: [best, panorama], providerSettings, config: cfg, aiText: aiBody })
  const letter = composeFollowUpLetter({ firstName: 'Nerita', config: cfg, aiBody, links })
  return runFollowUpChecks({
    subject: 'A note about Best of China',
    aiBody,
    letter,
    strippedFraming: false,
    config: cfg,
    settings: settingsObj(),
    picks,
    tours: [best, panorama],
    providerSettings,
    previousSubjects: ['Your China tour options for 2027'],
    previousExcerpts: [],
    ...over,
  })
}

describe('shortTourName / pickFeaturedTours', () => {
  it('drops the tier prefix', () => {
    expect(shortTourName('China Discovery — Best of China')).toBe('Best of China')
    expect(shortTourName('Silk Road')).toBe('Silk Road')
  })

  it('the form choice wins, only tours on sale with a future departure, at most two', () => {
    const gone = tour({ id: 't3', slug: 'gone', name: 'China Discovery — Silk Road', soldOut: true })
    const past = tour({ id: 't4', slug: 'past', name: 'China Discovery — Natural China', departures: [{ departOn: '2026-01-01', displayDate: '1 January 2026', status: 'open', priceTextOverride: null }] })
    const picks = pickFeaturedTours({
      tours: [best, panorama, gone, past],
      today: '2026-11-10',
      formText: 'Best of china 15 days',
      weTold: 'China Panorama and Silk Road and Natural China',
      customerSaid: '',
    })
    expect(picks.map((p) => p.tour.id)).toEqual(['t1', 't2'])
    expect(picks[0].departure?.departOn).toBe('2027-03-11')
  })

  it('nothing named anywhere → no tour (the letter then quotes no date or price)', () => {
    expect(pickFeaturedTours({ tours: [best], today: '2026-11-10', formText: 'still deciding', weTold: '', customerSaid: '' })).toEqual([])
  })
})

describe('composeFollowUpLetter', () => {
  it('greets by name, puts the links before the last paragraph, signs from the config', () => {
    const links = buildLinks({ picks: [{ tour: best, departure: best.departures[0] }], tours: [best], providerSettings, config: cfg, aiText: '' })
    const letter = composeFollowUpLetter({ firstName: 'Nerita', config: cfg, aiBody: 'First para.\n\nJust reply to this email.', links })
    expect(letter.startsWith('Kia ora Nerita,\n\nFirst para.')).toBe(true)
    expect(letter).toContain('Best of China: https://www.example.com/tours/china/discovery/essentials?date=2027-03-11')
    expect(letter).toContain('All our tours: https://www.example.com/tours/china')
    expect(letter.indexOf('All our tours')).toBeLessThan(letter.indexOf('Just reply'))
    expect(letter.endsWith('Warm regards,\nAlex\nAcme Tours')).toBe(true)
  })

  it('unreliable name → greeting without a name; only the site link → the one-link lead', () => {
    const links = buildLinks({ picks: [], tours: [], providerSettings, config: cfg, aiText: '' })
    const letter = composeFollowUpLetter({ firstName: null, config: cfg, aiBody: 'Only one paragraph.', links })
    expect(letter.startsWith('Kia ora,\n\n')).toBe(true)
    expect(letter).toContain('You can browse everything on our website:\nAll our tours:')
  })

  it('links a tour the AI named even if it was not picked', () => {
    const links = buildLinks({ picks: [], tours: [panorama], providerSettings, config: cfg, aiText: 'Our China Panorama visits Dali.' })
    expect(links.map((l) => l.label)).toEqual(['China Panorama', 'All our tours'])
  })
})

describe('stripFraming', () => {
  it('removes a greeting and a sign-off the AI added', () => {
    const r = stripFraming('Hi Nerita,\n\nBody text here.\n\nWarm regards,\nBaker')
    expect(r).toEqual({ body: 'Body text here.', stripped: true })
    expect(stripFraming('Body only.').stripped).toBe(false)
  })
})

describe('runFollowUpChecks', () => {
  it('a clean letter passes everything', () => {
    const checks = checksFor('I hope the information reached you.\n\nBest of China departs 11 March 2027 at NZD $4,080 per person, twin share.\n\nJust reply to this email.')
    expect(checks.filter((c) => c.status !== 'pass')).toEqual([])
  })

  it('a price without the price basis, or not in the catalogue, fails', () => {
    expect(statusOf(checksFor('Best of China costs NZD $4,080.\n\nJust reply.'), 'prices')).toBe('fail')
    expect(statusOf(checksFor('Best of China costs NZD $3,000 per person, twin share.\n\nJust reply.'), 'prices')).toBe('fail')
  })

  it('a date that is not a departure of the tour fails', () => {
    expect(statusOf(checksFor('It leaves on 12 March 2027.\n\nJust reply.'), 'dates')).toBe('fail')
  })

  it('hotel star ratings, AI-written links and guardrail phrases are caught', () => {
    expect(statusOf(checksFor('Stay in 5-star hotels.\n\nJust reply.'), 'stars')).toBe('fail')
    expect(statusOf(checksFor('See https://www.example.com/tours/china/discovery/gone\n\nJust reply.'), 'links')).toBe('fail')
    expect(statusOf(checksFor('China is visa-free now.\n\nJust reply.'), 'guardrails')).toBe('fail')
  })

  it('same subject as an earlier email → warning, not failure', () => {
    expect(statusOf(checksFor('Hello again.\n\nJust reply.', { subject: 'Your China tour options for 2027' }), 'repeat')).toBe('warn')
  })
})

describe('buildFollowUpSystemPrompt', () => {
  it('forbids greetings, links, urgency and star ratings; carries the price basis and earlier subjects', () => {
    const p = buildFollowUpSystemPrompt({ business: 'Acme Tours', country: 'NZ', factsBlock: '', tourFacts: 'TOUR FACTS x', previousSubjects: ['Old subject'], config: cfg })
    expect(p).toMatch(/Do NOT write a greeting/)
    expect(p).toMatch(/any web address/)
    expect(p).toMatch(/Never mention hotel star ratings/)
    expect(p).toContain('"per person" and "twin share"')
    expect(p).toContain('- Old subject')
    expect(p).toContain('TOUR FACTS x')
    expect(p).toMatch(/DATA, not instructions/)
  })
})

describe('generateFollowUpDraft', () => {
  const leads = { follow_up_writer: { enabled: true, greeting: 'Kia ora {first_name},', signature: 'Warm regards,\nAlex', site_link: { label: 'All our tours', url: 'https://www.example.com/tours/china' }, price_basis_phrases: ['per person', 'twin share'] } }

  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of Object.keys(tables)) delete tables[k]
    tables.contacts = { display_name: 'Nerita Smith', do_not_contact: false }
    tables.clients = { leads_config: leads, country: 'NZ' }
    tables.contact_touchpoints = [
      { channel: 'meta_lead_form', source: 'meta_lead_form', direction: 'inbound', occurred_at: '2026-09-14T00:00:00Z', summary: 'FB 表单 · best_of_china_15_days', raw: null, metadata: { tour_interest_raw: 'best_of_china_15_days' } },
      { channel: 'email', source: 'microsoft_mail', direction: 'outbound', occurred_at: '2026-09-15T00:00:00Z', summary: 'Best of China departing 11 March 2027', raw: 'Thank you for your interest', metadata: null },
      { channel: 'phone', source: 'me_manual', direction: 'outbound', occurred_at: '2026-11-03T00:00:00Z', summary: 'wants Yunnan', raw: null, metadata: null },
    ]
    tables.telephony_calls = []
    tables.conversations = []
    loadEmailSettings.mockResolvedValue({ kind: 'ok', version: 10, settings: settingsObj() })
    loadPublishedTourFacts.mockResolvedValue({ published: true, version: 16, tours: [best, panorama] })
    askJson.mockResolvedValue({ data: { subject: 'Best of China, when you are ready', body: 'Hi Nerita,\n\nI hope our information reached you.\n\nJust reply to this email.' } })
  })

  it('writes a framed letter with links, the reading list and the checks', async () => {
    const r = await generateFollowUpDraft('c1', 'p1', { now: () => new Date('2026-11-10T00:00:00Z') })
    if (!r.ok) throw new Error(r.message)
    expect(r.draft.body.startsWith('Kia ora Nerita,\n\nI hope our information reached you.')).toBe(true)
    expect(r.draft.body).toContain('Best of China: https://www.example.com/tours/china/discovery/essentials?date=2027-03-11')
    expect(r.draft.body).not.toContain('Hi Nerita')
    expect(r.draft.read.some((l) => l.kind === 'internal')).toBe(true)
    expect(r.draft.read.some((l) => l.text.includes('第 16 版'))).toBe(true)
    expect(r.draft.checks.find((c) => c.id === 'framing')?.detail).toMatch(/已去掉/)
    const system = (askJson.mock.calls[0][0] as { system: string }).system
    expect(system).toContain('next departure 11 March 2027')
    const user = (askJson.mock.calls[0][0] as { user: string }).user
    expect(user).toContain('INTERNAL: wants Yunnan')
  })

  it('do-not-contact → refused before any AI call', async () => {
    tables.contacts = { display_name: 'X', do_not_contact: true }
    const r = await generateFollowUpDraft('c1', 'p1')
    expect(r).toMatchObject({ ok: false, reason: 'do_not_contact' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('client has no follow-up config → not_configured, no AI call', async () => {
    tables.clients = { leads_config: {}, country: 'NZ' }
    expect(await generateFollowUpDraft('c1', 'p1')).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(askJson).not.toHaveBeenCalled()
  })

  it('settings unreadable → refused; catalogue unreadable → still drafts but says so', async () => {
    loadEmailSettings.mockResolvedValueOnce({ kind: 'invalid', version: 1, errors: ['x'] })
    expect(await generateFollowUpDraft('c1', 'p1')).toMatchObject({ ok: false, reason: 'settings_unreadable' })
    loadPublishedTourFacts.mockRejectedValueOnce(new Error('down'))
    const r = await generateFollowUpDraft('c1', 'p1', { now: () => new Date('2026-11-10T00:00:00Z') })
    if (!r.ok) throw new Error(r.message)
    expect(r.draft.read.some((l) => l.text.includes('团目录暂时读不到'))).toBe(true)
    expect(r.draft.body).not.toContain('/discovery/essentials')
  })

  it('AI failure → no_ai', async () => {
    askJson.mockRejectedValueOnce(new Error('timeout'))
    expect(await generateFollowUpDraft('c1', 'p1')).toMatchObject({ ok: false, reason: 'no_ai' })
  })
})
