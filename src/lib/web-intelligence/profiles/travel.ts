import type { BusinessContentProfile, BusinessPageRole } from '../content-projection'

const PRICE = /^(\d+)\s+days?\s+from\s+(.+?)(?:\s*)$/i
const IGNORE_TITLE = /^(?:\*|display map|view tour|early bird sale)$/i

export type TourRecord = {
  name: string
  durationDays: number
  price: string
  promotion: string
  reviews: string
  includes: string
  route: string
  departureWindow?: string
  positioning?: string
  audience?: string
  itinerary?: string[]
}

export type DiscoveredTourLink = { name: string; url: string }

export type TravelScope = {
  status: 'configured' | 'inferred' | 'unknown'
  market_ids: string[]
  labels: string[]
  basis: string[]
  source: '主力产品' | '主关键词' | '尚无可靠范围'
  rule_version: 'travel-market-v1'
}

export type TravelScopeMatch = {
  status: 'matched' | 'outside' | 'unknown'
  matched: string[]
  outside: string[]
}

const TRAVEL_MARKETS = [
  { id: 'china', label: '中国', aliases: ['china', 'chinese', 'beijing', 'shanghai', 'xian', "xi'an", 'chengdu', 'guilin', 'yangtze', 'zhangjiajie', 'lhasa', 'tibet', 'silk road', 'dunhuang', 'kashgar', 'suzhou', 'hangzhou'] },
  { id: 'mongolia', label: '蒙古', aliases: ['mongolia', 'mongolian', 'naadam', 'gobi', 'ulaanbaatar'] },
  { id: 'cambodia', label: '柬埔寨', aliases: ['cambodia', 'angkor', 'siem reap', 'phnom penh'] },
  { id: 'indonesia', label: '印度尼西亚 / 巴厘岛', aliases: ['indonesia', 'bali'] },
  { id: 'malaysia', label: '马来西亚', aliases: ['malaysia', 'malaysian', 'borneo'] },
  { id: 'singapore', label: '新加坡', aliases: ['singapore'] },
  { id: 'nepal', label: '尼泊尔', aliases: ['nepal', 'nepalese', 'kathmandu'] },
  { id: 'bhutan', label: '不丹', aliases: ['bhutan'] },
  { id: 'vietnam', label: '越南', aliases: ['vietnam', 'hanoi', 'ho chi minh', 'saigon', 'halong'] },
  { id: 'laos', label: '老挝', aliases: ['laos', 'luang prabang'] },
  { id: 'thailand', label: '泰国', aliases: ['thailand', 'bangkok', 'chiang mai'] },
  { id: 'myanmar', label: '缅甸', aliases: ['myanmar', 'burma', 'bagan', 'yangon'] },
  { id: 'japan', label: '日本', aliases: ['japan', 'japanese', 'tokyo', 'kyoto', 'osaka'] },
  { id: 'south-korea', label: '韩国', aliases: ['south korea', 'korea', 'seoul', 'busan'] },
  { id: 'india', label: '印度', aliases: ['india', 'indian', 'delhi', 'rajasthan', 'agra'] },
  { id: 'sri-lanka', label: '斯里兰卡', aliases: ['sri lanka', 'ceylon', 'colombo'] },
  { id: 'taiwan', label: '台湾', aliases: ['taiwan', 'taipei'] },
  { id: 'hong-kong', label: '香港', aliases: ['hong kong'] },
  { id: 'central-asia', label: '中亚', aliases: ['uzbekistan', 'kazakhstan', 'kyrgyzstan', 'turkmenistan', 'tajikistan', 'samarkand'] },
  { id: 'australia', label: '澳大利亚', aliases: ['australia', 'australian', 'sydney', 'melbourne'] },
  { id: 'new-zealand', label: '新西兰', aliases: ['new zealand', 'auckland', 'queenstown'] },
] as const

