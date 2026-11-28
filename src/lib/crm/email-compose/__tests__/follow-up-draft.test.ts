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
  checkFollowUpLetter,
  withoutSystemFraming,
  NO_CONVERSATION_NOTE,
  LINK_LEAD_MANY,
  pickFeaturedTours,
  runFollowUpChecks,
  spokeWithGuest,
  namesTour,
  onSaleNote,
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

describe('tour names in the letter (found in the 2026-11-28 trial drafts)', () => {
  const highlights = tour({ id: 't9', slug: 'highlights', destination: 'japan', name: 'Japan Discovery — Highlights', departures: [] })
  const golden = tour({ id: 't8', slug: 'golden-china', name: 'China Discovery — Golden China', isActive: false, departures: [] })

  it('a one-word tour name is an everyday word: "highlights like the Great Wall" does not name the tour', () => {
    expect(namesTour('It promises highlights like the Great Wall.', 'Highlights')).toBe(false)
    expect(namesTour('Our Highlights tour is popular.', 'Highlights')).toBe(false)
    expect(namesTour('Our China Panorama visits Dali.', 'China Panorama')).toBe(true)
    expect(namesTour('a wide china panorama of options', 'China Panorama')).toBe(false)
  })

  it('no link to another destination\'s tour is added because of an everyday word', () => {
    const links = buildLinks({ picks: [{ tour: best, departure: best.departures[0] }], tours: [best, highlights], providerSettings, config: cfg, aiText: 'It promises highlights like the Great Wall.' })
    expect(links.map((l) => l.label)).not.toContain('Highlights')
  })

  it('a letter that offers a tour taken off sale fails the check, naming the tour', () => {
    const c = checksFor('We have wonderful options, including the Golden China tour.', { tours: [best, golden] }).find((x) => x.id === 'off_sale_tour')
    expect(c?.status).toBe('fail')
    expect(c?.detail).toContain('Golden China')
  })

  it('tours on sale, and ordinary words, pass', () => {
    expect(statusOf(checksFor('Our Best of China tour leaves in March.', { tours: [best, golden] }), 'off_sale_tour')).toBe('pass')
    expect(statusOf(checksFor('A golden opportunity to see China.', { tours: [best, golden] }), 'off_sale_tour')).toBe('pass')
  })

  it('the writer is told which tours are on sale today, by short name, without the ones taken off sale', () => {
    const note = onSaleNote([best, panorama, golden])
    expect(note).toContain('Best of China; China Panorama')
    expect(note).not.toContain('Golden China')
    expect(onSaleNote([golden])).toBe('')
  })

  it('a guest asking about one destination is not handed the tour names of another', () => {
    const note = onSaleNote([best, highlights], [{ tour: best, departure: best.departures[0] }])
    expect(note).toContain('Best of China')
    expect(note).not.toContain('Highlights')
    // Nothing known about what the guest wants: every tour on sale may be named.
    expect(onSaleNote([best, highlights])).toContain('Highlights')
  })

  it('two tours on sale with the same short name: the words cannot say which, so no extra link is added', () => {
    const classicChina = tour({ id: 'tc', slug: 'classic-china', name: 'China Discovery — Classic Tour', departures: [] })
    const classicJapan = tour({ id: 'tj', slug: 'classic-japan', destination: 'japan', name: 'Japan Discovery — Classic Tour', departures: [] })
    const links = buildLinks({ picks: [], tours: [classicChina, classicJapan], providerSettings, config: cfg, aiText: 'Our Classic Tour is popular.' })
    expect(links.map((l) => l.label)).not.toContain('Classic Tour')
  })

  it('an off-sale tour is caught whatever the capitals or the kind of apostrophe', () => {
    const xian = tour({ id: 'tx', slug: 'xian-stay', name: "China Stopover — Xi'an Stay", isActive: false, departures: [] })
    expect(statusOf(checksFor('we also have the golden china tour', { tours: [best, golden] }), 'off_sale_tour')).toBe('fail')
    expect(statusOf(checksFor('Try our Xi’an Stay.', { tours: [best, xian] }), 'off_sale_tour')).toBe('fail')
  })

  it('"inquiry" is flagged as American spelling', () => {
    expect(statusOf(checksFor('Thank you for your inquiry.'), 'spelling')).toBe('warn')
  })
})

