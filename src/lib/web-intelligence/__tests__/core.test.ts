// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/competitors/resolver', () => ({ normaliseDomain: (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0], getClientCompetitors: vi.fn() }))
vi.mock('@/lib/anthropic/client', () => ({ MODEL_SONNET: 'test-model', MODEL_HAIKU: 'test-haiku', callClaudeChat: vi.fn(), parseJsonResponse: JSON.parse }))
import { canonicalDomain, approvedUrl } from '../targets'
import { allowedClient, requestSchema, settingsSchema, metadataSchema, periodKey, type Signal, type Evidence } from '../contracts'
import { interpretationPrompt, validateInterpretation, changedWindow } from '../interpret'
import { classifyBusinessPage, projectBusinessContent } from '../content-projection'
import { deriveTravelScope, extractTourLinks, extractTourRecords, matchChangedToursScope, matchTravelScope, projectTravelContent, TRAVEL_BUSINESS_PROFILE, TRAVEL_INTERPRETATION_GUIDANCE, profileForTags, travelMarketsIn } from '../profiles/travel'
const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const c = '00000000-0000-4000-8000-000000000003'
const signal = { client_id: a, before_evidence_id: b, after_evidence_id: c } as Signal
const evidence = [b, c].map(id => ({ id, client_id: a, source_url: 'https://example.com/', excerpt: 'Observed marketing content', observed_at: '2026-09-09T00:00:00Z' })) as Evidence[]
const settings = { enabled: false, entitled: false, entitlement_price: 499, entitlement_currency: null, target_nzd: 30, hard_stop_nzd: 50, usd_to_nzd: 1.7, fx_as_of: '2026-09-09', actor_build: '1.2.3', capture_limit_usd: 0.1, overhead_nzd: 0.02, context: '' }
describe('Website scope, budget and evidence contracts', () => {
  beforeEach(() => vi.unstubAllEnvs())
  it('is disabled without explicit rollout config', () => { vi.stubEnv('WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS', ''); expect(allowedClient(a)).toBe(false) })
  it('matches exact client identity only', () => { vi.stubEnv('WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS', a); expect(allowedClient(a)).toBe(true); expect(allowedClient(b)).toBe(false) })
  it('aligns www and bare domain identities', () => expect(canonicalDomain('https://WWW.Example.com/path')).toBe('example.com'))
  it.each(['localhost', '127.0.0.1', '[::1]', 'user:pass@example.com', 'foo.local:80'])('rejects nonpublic identity %s', raw => expect(() => canonicalDomain(raw)).toThrow())
  it.each(['http://example.com/', 'https://example.com:3000/', 'https://user:pass@example.com/', 'https://evil.com/', 'https://example.com/#secret'])('rejects URL outside configured scope %s', url => expect(() => approvedUrl(url, 'example.com')).toThrow())
  it('accepts public https www alias', () => expect(approvedUrl('https://www.example.com/prices', 'example.com')).toBe('https://www.example.com/prices'))
  it('applies Auckland month boundary', () => expect(periodKey(new Date('2026-08-31T12:30:00Z'))).toBe('2026-09'))
  it.each([{ hard_stop_nzd: 51 }, { target_nzd: 31 }, { usd_to_nzd: Infinity }, { capture_limit_usd: -1 }, { actor_build: 'latest' }, { overhead_nzd: 0 }])('rejects unsafe settings %j', patch => expect(settingsSchema.safeParse({ ...settings, ...patch }).success).toBe(false))
  it('retains unknown subscription currency without inventing a price currency', () => expect(settingsSchema.parse(settings).entitlement_currency).toBeNull())
  it('keeps archive and tier separate with multi-source provenance', () => expect(metadataSchema.parse({ domain: 'example.com', tier: 'core', status: 'archive', sources: ['manual', 'google_serp'], tags: [], urls: [], interval_hours: 24 }).sources).toHaveLength(2))
  it('extracts a price change beyond the first 8000 characters', () => {
    const prefix = 'Unchanged introduction '.repeat(1000)
    const change = changedWindow(prefix + 'Price $499' + ' same ending'.repeat(100), prefix + 'Price $599' + ' same ending'.repeat(100))
    expect(change.before).toContain('$499'); expect(change.after).toContain('$599')
    expect(change.before.length).toBeLessThan(1000); expect(change.partial).toBe(false)
  })
  it('marks omitted regions of a large diff explicitly', () => {
    const change = changedWindow('A'.repeat(10000), 'B'.repeat(10000))
    expect(change.partial).toBe(true); expect(change.before).toContain('omitted')
  })
  it('keeps a middle price change when framework lines also change', () => {
    const unchanged = Array.from({ length: 900 }, (_, i) => `Tour detail ${i}`)
    const before = ['Navigation old', ...unchanged.slice(0, 450), 'From NZ$5,000', ...unchanged.slice(450), 'Pixel old'].join('\n')
    const after = ['Navigation new', ...unchanged.slice(0, 450), 'From NZ$5,500', ...unchanged.slice(450), 'Pixel new'].join('\n')
    const change = changedWindow(before, after)
    expect(change.before).toContain('NZ$5,000'); expect(change.after).toContain('NZ$5,500')
  })
  it('keeps product-price association when two prices swap', () => {
    const change = changedWindow(
      'Tour A\nNZ$5,000\nTour B\nNZ$6,000',
      'Tour A\nNZ$6,000\nTour B\nNZ$5,000',
    )
    expect(change.before).toContain('Tour A\nNZ$5,000')
    expect(change.after).toContain('Tour A\nNZ$6,000')
  })
  it('keeps a price change inside a very long changed line', () => {
    const prefix = 'Long product description '.repeat(400)
    const change = changedWindow(`Product A\n${prefix}Price NZ$5,000`, `Product A\n${prefix}Price NZ$4,500`)
    expect(change.before).toContain('NZ$5,000'); expect(change.after).toContain('NZ$4,500')
    expect(change.partial).toBe(true)
  })
  it('projects business facts while removing image and tracker noise', () => {
    const projected = projectBusinessContent(`
      # China Tours
      ![destination](https://cdn.example.com/a.jpg)
      [Wonders of China](https://example.com/tours/wonders?utm_source=ad)
      From NZ$9,030pp
      https://bat.bing.com/action/0?ti=123
      China Tours
    `)
    expect(projected).toBe('China Tours\nWonders of China\nFrom NZ$9,030pp\nChina Tours')
  })
  it('collapses only adjacent duplicates so repeated prices keep their product context', () => {
    expect(projectBusinessContent('Tour A\nNZ$5,000\nNZ$5,000\nTour B\nNZ$5,000')).toBe('Tour A\nNZ$5,000\nTour B\nNZ$5,000')
  })
  it('keeps price, availability and dates in the comparison projection', () => {
    expect(projectBusinessContent('Depart NZ 5 Oct 2026\nOnly 3 Spaces Left\nPrice NZ$15,380')).toContain('Only 3 Spaces Left')
  })
  it('preserves product and price association when values swap', () => {
    const before = projectBusinessContent('Tour A\nNZ$5,000\nTour B\nNZ$6,000')
    const after = projectBusinessContent('Tour A\nNZ$6,000\nTour B\nNZ$5,000')
    expect(before).not.toBe(after)
  })
  it('loads travel semantics only from an industry profile tag', () => {
    expect(profileForTags([])).toBeUndefined()
    expect(profileForTags(['industry:travel'])).toBe(TRAVEL_BUSINESS_PROFILE)
    expect(classifyBusinessPage('https://example.com/china/tours/', TRAVEL_BUSINESS_PROFILE)).toBe('product_listing')
    expect(classifyBusinessPage('https://example.com/china/tours/classic-china.htm', TRAVEL_BUSINESS_PROFILE)).toBe('product_detail')
    expect(classifyBusinessPage('https://example.com/new-tours/', TRAVEL_BUSINESS_PROFILE)).toBe('product_listing')
  })
  it('associates each travel offer with the named tour before sorting records', () => {
    const raw = `
      * EARLY BIRD SALE
      Display Map
      Japan Explorer
      16 days from $14,980pp
      Includes international airfares
      Osaka (3N) - Tokyo (3N)
      View Tour
      *
      Display Map
      India Explored
      15 days from $6,440pp
      2 Reviews
      Includes international airfares
      Delhi (2N) - Goa (5N)
      View Tour
    `
    expect(extractTourRecords(raw)).toEqual([
      expect.objectContaining({ name: 'India Explored', price: '$6,440pp', promotion: 'none', reviews: '2 Reviews' }),
      expect.objectContaining({ name: 'Japan Explorer', price: '$14,980pp', promotion: 'EARLY BIRD SALE' }),
    ])
  })
  it('produces the same listing projection when tour display order changes', () => {
    const a = '* EARLY BIRD SALE\nDisplay Map\nTour A\n10 days from $5,000pp\nIncludes flights\nA - B\nView Tour'
    const b = '*\nDisplay Map\nTour B\n12 days from $6,000pp\nIncludes flights\nC - D\nView Tour'
    expect(projectTravelContent(`${a}\n${b}`, 'product_listing')).toBe(projectTravelContent(`${b}\n${a}`, 'product_listing'))
  })
  it('makes a named tour field change explicit in the evidence projection', () => {
    const before = 'Display Map\nTour A\n10 days from $5,000pp\nIncludes flights\nA - B\nView Tour'
    const after = 'Display Map\nTour A\n10 days from $5,500pp\nIncludes flights\nA - B\nView Tour'
    expect(projectTravelContent(before, 'product_listing')).toContain('Tour: Tour A | Duration: 10 days | Price: $5,000pp')
    expect(projectTravelContent(after, 'product_listing')).toContain('Tour: Tour A | Duration: 10 days | Price: $5,500pp')
  })
  it('projects itinerary headings from a Tour detail page', () => {
    const detail = `Classic China\n22 days from $10,580pp\nDay 1: Arrive in Beijing\nDay 2: Great Wall and city tour\nDay 3: Beijing to Xian\nIncludes international airfares`
    expect(projectTravelContent(detail, 'product_detail')).toContain('Itinerary: Day 1: Arrive in Beijing || Day 2: Great Wall and city tour || Day 3: Beijing to Xian')
  })
  it('discovers only same-origin Tour detail links', () => {
    const raw = '[Classic China](https://wendywutours.co.nz/tours/classic-china)\n[Japan](https://wendywutours.co.nz/tours/japan)\n[Blog](https://other.example/tours/blog)\n[Contact](/contact)'
    expect(extractTourLinks(raw, 'https://wendywutours.co.nz/china/tours/')).toEqual([
      { name: 'Classic China', url: 'https://wendywutours.co.nz/tours/classic-china' },
      { name: 'Japan', url: 'https://wendywutours.co.nz/tours/japan' },
    ])
  })
  it('places Tour comparison rules in the industry guidance, not the shared prompt', () => {
    const prompt = interpretationPrompt(signal, evidence, '', TRAVEL_INTERPRETATION_GUIDANCE)
    expect(prompt).toContain('exact Tour name plus before and after values')
    expect(prompt).toContain('departure dates')
  })
  it('derives a travel market from configured products before marketing keywords', () => {
    expect(deriveTravelScope([{ name: 'Wonders of China' }], ['japan tours'])).toMatchObject({ status: 'configured', market_ids: ['china'], source: '主力产品' })
    expect(deriveTravelScope([], ['cts china travel service'])).toMatchObject({ status: 'inferred', market_ids: ['china'], source: '主关键词' })
    expect(deriveTravelScope([{ name: 'Signature Journey', usp: 'China specialist' }], ['japan tours'])).toMatchObject({ status: 'configured', market_ids: ['china'] })
    expect(deriveTravelScope([{ name: 'China' }, { name: 'Japan' }, { name: 'Vietnam' }, { name: 'India' }], [])).toMatchObject({ market_ids: ['china', 'vietnam', 'japan', 'india'] })
    expect(deriveTravelScope([], ['china travel service', 'cts auckland'])).toMatchObject({ market_ids: ['china'], basis: ['china travel service'] })
    expect(deriveTravelScope([], ['china tours', 'travel agency auckland'])).toMatchObject({ market_ids: ['china'], basis: ['china tours'] })
    expect(deriveTravelScope([], ['china tours', 'auckland travel agency'])).toMatchObject({ market_ids: ['china'], basis: ['china tours'] })
    expect(deriveTravelScope([], ['china travel service auckland'])).toMatchObject({ market_ids: ['china'] })
    expect(deriveTravelScope([], ['china tours', 'japan holidays'])).toMatchObject({ market_ids: ['china', 'japan'] })
  })
  it('matches a China tour, excludes foreign tours and holds mixed destinations for confirmation', () => {
    const scope = deriveTravelScope([], ['china tours from nz'])
    expect(scope.market_ids).toEqual(['china'])
    expect(matchTravelScope('Tour: Wonders of China | Route: Shanghai - Xian', 'https://example.com/new-tours/', scope).status).toBe('matched')
    expect(matchTravelScope('Tour: Angkor to Bali | Route: Siem Reap - Bali', 'https://example.com/china/tours/', scope).status).toBe('outside')
    expect(matchTravelScope('Tour: China & Mongolia Heartlands | Route: Beijing - Gobi', 'https://example.com/china/tours/', scope).status).toBe('unknown')
    expect(matchTravelScope('Tour: France Highlights', 'https://example.com/china/tours/', scope).status).toBe('unknown')
    expect(deriveTravelScope([], ['China tours from Auckland']).market_ids).toEqual(['china'])
    expect(deriveTravelScope([], ['China tours from Singapore']).market_ids).toEqual(['china'])
  })
  it('uses every changed Tour record for the product-scope gate', () => {
    const scope = deriveTravelScope([], ['china tours'])
    const before = ['Tour: Wonders of China | Price: $1', 'Tour: China Explorer | Price: $2', 'Tour: Beijing Break | Price: $3', 'Tour: Japan Explorer | Price: $4'].join('\n')
    const after = ['Tour: Wonders of China | Price: $11', 'Tour: China Explorer | Price: $22', 'Tour: Beijing Break | Price: $33', 'Tour: Japan Explorer | Price: $44'].join('\n')
    expect(matchChangedToursScope(before, after, 'https://example.com/china/tours/', scope).status).toBe('unknown')
  })
  it('matches a changed China Tour in full captured page evidence', () => {
    const scope = deriveTravelScope([], ['china tours'])
    const before = ['Classic Group Tour', 'Classic China', '22 days from $10,080pp', '44 Reviews', 'Includes international airfares', 'Beijing - Xian - Shanghai'].join('\n')
    const after = ['Classic Group Tour', 'Classic China', '22 days from $10,580pp', '44 Reviews', 'Includes international airfares', 'Beijing - Xian - Shanghai'].join('\n')
    expect(matchChangedToursScope(before, after, 'https://example.com/china/tours/', scope)).toMatchObject({ status: 'matched', matched: ['china'], outside: [] })
  })
  it('normalises each side when stored Tour evidence formats differ', () => {
    const scope = deriveTravelScope([], ['china tours'])
    const before = ['Classic Group Tour', 'Japan Explorer', '10 days from $5,000pp', 'Tokyo - Kyoto'].join('\n')
    const after = 'Tour: Classic China | Duration: 22 days | Price: $10,580pp | Route: Beijing - Xian - Shanghai'
    expect(matchChangedToursScope(before, after, 'https://example.com/china/tours/', scope).status).toBe('unknown')
  })
  it('uses market aliases with word boundaries and leaves ambiguous text unknown', () => {
    expect(travelMarketsIn('Tour: Japan Explorer | Route: Tokyo - Kyoto')).toEqual(['japan'])
    expect(travelMarketsIn('Tour: Japanese Explorer')).toEqual(['japan'])
    expect(travelMarketsIn('Tour: Chinatown Food Walk')).toEqual([])
    expect(matchTravelScope('Tour: Classic Discovery', 'https://example.com/new-tours/', deriveTravelScope([], ['china tours'])).status).toBe('unknown')
  })
  it('round-trips settings read from database without metadata columns', () => {
    const read = settingsSchema.strip().parse({ ...settings, client_id: a, updated_at: '2026-09-09' })
    expect(settingsSchema.parse(read)).toEqual(settings)
  })
  it('requires evidence to belong to the same client', () => expect(() => interpretationPrompt(signal, evidence.map(e => ({ ...e, client_id: b })), '')).toThrow('identity'))
  it('rejects invented citations', () => expect(() => validateInterpretation(JSON.stringify({ classification: 'threat', summary: 'Changed', confidence: 0.4, evidence_ids: [a, b], recommended_action: 'Review evidence' }), signal)).toThrow('invented'))
  it.each(['threat', 'opportunity', 'ignore'])('validates grounded %s recommendation', classification => expect(validateInterpretation(JSON.stringify({ classification, summary: 'Observed a change', confidence: 0.5, evidence_ids: [b, c], recommended_action: 'Review the offer' }), signal).classification).toBe(classification))
})

describe('existing database client identifiers', () => {
  const request = { client_id: 'c0000000-0000-0000-0000-000000000000', request_id: a, domain: 'example.com', url: 'https://example.com/' }
  it('accepts an existing PostgreSQL UUID without RFC version/variant bits', () => {
    expect(requestSchema.parse(request).client_id).toBe(request.client_id)
  })
  it('still rejects malformed identifiers and non-generated request identities', () => {
    expect(requestSchema.safeParse({ ...request, client_id: 'not-a-client-id' }).success).toBe(false)
    expect(requestSchema.safeParse({ ...request, request_id: request.client_id }).success).toBe(false)
  })
})