const marketById = new Map<string, (typeof TRAVEL_MARKETS)[number]>(TRAVEL_MARKETS.map(market => [market.id, market]))
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsAlias = (text: string, alias: string) => new RegExp(`(?:^|[^a-z])${escaped(alias)}(?:$|[^a-z])`, 'i').test(text)
const PRODUCT_INTENT = /\b(?:tours?|travel|holidays?|vacations?|trips?|journeys?|cruises?|adventures?|packages?|itinerar(?:y|ies)|destinations?|services?)\b/i
const BUSINESS_LOCATION_QUERY = /\b(?:travel\s+agenc(?:y|ies)|agenc(?:y|ies)|offices?|branches?|stores?|locations?)\b/i

export function travelMarketsIn(text: string): string[] {
  // A customer's origin/sales market is not necessarily a Tour destination.
  // Remove every known market alias when it follows an origin phrase.
  const destinationText = TRAVEL_MARKETS.flatMap(market => [...market.aliases])
    .sort((a, b) => b.length - a.length)
    .reduce((value, alias) => value.replace(new RegExp(`\\b(?:depart(?:ing|ures?)?\\s+)?from\\s+${escaped(alias)}\\b`, 'gi'), ' '), text)
  return TRAVEL_MARKETS.filter(market => market.aliases.some(alias => containsAlias(destinationText, alias))).map(market => market.id)
}

/** Return conservative search terms for the markets already in a client's scope. */
export function travelMarketTerms(marketIds: string[]): string[] {
  const allowed = new Set(marketIds)
  return [...new Set(TRAVEL_MARKETS.filter(market => allowed.has(market.id)).flatMap(market => market.aliases))]
}

function scopeKeywordText(text: string): string {
  return TRAVEL_MARKETS.flatMap(market => [...market.aliases])
    .sort((a, b) => b.length - a.length)
    .reduce((value, alias) => value.replace(new RegExp(`\\b(?:travel\\s+agenc(?:y|ies)|agenc(?:y|ies)|offices?|branches?|stores?|locations?|services?)\\s+(?:in\\s+)?${escaped(alias)}\\b`, 'gi'), ' '), text)
}

export function deriveTravelScope(products: { name: string; usp?: string }[], keywords: string[]): TravelScope {
  const productBasis = products.filter(product => travelMarketsIn(`${product.name} ${product.usp ?? ''}`).length > 0).map(product => product.name).slice(0, 3)
  // Location/brand queries such as "cts auckland" identify a branch or sales
  // market, not a Tour destination. Only product-intent keywords infer scope.
  const scopedKeywords = keywords.filter(keyword => !BUSINESS_LOCATION_QUERY.test(keyword) && PRODUCT_INTENT.test(keyword) && travelMarketsIn(scopeKeywordText(keyword)).length > 0)
  const keywordBasis = scopedKeywords.slice(0, 3)
  const productMarkets = travelMarketsIn(products.map(product => `${product.name} ${product.usp ?? ''}`).join('\n'))
  const keywordMarkets = travelMarketsIn(scopedKeywords.map(scopeKeywordText).join('\n'))
  const marketIds = productMarkets.length ? productMarkets : keywordMarkets
  return {
    status: productMarkets.length ? 'configured' : keywordMarkets.length ? 'inferred' : 'unknown',
    market_ids: marketIds,
    labels: marketIds.map(id => marketById.get(id)?.label ?? id),
    basis: productMarkets.length ? productBasis : keywordBasis,
    source: productMarkets.length ? '主力产品' : keywordMarkets.length ? '主关键词' : '尚无可靠范围',
    rule_version: 'travel-market-v1',
  }
}

/** Strictly excludes only a clearly identified market outside the client's scope. */
export function matchTravelScope(text: string, sourceUrl: string, scope: TravelScope): TravelScopeMatch {
  if (scope.status === 'unknown' || scope.market_ids.length === 0) return { status: 'unknown', matched: [], outside: [] }
  const explicit = travelMarketsIn(text)
  const allowed = new Set<string>(scope.market_ids)
  const matched = explicit.filter(id => allowed.has(id))
  const outside = explicit.filter(id => !allowed.has(id))
  // A multi-destination product spanning both the client's scope and another
  // market needs human confirmation; it is not a like-for-like comparison.
  if (matched.length && outside.length) return { status: 'unknown', matched, outside }
  if (outside.length) return { status: 'outside', matched: [], outside }
  if (matched.length) return { status: 'matched', matched, outside: [] }
  // A named Tour with an unrecognised destination must not inherit the market
  // from its surrounding listing-page URL.
  if (/(?:^|[|;])\s*tour\s*:/i.test(text)) return { status: 'unknown', matched: [], outside: [] }
  const fromUrl = travelMarketsIn(sourceUrl).filter(id => allowed.has(id))
  return fromUrl.length ? { status: 'matched', matched: fromUrl, outside: [] } : { status: 'unknown', matched: [], outside: [] }
}

