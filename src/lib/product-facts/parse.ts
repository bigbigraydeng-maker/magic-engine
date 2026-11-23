import { PRICE_CLAIM_STRICT_RE } from '@/lib/content/price-claim'

/** Facts read off one first-party product page. Anything the page did not state is null — never guessed. */
export interface ParsedProduct {
  name: string | null
  duration_days: number | null
  from_price: { amount: number; currency: string } | null
  price_basis: string | null
  departures: string[] | null
  inclusions: string[] | null
}

const ENTITIES: Record<string, string> = { '&#x27;': "'", '&#39;': "'", '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }
const decode = (s: string) => s.replace(/&#x27;|&#39;|&amp;|&quot;|&lt;|&gt;|&nbsp;/g, m => ENTITIES[m])

export function parseSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => decode(m[1]))
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const v: unknown = JSON.parse(m[1])
      for (const item of Array.isArray(v) ? v : [v]) if (item && typeof item === 'object') out.push(item as Record<string, unknown>)
    } catch { /* one broken block must not hide the others */ }
  }
  return out
}

function pageLines(html: string): string[] {
  const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '\n')
  return decode(text).split('\n').map(l => l.trim()).filter(Boolean)
}

const asRecords = (v: unknown): Record<string, unknown>[] =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')

export function parseProductPage(html: string): ParsedProduct | null {
  const blocks = jsonLdBlocks(html).filter(b => b['@type'] === 'TouristTrip' || b['@type'] === 'Product')
  const name = blocks.map(b => b.name).find((n): n is string => typeof n === 'string' && n.trim() !== '')
  if (!name) return null
  const offers = blocks.flatMap(b => asRecords(b.offers))
  const priced = offers.filter(o => Number(o.price) > 0 && /^[A-Z]{3}$/.test(String(o.priceCurrency)))
  const currency = priced.length ? String(priced[0].priceCurrency) : null
  const amount = currency ? Math.min(...priced.filter(o => o.priceCurrency === currency).map(o => Number(o.price))) : null
  const lines = pageLines(html)
  // Cross-check with what a visitor reads: if the page shows price claims and none equals the structured one, don't trust it.
  const shown = (lines.join('\n').match(PRICE_CLAIM_STRICT_RE) ?? []).map(c => Number(c.replace(/[^\d.]/g, '')))
  const priceOk = amount !== null && currency !== null && (shown.length === 0 || shown.includes(amount))
  const durationText = blocks.flatMap(b => [b.duration, ...asRecords(b.additionalProperty).filter(p => p.name === 'Duration').map(p => p.value)])
    .find((d): d is string => typeof d === 'string' && /\d+\s*days?/i.test(d))
  const departures = [...new Set(offers.map(o => o.validFrom).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
  const from = lines.indexOf('Included')
  const to = lines.indexOf('Not Included', from)
  const inclusions = from >= 0 && to > from ? lines.slice(from + 1, to).slice(0, 20).map(l => l.slice(0, 120)) : []
  return {
    name: name.trim().slice(0, 200),
    duration_days: durationText ? Number(durationText.match(/(\d+)\s*days?/i)?.[1]) : null,
    from_price: priceOk ? { amount: amount as number, currency: currency as string } : null,
    price_basis: lines.some(l => /^per person twin share$/i.test(l)) ? 'per person twin share' : null,
    departures: departures.length ? departures : null,
    inclusions: inclusions.length ? inclusions : null,
  }
}
