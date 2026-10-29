import { describe, expect, it } from 'vitest'
import { CTS_SEED_TEMPLATES } from './cts'
import { checkSeeds, parseSeedArgs } from './plan'
import { renderTemplate } from '@/lib/crm/email-templates/render'
import { getProvider } from '@/lib/crm/email-templates/facts/registry'
import { evaluateContentGates } from '@/lib/crm/email-templates/gates/content-gates'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import type { PublishedTourFact } from '@/lib/crm/email-templates/facts/types'
import { SEED_GUARDRAILS } from './plan'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

const tour = (over: Partial<PublishedTourFact> = {}): PublishedTourFact => ({
  id: 't1',
  slug: 'essentials',
  destination: 'china',
  tier: 'discovery',
  name: 'China Discovery — Best of China',
  title: null,
  durationText: '15 Days',
  displayPriceText: 'From NZD $4,080 per person',
  highlights: ['Great Wall', 'Terracotta Warriors'],
  inclusions: ['4-star hotels'],
  exclusions: [],
  singleSupplement: null,
  soldOut: false,
  managesDepartures: true,
  isActive: true,
  departures: [{ departOn: '2027-03-11', displayDate: '11 March 2027', status: 'open', priceTextOverride: null }],
  ...over,
})

const asVersion = (seed: (typeof CTS_SEED_TEMPLATES)[number]): EmailTemplateVersion => ({
  id: 'x',
  clientId: CLIENT,
  templateKey: seed.templateKey,
  version: 1,
  createdBy: 'hello@magicengine.cloud',
  createdAt: '2026-10-28T00:00:00Z',
  ...seed.fields,
})

