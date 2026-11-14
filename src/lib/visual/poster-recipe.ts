/**
 * Poster recipes — a frozen registry of "turn a real photo into a branded poster" recipes,
 * plus the pure builders for the text that goes on the poster and the edit prompt.
 *
 * Platform-shared: no client names, IDs or URLs here. Everything client-specific
 * (tour facts, brand colours, website) is passed in.
 *
 * Rule: every word on the poster comes from published tour facts or the client's
 * website domain. The model is told to write exactly those lines and nothing else.
 */
import type { PublishedTourFact, PublishedTourFactDeparture } from '@/lib/tour-catalog/publish-contract'
import { containsPriceClaim } from '@/lib/content/price-claim'

export type PosterRecipeId = 'tour_poster_v1'

export interface PosterRecipe {
  id: PosterRecipeId
  version: number
  /** Image-edit model id (the Visual Studio "edit image" model). */
  model: string
  resolution: '2K'
}

export const POSTER_RECIPES: Readonly<Record<PosterRecipeId, Readonly<PosterRecipe>>> = Object.freeze({
  tour_poster_v1: Object.freeze({
    id: 'tour_poster_v1',
    version: 1,
    model: 'minimax-h3-image-edit',
    resolution: '2K',
  }),
})

export function resolvePosterRecipe(id: unknown): Readonly<PosterRecipe> | null {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(POSTER_RECIPES, id)) return null
  return POSTER_RECIPES[id as PosterRecipeId]
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/** Only #rrggbb is accepted (same rule as the lecture renderer). */
export function isHexColor(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
}

export interface PosterBrand {
  primary: string
  secondary: string | null
  accent: string | null
}

/** Brand colours from `master_briefs.vi_colors`. No valid primary → null (no poster). */
export function readPosterBrand(viColors: unknown): PosterBrand | null {
  if (typeof viColors !== 'object' || viColors === null) return null
  const vi = viColors as Record<string, unknown>
  if (!isHexColor(vi.primary)) return null
  return {
    primary: vi.primary,
    secondary: isHexColor(vi.secondary) ? vi.secondary : null,
    accent: isHexColor(vi.accent) ? vi.accent : null,
  }
}