describe('the conversation check (exam questions from the 2026-11-28 reconnect letters)', () => {
  const line = (aiBody: string, spoke: boolean | undefined) => checksFor(aiBody, { spokeWithGuest: spoke }).find((c) => c.id === 'conversation_claim')

  it('"when we spoke" to a guest nobody reached is a fail, quoting the phrase', () => {
    const c = line('When we spoke in October, we said we would send you the details.', false)
    expect(c?.status).toBe('fail')
    expect(c?.detail).toContain('When we spoke')
  })

  it('catches the other ways of saying we talked', () => {
    for (const body of [
      'As discussed, here are the dates.', 'Following our call last week.', 'It was lovely chatting with you.', 'Our team spoke with you about China.',
      'Thanks for your time on the phone.', 'Since we last spoke, prices have changed.', 'As we talked about, March suits.', 'I enjoyed speaking with you.',
      'It was a pleasure talking with you.', 'Thanks for taking my call.', 'Thanks for the chat.', 'Per our discussion, here are the options.', 'After our conversation I looked into it.',
    ]) {
      expect(line(body, false)?.status, body).toBe('fail')
    }
  })

  it('does not block a good letter: invitations to talk, and what the guest wrote, are not a claim that we talked', () => {
    for (const body of [
      'We can discuss this on the phone if you prefer.', 'Happy to chat on the phone anytime.', 'Is there a good time to have a chat over the phone?', 'You mentioned in your form that March suits you.',
      'It is your call, no pressure.', 'Our chat line is open on weekdays.', 'Feel free to give us a call on 0800 000 000.', 'If you have any questions, I am happy to talk them through.',
    ]) {
      expect(line(body, false)?.status, body).toBe('pass')
    }
  })

  it('the same words are fine when a call really reached the guest', () => {
    expect(line('When we spoke in October, you were looking at March.', true)?.status).toBe('pass')
  })

  it('a neutral opening passes whether or not we talked', () => {
    expect(line('Thank you for your enquiry. Here are the 2027 dates.', false)?.status).toBe('pass')
    expect(line('Thank you for your enquiry. Here are the 2027 dates.', true)?.status).toBe('pass')
  })

  it('a caller that did not work out whether we talked gets no such line (nothing claimed either way)', () => {
    expect(line('When we spoke in October.', undefined)).toBeUndefined()
  })
})