const canonicalTourLine = (line: string) => line.trim().toLowerCase().replace(/\s+/g, ' ')

function tourRecordLine(record: TourRecord): string {
  return [
    `Tour: ${record.name}`,
    `Duration: ${record.durationDays} days`,
    `Price: ${record.price}`,
    `Promotion: ${record.promotion}`,
    `Reviews: ${record.reviews}`,
    `Includes: ${record.includes}`,
    `Route: ${record.route}`,
    ...(record.departureWindow ? [`Departure: ${record.departureWindow}`] : []),
    ...(record.itinerary?.length ? [`Itinerary: ${record.itinerary.join(' || ')}`] : []),
  ].join(' | ')
}

function changedTourLines(before: string, after: string): string[] {
  // Older evidence records contain the captured page body rather than the
  // canonical projection. Recreate the same Tour records before evaluating
  // scope so a clearly named product does not become "unknown" merely because
  // of its storage format.
  const comparableLines = (value: string) => {
    const projected = value.split('\n').filter(line => /(?:^|[|;])\s*tour\s*:/i.test(line))
    return projected.length ? projected : extractTourRecords(value).map(tourRecordLine)
  }
  const beforeRecords = comparableLines(before)
  const afterRecords = comparableLines(after)
  if (!beforeRecords.length || !afterRecords.length) return []
  const beforeSet = new Set(beforeRecords.map(canonicalTourLine))
  const afterSet = new Set(afterRecords.map(canonicalTourLine))
  return [
    ...beforeRecords.filter(line => !afterSet.has(canonicalTourLine(line))),
    ...afterRecords.filter(line => !beforeSet.has(canonicalTourLine(line))),
  ]
}

/** Evaluate every changed canonical Tour record; display truncation must not change the gate. */
export function matchChangedToursScope(before: string, after: string, sourceUrl: string, scope: TravelScope): TravelScopeMatch {
  if (scope.status === 'unknown') return { status: 'unknown', matched: [], outside: [] }
  const changed = changedTourLines(before, after)
  if (!changed.length) return { status: 'unknown', matched: [], outside: [] }
  const matches = changed.map(line => matchTravelScope(line, sourceUrl, scope))
  const statuses = new Set(matches.map(match => match.status))
  return {
    status: statuses.size === 1 ? matches[0].status : 'unknown',
    matched: [...new Set(matches.flatMap(match => match.matched))],
    outside: [...new Set(matches.flatMap(match => match.outside))],
  }
}

export function travelMarketLabels(ids: string[]): string[] {
  return ids.map(id => marketById.get(id)?.label ?? id)
}