/** Bare domain of the client's website ("https://www.example.com/x" → "example.com"); null if unusable. */
export function websiteDomain(website: unknown): string | null {
  if (typeof website !== 'string' || website.trim().length === 0) return null
  const raw = website.trim()
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host.includes('.') ? host : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Poster text
// ---------------------------------------------------------------------------

/** Fixed template label in front of the departure date. The date itself is a published fact. */
export const NEXT_DEPARTURE_LABEL = 'Next departure'

export type PosterLineLabel = 'Headline' | 'Duration' | 'Price' | 'Next departure' | 'Website'

export interface PosterEntry {
  label: PosterLineLabel
  /** Exactly what goes on the poster (for "Next departure" the label is part of it). */
  text: string
  /** The value after the label, as shown in the prompt. */
  value: string
}

export interface TourPosterLines {
  /** Labelled entries, top to bottom; the first is the headline. */
  entries: PosterEntry[]
  /** Text expected on the poster, top to bottom. */
  lines: string[]
  hasPrice: boolean
  /** YYYY-MM-DD of the departure on the poster, null when none is shown. */
  nextDepartOn: string | null
}

function clean(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 0 ? t : null
}

/** Earliest published departure on or after `date` (YYYY-MM-DD). */
export function nextDeparture(
  tour: Pick<PublishedTourFact, 'departures'>,
  date: string,
): PublishedTourFactDeparture | null {
  const upcoming = tour.departures
    .filter((d) => d.departOn >= date)
    .sort((a, b) => a.departOn.localeCompare(b.departOn))
  return upcoming[0] ?? null
}

function entry(label: PosterLineLabel, value: string | null): PosterEntry | null {
  if (value === null) return null
  const text = label === NEXT_DEPARTURE_LABEL ? `${NEXT_DEPARTURE_LABEL} ${value}` : value
  return { label, text, value }
}

/**
 * Poster lines from published facts only. A missing fact drops its line — never invented.
 * Price: the next departure's override if it has one, else the tour's display price.
 * `includePrice: false` drops the price line (used when the photo cannot back a real price).
 */
export function buildTourPosterLines(
  tour: PublishedTourFact,
  date: string,
  website: unknown,
  opts: { includePrice?: boolean } = {},
): TourPosterLines {
  const departure = nextDeparture(tour, date)
  const price = opts.includePrice === false
    ? null
    : clean(departure?.priceTextOverride) ?? clean(tour.displayPriceText)
  const departs = clean(departure?.displayDate)

  const entries = [
    entry('Headline', clean(tour.name)),
    entry('Duration', clean(tour.durationText)),
    entry('Price', price),
    entry(NEXT_DEPARTURE_LABEL, departs),
    entry('Website', websiteDomain(website)),
  ].filter((e): e is PosterEntry => e !== null)

  const lines = entries.map((e) => e.text)
  const hasPrice = price !== null || lines.some((l) => containsPriceClaim(l))
  return { entries, lines, hasPrice, nextDepartOn: departs && departure ? departure.departOn : null }
}

// ---------------------------------------------------------------------------
// Text check (the model sometimes misspells — "of TwoCinCities", "derparture")
// ---------------------------------------------------------------------------

/** Case, whitespace, curly vs straight quotes, "&" vs "and" and colons are not differences. */
export function normalisePosterText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/&/g, ' and ')
    .replace(/:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NUMERIC_TOKEN = /[$\u20ac\u00a3\u00a5]?\d[\d,.]*|[$\u20ac\u00a3\u00a5]/g

export type PosterTextMatch =
  | { match: true }
  | { match: false; missing: string[]; unexpected: string[] }

/**
 * Pure judgement of a transcription — the reader only copies, this decides.
 * Every expected line must appear contiguously; and any number / currency symbol in the
 * transcription must also appear in the expected text (no invented prices).
 */
export function posterTextMatches(expectedLines: string[], transcribed: string): PosterTextMatch {
  const got = normalisePosterText(transcribed)
  const tokens = (text: string) => (text.match(NUMERIC_TOKEN) ?? []).map((t) => t.replace(/[.,]+$/, ''))
  const allowed = new Set(tokens(normalisePosterText(expectedLines.join(' \n '))))
  const missing = expectedLines.filter((l) => !got.includes(normalisePosterText(l)))
  const unexpected = Array.from(new Set(tokens(got))).filter((t) => !allowed.has(t))
  return missing.length === 0 && unexpected.length === 0 ? { match: true } : { match: false, missing, unexpected }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export type PosterOrientation = 'portrait' | 'landscape'

function brandClause(brand: PosterBrand): string {
  const extras = [brand.secondary, brand.accent].filter((c): c is string => c !== null)
  const extra = extras.length > 0 ? `, ${extras.join(' and ')} sparingly for thin lines only` : ''
  return `Brand style: ${brand.primary} as the main accent${extra}, dark ink for body text, light panels.`
}

/**
 * The image-edit prompt. Each line carries a label (the format that worked in the live trial);
 * the model writes only the value, except for "Next departure" which keeps its label.
 * No quotes or brackets around text: a trial showed the model then draws the brackets.
 */
export function buildTourPosterPrompt(
  posterLines: Pick<TourPosterLines, 'entries'>,
  brand: PosterBrand,
  orientation?: PosterOrientation,
): string {
  const shape = orientation ? `a ${orientation} ` : 'a '
  return [
    `Turn image 1 into ${shape}Facebook travel poster.`,
    'Place a cream text panel along one edge of the photo with the text.',
    'Text lines, top to bottom, one per line, the first line is the headline:',
    ...posterLines.entries.map((e) => `${e.label}: ${e.value}`),
    `Write only the text after each label; do not write the labels themselves except '${NEXT_DEPARTURE_LABEL}'.`,
    brandClause(brand),
    'Serif display headline, clean sans-serif body.',
    'No purple or blue gradients, no neon, no emoji, no glowing blobs, no badges, no logo, no fake stamps.',
    'Keep the photograph authentic: do not change, add or remove any landmark, statue, building or mountain;',
    'only add typography and layout around it. Do not cover the main subject.',
    'All text must be spelled exactly as given, nothing else written. Do not draw quotation marks or brackets.',
  ].join('\n')
}
