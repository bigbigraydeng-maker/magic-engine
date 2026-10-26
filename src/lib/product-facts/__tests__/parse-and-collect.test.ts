import { describe, expect, it } from 'vitest'
import { allowedHostsFor, guardedGet, robotsAllows } from '../fetch'
import { collectProductFacts, loadFactSource } from '../collect'
import { parseProductPage, parseSitemapUrls } from '../parse'

const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`
const page = (price: number, shown = 'From NZD $10,899') => `<html>${ld({
  '@type': 'TouristTrip', name: 'Grand Tour', duration: '27 Days',
  offers: [{ price, priceCurrency: 'NZD', validFrom: '2027-10-16' }, { price, priceCurrency: 'NZD', validFrom: '2027-05-08' }, { price, priceCurrency: 'NZD' }],
})}<body><p>${shown}</p><p>Per person twin share</p><h2>What&#x27;s Included</h2><div>Included</div><ul><li>Return flights</li><li>Guide</li></ul><div>Not Included</div><li>Insurance</li></body></html>`
const html = (body: string, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } })
const SOURCE = { origin: 'https://www.example.test', product_path_prefixes: ['/tours/'] }

describe('parseProductPage', () => {
  it('reads name, days, lowest price, dated departures and inclusions from the page', () => {
    expect(parseProductPage(page(10899))).toEqual({
      name: 'Grand Tour', duration_days: 27, from_price: { amount: 10899, currency: 'NZD' }, price_basis: 'per person twin share',
      departures: ['2027-05-08', '2027-10-16'], inclusions: ['Return flights', 'Guide'],
    })
  })
  it('keeps price null when the visible price disagrees with the structured one', () => {
    expect(parseProductPage(page(9999))?.from_price).toBeNull()
  })
  it('keeps price null for a "TBC" page (structured price 0)', () => {
    expect(parseProductPage(page(0, 'From NZD $TBC per person'))?.from_price).toBeNull()
  })
  it('returns null when the page carries no product data', () => {
    expect(parseProductPage('<html><body>hello</body></html>')).toBeNull()
  })
  it('lists sitemap urls', () => {
    expect(parseSitemapUrls('<urlset><url><loc>https://a.test/x</loc></url><url><loc> https://a.test/y&amp;z </loc></url></urlset>')).toEqual(['https://a.test/x', 'https://a.test/y&z'])
  })
})

describe('guardedGet / robots', () => {
  const hosts = allowedHostsFor('https://www.example.test')
  it('allows the host and its www/apex twin only', () => {
    expect([...hosts].sort()).toEqual(['example.test', 'www.example.test'])
  })
  it('refuses a redirect that leaves the allowed hosts', async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } })) as typeof fetch
    await expect(guardedGet('https://www.example.test/a', { allowedHosts: hosts, fetchImpl })).rejects.toThrow('host_not_allowed')
  })
  it('refuses oversize bodies and non-text content', async () => {
    await expect(guardedGet('https://www.example.test/a', { allowedHosts: hosts, maxBytes: 5, fetchImpl: (async () => html('0123456789')) as typeof fetch })).rejects.toThrow('too_large')
    await expect(guardedGet('https://www.example.test/a', { allowedHosts: hosts, fetchImpl: (async () => html('x', 'image/png')) as typeof fetch })).rejects.toThrow('bad_content_type')
  })
  it('reads only the * group Disallow prefixes', () => {
    const txt = 'User-agent: bot\nDisallow: /tours/\nUser-agent: *\nDisallow: /api/\n'
    expect(robotsAllows(txt, '/tours/a')).toBe(true)
    expect(robotsAllows(txt, '/api/x')).toBe(false)
  })
})

describe('collectProductFacts', () => {
  const sitemap = '<urlset>' + ['/tours/ok', '/tours/tbc', '/tours/down', '/tours/', '/blog/post', '/tours/secret/x'].map(p => `<url><loc>https://www.example.test${p}</loc></url>`).join('') + '</urlset>'
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/robots.txt')) return html('User-agent: *\nDisallow: /tours/secret/')
    if (url.endsWith('/sitemap.xml')) return html(sitemap, 'application/xml')
    if (url.endsWith('/tours/ok')) return html(page(10899))
    if (url.endsWith('/tours/tbc')) return html(page(0, 'From NZD $TBC'))
    return new Response('nope', { status: 500 })
  }) as typeof fetch
  const now = new Date('2026-10-05T00:00:00Z')

  it('labels each product page ok / not_measured / fetch_failed and skips non-product and robots-blocked urls', async () => {
    const facts = await collectProductFacts(SOURCE, { fetchImpl, gapMs: 0, now })
    expect(facts.map(f => [f.source_url.split('/tours/')[1], f.status])).toEqual([['ok', 'ok'], ['tbc', 'not_measured'], ['down', 'fetch_failed']])
    expect(facts[0].verified_at).toBe(now.toISOString())
    expect(facts[1].verified_at).toBeNull()
    expect(facts[2]).toMatchObject({ name: null, from_price: null, departures: null, error: 'http_500' })
  })
  it('turns an unreadable sitemap into a single fetch_failed record instead of an empty list', async () => {
    const down = (async () => new Response('x', { status: 503 })) as typeof fetch
    const facts = await collectProductFacts(SOURCE, { fetchImpl: down, gapMs: 0, now })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ status: 'fetch_failed', source_url: 'https://www.example.test/sitemap.xml' })
  })
})

describe('loadFactSource', () => {
  const cfg = (v: unknown) => JSON.stringify({ 'client-1': v })
  it('reads the per-client rule and rejects anything malformed', () => {
    expect(loadFactSource('client-1', cfg(SOURCE))).toEqual(SOURCE)
    expect(loadFactSource('client-2', cfg(SOURCE))).toBeNull()
    expect(loadFactSource('client-1', cfg({ ...SOURCE, origin: 'http://insecure.test' }))).toBeNull()
    expect(loadFactSource('client-1', cfg({ ...SOURCE, product_path_prefixes: ['tours'] }))).toBeNull()
    expect(loadFactSource('client-1', 'not json')).toBeNull()
    expect(loadFactSource('client-1', undefined)).toBeNull()
  })
})