describe('spokeWithGuest', () => {
  const call = (metadata: Record<string, unknown>, minutes = 0, source = 'twilio') => ({ channel: 'phone', source, direction: 'outbound', occurred_at: new Date(Date.UTC(2026, 10, 10, 0, minutes)).toISOString(), summary: null, raw: null, metadata })

  it('a voicemail or an unanswered call is not a conversation', () => {
    expect(spokeWithGuest([call({ outcome: 'spoke', customer_spoke: 'no' }), call({ outcome: 'no_answer' }, 5)])).toBe(false)
  })

  it('a call where the guest spoke is', () => {
    expect(spokeWithGuest([call({ outcome: 'spoke', customer_spoke: 'yes' })])).toBe(true)
  })

  it('a staff note written right after a failed call describes that call, not a talk', () => {
    expect(spokeWithGuest([call({ customer_spoke: 'no' }), call({}, 3, 'me_manual')])).toBe(false)
  })

  it('a staff note on its own (rang from another phone) counts as talked', () => {
    expect(spokeWithGuest([call({ outcome: 'spoke' }, 0, 'me_manual')])).toBe(true)
  })

  it('no phone record at all is not a conversation', () => {
    expect(spokeWithGuest([{ channel: 'email', source: 'microsoft_mail', direction: 'outbound', occurred_at: '2026-11-10T00:00:00Z', summary: null, raw: null, metadata: null }])).toBe(false)
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

  it('tells the writer there was no phone conversation, lists the tours on sale, and carries the conversation check', async () => {
    const r = await generateFollowUpDraft('c1', 'p1', { now: () => new Date('2026-11-10T00:00:00Z') })
    if (!r.ok) throw new Error(r.message)
    const user = (askJson.mock.calls[0][0] as { user: string }).user
    // The only phone record is a staff note with no outcome saying the guest was reached... it counts as talked.
    expect(user).not.toContain(NO_CONVERSATION_NOTE.trim())
    expect(user).toContain('TOURS ON SALE TODAY')
    expect(r.draft.checks.some((c) => c.id === 'conversation_claim')).toBe(true)
    expect(r.draft.checks.some((c) => c.id === 'off_sale_tour')).toBe(true)
  })

  it('no call reached the guest: the writer is told so, and a draft that claims a talk fails its check', async () => {
    tables.contact_touchpoints = (tables.contact_touchpoints as Array<Record<string, unknown>>).filter((t) => t.channel !== 'phone')
    ;(tables.contact_touchpoints as Array<Record<string, unknown>>).push({ channel: 'phone', source: 'twilio', direction: 'outbound', occurred_at: '2026-11-03T00:00:00Z', summary: null, raw: null, metadata: { outcome: 'spoke', customer_spoke: 'no' } })
    askJson.mockResolvedValue({ data: { subject: 'Best of China', body: 'When we spoke last week, you asked about March.\n\nJust reply to this email.' } })
    const r = await generateFollowUpDraft('c1', 'p1', { now: () => new Date('2026-11-10T00:00:00Z') })
    if (!r.ok) throw new Error(r.message)
    expect((askJson.mock.calls[0][0] as { user: string }).user).toContain(NO_CONVERSATION_NOTE.trim())
    expect(r.draft.checks.find((c) => c.id === 'conversation_claim')?.status).toBe('fail')
  })

  describe('checkFollowUpLetter — the same checks on the text a person is about to send', () => {
    const noCall = () => { tables.contact_touchpoints = (tables.contact_touchpoints as Array<Record<string, unknown>>).filter((t) => t.channel !== 'phone') }

    it('calls no model and returns the checks for the edited text', async () => {
      noCall()
      const r = await checkFollowUpLetter('c1', 'p1', { subject: 'Best of China', body: 'Kia ora Nerita,\n\nWhen we spoke, you asked about March.\n\nWarm regards,\nAlex' }, { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!r.ok) throw new Error(r.message)
      expect(askJson).not.toHaveBeenCalled()
      expect(r.checks.find((c) => c.id === 'conversation_claim')?.status).toBe('fail')
    })

    it('the links the system itself put in the letter are not "a URL the AI wrote"; a URL from anywhere else still fails', async () => {
      noCall()
      const drafted = await generateFollowUpDraft('c1', 'p1', { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!drafted.ok) throw new Error(drafted.message)
      expect(drafted.draft.body).toContain('https://www.example.com/tours/china')
      const same = await checkFollowUpLetter('c1', 'p1', { subject: drafted.draft.subject, body: drafted.draft.body }, { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!same.ok) throw new Error(same.message)
      // The untouched draft passes the same checks at release as it did when drafted.
      expect(same.checks.filter((c) => c.status === 'fail')).toEqual([])
      const added = await checkFollowUpLetter('c1', 'p1', { subject: drafted.draft.subject, body: `${drafted.draft.body}\n\nSee also https://www.example.com/somewhere-else.` }, { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!added.ok) throw new Error(added.message)
      const links = added.checks.find((c) => c.id === 'links')
      expect(links?.status).toBe('fail')
      expect(links?.detail).toContain('somewhere-else')
      expect(links?.detail).not.toContain('AI 自己写了')
    })

    it('a guest whose name is not in Latin script: the untouched draft still passes at release (the greeting is ours, not the writing)', async () => {
      noCall()
      tables.contacts = { display_name: '王小明', do_not_contact: false }
      const drafted = await generateFollowUpDraft('c1', 'p1', { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!drafted.ok) throw new Error(drafted.message)
      expect(drafted.draft.body).toContain('王小明')
      const again = await checkFollowUpLetter('c1', 'p1', { subject: drafted.draft.subject, body: drafted.draft.body }, { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!again.ok) throw new Error(again.message)
      expect(again.checks.filter((c) => c.status === 'fail')).toEqual([])
      // Chinese written into the body by a person is still caught.
      const edited = await checkFollowUpLetter('c1', 'p1', { subject: drafted.draft.subject, body: drafted.draft.body.replace('I hope our information reached you.', '希望您收到了我们的资料。') }, { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!edited.ok) throw new Error(edited.message)
      expect(edited.checks.find((c) => c.id === 'spelling')?.status).toBe('fail')
    })

    it('withoutSystemFraming removes only what the system put there: its greeting, its sign-off, its link lines', () => {
      const letter = `Kia ora 王,\n\nFirst paragraph.\n\n${LINK_LEAD_MANY}\nBest of China: https://www.example.com/t/best\nAll our tours: https://www.example.com/tours/china\n\nSee https://evil.example.org/x too.\n\nWarm regards,\nAlex\nAcme Tours`
      const out = withoutSystemFraming(letter, { firstName: '王', config: cfg, systemUrls: ['https://www.example.com/t/best', 'https://www.example.com/tours/china'] })
      expect(out).toBe('First paragraph.\n\nSee https://evil.example.org/x too.')
      // A greeting a person rewrote is not ours any more: it stays and is checked.
      expect(withoutSystemFraming('Dear 王先生,\n\nBody.\n\nWarm regards,\nAlex\nAcme Tours', { firstName: '王', config: cfg, systemUrls: [] })).toBe('Dear 王先生,\n\nBody.')
    })

    it('the same letter without the claim passes that check', async () => {
      noCall()
      const r = await checkFollowUpLetter('c1', 'p1', { subject: 'Best of China', body: 'Kia ora Nerita,\n\nThank you for your enquiry.\n\nWarm regards,\nAlex' }, { now: () => new Date('2026-11-10T00:00:00Z') })
      if (!r.ok) throw new Error(r.message)
      expect(r.checks.find((c) => c.id === 'conversation_claim')?.status).toBe('pass')
    })

    it('a guest marked do-not-contact, or a catalogue that cannot be read, is refused: no checks means no send', async () => {
      tables.contacts = { display_name: 'X', do_not_contact: true }
      expect(await checkFollowUpLetter('c1', 'p1', { subject: 's', body: 'b' })).toMatchObject({ ok: false, reason: 'do_not_contact' })
      tables.contacts = { display_name: 'Nerita Smith', do_not_contact: false }
      loadPublishedTourFacts.mockRejectedValueOnce(new Error('down'))
      expect(await checkFollowUpLetter('c1', 'p1', { subject: 's', body: 'b' })).toMatchObject({ ok: false, reason: 'facts_unreadable' })
    })
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