describe('the CTS seed templates', () => {
  it('are exactly the two agreed ones, and both start switched off', () => {
    expect(CTS_SEED_TEMPLATES.map((t) => t.templateKey)).toEqual(['post-call-single-tour', 'spring-2027-follow-up'])
    expect(CTS_SEED_TEMPLATES.every((t) => t.fields.status === 'disabled')).toBe(true)
  })

  it('pass the same checks the API runs when a template is saved, with the CTS red lines', () => {
    const checks = checkSeeds('cts')
    expect(checks.map((c) => [c.templateKey, c.errors])).toEqual([
      ['post-call-single-tour', []],
      ['spring-2027-follow-up', []],
    ])
    expect(checks.every((c) => c.ok)).toBe(true)
  })

  it('the spring letter is for March and May departures, several tours at a time', () => {
    const spring = CTS_SEED_TEMPLATES[1].fields
    expect(spring.pickMode).toBe('many')
    expect(spring.pickFilter).toEqual({ departureMonths: [3, 5] })
  })

  it('write no year into the name, subject or body: the month filter matches every year, so a year in the text goes stale', () => {
    for (const t of CTS_SEED_TEMPLATES) {
      const text = `${t.fields.name}\n${t.fields.subject}\n${t.fields.body}`
      expect(text).not.toMatch(/\b(19|20)\d{2}\b/)
    }
  })

  it('contain no hard-coded fact: tour names, prices, dates and links all come from placeholders', () => {
    for (const t of CTS_SEED_TEMPLATES) {
      const text = `${t.fields.subject}\n${t.fields.body}`
      expect(text).not.toMatch(/\$\s?\d/) // no price
      expect(text).not.toMatch(/https?:\/\//i) // no literal link
      expect(text).not.toMatch(/\b(?:guaranteed departure|twin share|per person)\b/i) // not in the catalog, so not written
      expect(text).not.toMatch(/\b20(?:26|27|28)-\d\d-\d\d\b/) // no literal date
    }
  })

  it('never invite a call, set a deadline or promise visa-free travel', () => {
    for (const t of CTS_SEED_TEMPLATES) {
      const gates = evaluateContentGates({
        subject: t.fields.subject.replace(/\{\{[^}]+\}\}/g, 'x'),
        body: t.fields.body.replace(/\{\{[^}]+\}\}/g, 'x'),
        footer: null,
        settings: SEED_GUARDRAILS.cts,
        provider: null,
        facts: null,
      })
      expect([...gates.blocks, ...gates.warnings]).toEqual([])
    }
  })

  it('render into a letter with no gaps from the published catalog', () => {
    const provider = getProvider('published_tours')
    if (provider === null) throw new Error('provider missing')
    const single = asVersion(CTS_SEED_TEMPLATES[0])
    const picked = provider.resolvePicks([tour()], [{ tourId: 't1', departOn: '2027-03-11' }], single.pickFilter, single.pickMode)
    if (!picked.ok) throw new Error(picked.reason)
    const out = renderTemplate(single, {
      contactName: 'Amy Lee',
      senderDisplayName: 'Lisa Zhang',
      callWhen: 'today',
      inputs: {},
      facts: { tours: [tour()], picks: picked.picks, settings: { urlPattern: 'https://www.ctstours.co.nz/tours/{destination}/{tier}/{slug}', allToursUrl: 'https://www.ctstours.co.nz/tours' } },
      provider,
    })
    expect(out.missing).toEqual([])
    expect(out.problems).toEqual([])
    expect(out.subject).toBe('China Discovery — Best of China: your itinerary and price')
    expect(out.body).toContain('Kia ora Amy,')
    expect(out.body).toContain('Thank you for talking with me today.')
    expect(out.body).toContain('departing 11 March 2027')
    expect(out.body).toContain('From NZD $4,080 per person')
    expect(out.body).toContain('https://www.ctstours.co.nz/tours/china/discovery/essentials?date=2027-03-11')
    expect(out.body).toContain('Warm regards,\nLisa\nCTS Tours')
  })

  it('the spring letter renders a card per picked tour and the all-tours link', () => {
    const provider = getProvider('published_tours')
    if (provider === null) throw new Error('provider missing')
    const spring = asVersion(CTS_SEED_TEMPLATES[1])
    const tours = [tour(), tour({ id: 't2', slug: 'cherry', destination: 'japan', name: 'Japan Cherry Blossoms', departures: [{ departOn: '2027-03-27', displayDate: '27 March 2027', status: 'open', priceTextOverride: null }] })]
    const picked = provider.resolvePicks(tours, [{ tourId: 't1', departOn: '2027-03-11' }, { tourId: 't2', departOn: '2027-03-27' }], spring.pickFilter, spring.pickMode)
    if (!picked.ok) throw new Error(picked.reason)
    const out = renderTemplate(spring, {
      contactName: 'Amy Lee',
      senderDisplayName: 'Lisa Zhang',
      callWhen: 'yesterday',
      inputs: {},
      facts: { tours, picks: picked.picks, settings: { urlPattern: 'https://www.ctstours.co.nz/tours/{destination}/{tier}/{slug}', allToursUrl: 'https://www.ctstours.co.nz/tours' } },
      provider,
    })
    expect(out.missing).toEqual([])
    expect(out.body).toContain('China Discovery — Best of China')
    expect(out.body).toContain('Japan Cherry Blossoms')
    expect(out.body).toContain('You can see all of our tours here: https://www.ctstours.co.nz/tours')
    expect(out.body).toContain('Thank you for talking with me yesterday.')
  })
})

describe('the seed script arguments', () => {
  it('a dry run needs only the seed name', () => {
    expect(parseSeedArgs(['--seed', 'cts'])).toEqual({ ok: true, seed: 'cts', apply: false, clientId: null })
  })

  it('writing needs a named client AND the PM-approved flag, and never defaults to a client', () => {
    expect(parseSeedArgs(['--seed', 'cts', '--apply'])).toMatchObject({ ok: false })
    expect(parseSeedArgs(['--seed', 'cts', '--apply', '--client', CLIENT])).toMatchObject({ ok: false, error: expect.stringContaining('PM') })
    expect(parseSeedArgs(['--seed', 'cts', '--apply', '--pm-approved'])).toMatchObject({ ok: false, error: expect.stringContaining('--client') })
    expect(parseSeedArgs(['--seed', 'cts', '--apply', '--client', CLIENT, '--pm-approved'])).toEqual({ ok: true, seed: 'cts', apply: true, clientId: CLIENT })
  })

  it.each([
    ['no seed', []],
    ['an unknown seed', ['--seed', 'nope']],
    ['an unknown flag', ['--seed', 'cts', '--force']],
    ['a client that is not a UUID', ['--seed', 'cts', '--client', 'cts']],
  ])('rejects %s', (_name, argv) => {
    expect(parseSeedArgs(argv).ok).toBe(false)
  })

  it('--pm-approved alone writes nothing (it only matters together with --apply)', () => {
    expect(parseSeedArgs(['--seed', 'cts', '--pm-approved'])).toEqual({ ok: true, seed: 'cts', apply: false, clientId: null })
  })
})