const clean = (value: string) => value.trim().replace(/^[*#-]+\s*/, '').replace(/\s+/g, ' ')

function itineraryHeadings(lines: string[]): string[] {
  return lines.map(clean).filter(line => /^(?:day\s*\d+|d\d+)\b\s*[:–-]?/i.test(line)).slice(0, 60)
}

function precedingTitle(lines: string[], priceIndex: number): string | null {
  for (let index = priceIndex - 1; index >= Math.max(0, priceIndex - 4); index--) {
    const candidate = clean(lines[index] ?? '')
    if (candidate && !IGNORE_TITLE.test(candidate)) return candidate
  }
  return null
}

function followingValue(lines: string[], priceIndex: number, pattern: RegExp): string {
  return lines.slice(priceIndex + 1, priceIndex + 5).map(clean).find(line => pattern.test(line)) ?? 'not stated'
}

function routeValue(lines: string[], priceIndex: number): string {
  return lines.slice(priceIndex + 1, priceIndex + 6).map(clean).find(line =>
    line && !/^(?:\d+ reviews?|includes |view tour)/i.test(line),
  ) ?? 'not stated'
}

export function extractTourRecords(raw: string): TourRecord[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  const records = lines.flatMap((line, index): TourRecord[] => {
    const match = clean(line).match(PRICE)
    const name = match ? precedingTitle(lines, index) : null
    if (!match || !name) return []
    const nearby = lines.slice(Math.max(0, index - 4), index).map(clean)
    return [{
      name,
      durationDays: Number(match[1]),
      price: clean(match[2]),
      promotion: nearby.some(value => /^early bird sale$/i.test(value)) ? 'EARLY BIRD SALE' : 'none',
      reviews: followingValue(lines, index, /^\d+ reviews?$/i),
      includes: followingValue(lines, index, /^includes /i),
      route: routeValue(lines, index),
      itinerary: itineraryHeadings(lines),
    }]
  })
  return records.sort((a, b) => a.name.localeCompare(b.name, 'en-NZ'))
}

/** Discover only same-origin Tour detail links from a captured listing page. */
export function extractTourLinks(raw: string, sourceUrl: string): DiscoveredTourLink[] {
  let base: URL
  try { base = new URL(sourceUrl) } catch { return [] }
  const links: DiscoveredTourLink[] = []
  const markdown = /\[([^\]]{2,180})\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/gi
  for (const match of raw.matchAll(markdown)) {
    const name = clean(match[1])
    if (/^(?:view|read|learn|see)\s+(?:tour|more|details?)$/i.test(name)) continue
    let url: URL
    try { url = new URL(match[2], base) } catch { continue }
    if (url.protocol !== 'https:' || url.hostname !== base.hostname) continue
    if (!/(?:^|\/)tours?\/[^/]+(?:\/|$)|(?:^|\/)escorted-tours\/[^/]+|(?:^|\/)private-tours\/[^/]+/i.test(url.pathname)) continue
    url.hash = ''
    const canonical = url.href
    if (!links.some(item => item.url === canonical)) links.push({ name, url: canonical })
  }
  return links.slice(0, 100)
}

export function projectTravelContent(raw: string, role: BusinessPageRole): string | null {
  if (role !== 'product_listing' && role !== 'product_detail' && role !== 'offers') return null
  const records = extractTourRecords(raw)
  if (records.length === 0) return null
  return records.map(tourRecordLine).join('\n')
}

export const TRAVEL_INTERPRETATION_GUIDANCE = `The evidence contains canonical Tour records. Compare Tour competitiveness by named Tour and exact fields only: product presence, price, promotion, duration, route or destinations, departure dates, availability, inclusions, positioning and reviews. State the exact Tour name plus before and after values. Never infer that a promotion moved or disappeared from an unassociated repeated label. If no named Tour has a verifiable field change, classify ignore and state that no reliable Tour change was found.`

/** ME Travel page semantics. Customer domains and selected URLs stay in L4 configuration. */
export const TRAVEL_BUSINESS_PROFILE: BusinessContentProfile = {
  id: 'me-travel-v2',
  classifyPath(pathname) {
    if (/(?:^|\/)new-tours(?:\/|$)/.test(pathname)) return 'product_listing'
    if (/(?:^|\/)(?:special-offers?|offers?)(?:\/|$)/.test(pathname)) return 'offers'
    if (/(?:^|\/)tours\/[^/]+(?:\.html?)?$/.test(pathname)) return 'product_detail'
    if (/(?:^|\/)(?:tours|escorted-tours|private-tours)(?:\/|$)/.test(pathname)) return 'product_listing'
    return null
  },
  projectContent: projectTravelContent,
  interpretationGuidance: TRAVEL_INTERPRETATION_GUIDANCE,
}

export function profileForTags(tags: readonly string[]): BusinessContentProfile | undefined {
  return tags.includes('industry:travel') ? TRAVEL_BUSINESS_PROFILE : undefined
}
