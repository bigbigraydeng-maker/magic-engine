export const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'entry_offer',
  'entry_page',
  'referrer',
] as const

export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number]

export type MarketingAttribution = Partial<Record<AttributionKey, string>>

type SearchParamReader = {
  get(name: string): string | null
}

export function normaliseAttribution(
  input: Record<string, unknown> | null | undefined,
): MarketingAttribution | null {
  if (!input) return null

  const out: MarketingAttribution = {}
  for (const key of ATTRIBUTION_KEYS) {
    const raw = input[key]
    if (typeof raw !== 'string') continue

    const value = raw.trim().slice(0, 300)
    if (value) out[key] = value
  }

  return Object.keys(out).length > 0 ? out : null
}

export function attributionFromSearchParams(
  params: SearchParamReader | null | undefined,
): MarketingAttribution | null {
  if (!params) return null

  const raw: Record<string, string> = {}
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key)
    if (value) raw[key] = value
  }

  return normaliseAttribution(raw)
}

export function withAttribution(
  href: string,
  attribution: MarketingAttribution | null | undefined,
): string {
  if (!attribution || Object.keys(attribution).length === 0) return href

  const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href)
  const url = new URL(href, isAbsolute ? undefined : 'https://magicengine.local')

  for (const key of ATTRIBUTION_KEYS) {
    const value = attribution[key]
    if (value) url.searchParams.set(key, value)
  }

  if (isAbsolute) return url.toString()

  const path = `${url.pathname}${url.search}${url.hash}`
  return path.startsWith('/') ? path : `/${path}`
}
