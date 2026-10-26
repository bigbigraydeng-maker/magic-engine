import type { BrandVoiceFacts, TabooTier, TargetAudienceFacts, ViColorsFacts } from './types'

export const MAX_BRAND_LIST_ITEMS = 50
export const MAX_BRAND_TEXT_LEN = 200
export const MIN_TABOO_LEN = 2

/** Control chars (0x00-0x1F, 0x7F) plus zero-width / soft-hyphen characters. */
const STRIP_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u2060\uFEFF\u00AD]/g

/** Whitespace, Unicode punctuation and Unicode symbols. */
const NON_WORD_CHARS = /[\s\p{P}\p{S}]+/gu

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const stripped = value.replace(STRIP_CHARS, '').trim()
  if (stripped.length === 0) return null
  // Count code points, not UTF-16 units, so an emoji is never cut in half.
  const chars = Array.from(stripped)
  return chars.length > MAX_BRAND_TEXT_LEN ? chars.slice(0, MAX_BRAND_TEXT_LEN).join('') : stripped
}

export function readStrictList(value: unknown): string[] | null {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null
  for (const element of value) {
    if (typeof element !== 'string') return null
  }
  return value as string[]
}

export function readLenientList(value: unknown, warnings: string[], label: string): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) {
    warnings.push(`${label}_malformed`)
    return []
  }
  const result: string[] = []
  let sawNonString = false
  let truncated = false
  for (const element of value) {
    if (result.length >= MAX_BRAND_LIST_ITEMS) {
      truncated = true
      break
    }
    if (typeof element !== 'string') {
      sawNonString = true
      continue
    }
    const cleaned = cleanText(element)
    if (cleaned !== null) result.push(cleaned)
  }
  if (sawNonString) warnings.push(`${label}_malformed`)
  if (truncated) warnings.push(`${label}_truncated`)
  return result
}

/** Zero-width / soft-hyphen characters are invisible: left in, a redline phrase would silently never match. */
const INVISIBLE_CHARS = /[\u200B-\u200F\u2060\uFEFF\u00AD]/g

/** ASCII control characters (newlines included) become a space so one entry can never span lines. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g

/** Clean one taboo entry without truncating it (truncation would weaken a hard scan). */
function cleanTabooEntry(entry: string): string {
  return entry.replace(INVISIBLE_CHARS, '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/** One Han character is a meaningful taboo word (e.g. a single-character term); other scripts need MIN_TABOO_LEN. */
function isUnusableTabooEntry(entry: string): boolean {
  const normalized = entry.normalize('NFKC').replace(NON_WORD_CHARS, '')
  const minLength = /\p{Script=Han}/u.test(normalized) ? 1 : MIN_TABOO_LEN
  return normalized.length < minLength
}

export function buildTier(lists: ReadonlyArray<readonly string[]>): TabooTier {
  const raw: string[] = []
  for (const list of lists) {
    for (const entry of list) raw.push(entry)
  }
  const items: string[] = []
  const unusableEntries: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const cleaned = cleanTabooEntry(entry)
    if (isUnusableTabooEntry(cleaned)) {
      unusableEntries.push(cleaned.length > 0 ? cleaned : '(blank)')
      continue
    }
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(cleaned)
  }
  const status: TabooTier['status'] =
    raw.length === 0 ? 'none_configured' : items.length === 0 ? 'all_unusable' : 'set'
  return { items, status, unusable_count: unusableEntries.length, unusable_entries: unusableEntries }
}

function readFormality(value: unknown, warnings: string[]): BrandVoiceFacts['formality'] {
  if (value === 'casual' || value === 'neutral' || value === 'professional') return value
  if (value !== undefined && value !== null) warnings.push('brand_voice_formality_invalid')
  return null
}

function readEmojiUsage(value: unknown, warnings: string[]): BrandVoiceFacts['emoji_usage'] {
  if (value === 'none' || value === 'minimal' || value === 'moderate') return value
  if (value !== undefined && value !== null) warnings.push('brand_voice_emoji_usage_invalid')
  return null
}

function readPersona(value: unknown): BrandVoiceFacts['persona'] {
  if (!isPlainObject(value)) return null
  const name = cleanText(value.name)
  if (name === null) return null
  return { name, role: cleanText(value.role) }
}

/** null/undefined is "not configured" (quiet); any other non-object means unreadable data, so say so. */
function asObjectOrWarn(value: unknown, warnings: string[], label: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (isPlainObject(value)) return value
  warnings.push(`${label}_malformed`)
  return null
}

export function parseBrandVoice(input: unknown, warnings: string[]): BrandVoiceFacts | null {
  const value = asObjectOrWarn(input, warnings, 'brand_voice')
  if (value === null) return null
  return {
    tone_keywords: readLenientList(value.tone_keywords, warnings, 'brand_voice_tone_keywords'),
    avoid_keywords: readLenientList(value.avoid_keywords, warnings, 'brand_voice_avoid_keywords'),
    formality: readFormality(value.formality, warnings),
    emoji_usage: readEmojiUsage(value.emoji_usage, warnings),
    language_mix: cleanText(value.language_mix),
    persona: readPersona(value.persona),
  }
}

export function parseTargetAudience(input: unknown, warnings: string[]): TargetAudienceFacts | null {
  const value = asObjectOrWarn(input, warnings, 'target_audience')
  if (value === null) return null
  return {
    interests: readLenientList(value.interests, warnings, 'target_audience_interests'),
    pain_points: readLenientList(value.pain_points, warnings, 'target_audience_pain_points'),
    age_range: cleanText(value.age_range),
    location: cleanText(value.location),
  }
}

export function parseViColors(input: unknown, warnings: string[]): ViColorsFacts | null {
  const value = asObjectOrWarn(input, warnings, 'vi_colors')
  if (value === null) return null
  return {
    primary: cleanText(value.primary),
    secondary: cleanText(value.secondary),
    accent: cleanText(value.accent),
    background: cleanText(value.background),
  }
}

const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i

export function hostFromUrlLike(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const candidate = SCHEME_PREFIX.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const hostname = parsed.hostname.toLowerCase()
  if (!hostname.includes('.')) return null
  if (/\s/.test(hostname)) return null
  return hostname
}
