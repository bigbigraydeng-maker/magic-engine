import { DEFAULT_COVER, NO_LOGOS, type ConfirmationData } from './types'
import { isLogo } from './logo-rules'
import { MAX_COVER_TITLE } from './cover'

/** A tour code is one token of letters/digits/hyphens (e.g. CTS4270729), never with spaces. */
const TOUR_CODE_RE = /^[A-Z0-9][A-Z0-9-]{3,31}$/

/**
 * Returns human-readable problems (empty array = OK to generate).
 * The check that matters most: the tour code must be a single well-formed
 * value, because the source document once carried two different codes.
 */
export function validateConfirmation(d: ConfirmationData): string[] {
  const errors: string[] = []

  const code = d.tourCode.trim()
  if (!code) errors.push('团号必填')
  else if (!TOUR_CODE_RE.test(code)) errors.push('团号格式不对：只能是字母、数字和短横线，4–32 位，不要空格')

  if (!d.groundOperator.trim()) errors.push('地接社名称必填')
  if (!Number.isInteger(d.paxCount) || d.paxCount < 1) errors.push('人数至少 1 人')
  if (!d.departureDate.trim()) errors.push('出发日期必填')
  if (d.days.length === 0) errors.push('至少要有一天行程')

  d.days.forEach((day, i) => {
    if (!day.date.trim()) errors.push(`第 ${i + 1} 天缺日期`)
    if (!day.route.trim()) errors.push(`第 ${i + 1} 天缺路线`)
  })

  d.emergencyContacts.forEach((c, i) => {
    if (c.name.trim() && !c.mobile.trim()) errors.push(`紧急联系人 ${i + 1} 缺电话`)
  })

  return errors
}

/** Lines of free text -> trimmed non-empty lines. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

const MAX_TEXT = 20_000
const MAX_ITEMS = 200

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT
const arrOf = <T>(v: unknown, ok: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.length <= MAX_ITEMS && v.every(ok)
const strings = (v: unknown): v is string[] => arrOf(v, str)

/**
 * Structural check for data that arrives from outside (API body, saved browser draft).
 * Returns the typed object, or a short reason. Never throws.
 */
export function parseConfirmation(input: unknown): { ok: true; data: ConfirmationData } | { ok: false; error: string } {
  const bad = (what: string) => ({ ok: false as const, error: `数据格式不对：${what}` })
  if (!isObj(input)) return bad('不是对象')
  const o = input
  for (const k of ['tourCode', 'groundOperator', 'operatorTel', 'departureDate', 'rooms', 'pickupCardNames', 'guideNote', 'itineraryNote'] as const) {
    if (!str(o[k])) return bad(k)
  }
  if (typeof o.paxCount !== 'number' || !Number.isFinite(o.paxCount)) return bad('paxCount')
  if (!arrOf(o.emergencyContacts, (x): x is { name: string; mobile: string } => isObj(x) && str(x.name) && str(x.mobile))) return bad('emergencyContacts')
  if (!arrOf(o.flights, (x): x is { text: string } => isObj(x) && str(x.text))) return bad('flights')
  if (!arrOf(o.days, (x): x is Record<string, string> => isObj(x) && str(x.date) && str(x.route) && str(x.highlights) && str(x.overnight))) return bad('days')
  if (!arrOf(o.hotels, (x): x is Record<string, unknown> => isObj(x) && str(x.city) && str(x.name) && typeof x.stars === 'number' && str(x.address) && str(x.phone) && str(x.chinese))) return bad('hotels')
  if (!strings(o.inclusions)) return bad('inclusions')
  if (!strings(o.exclusions)) return bad('exclusions')
  if (!arrOf(o.tips, (x): x is { title: string; body: string } => isObj(x) && str(x.title) && str(x.body))) return bad('tips')
  // cover is newer than saved drafts: missing -> default; present -> must be well formed
  let cover = DEFAULT_COVER
  if (o.cover !== undefined) {
    const c = o.cover
    if (!isObj(c) || (c.style !== 'photo' && c.style !== 'banner') || !str(c.hero) || !str(c.title)) return bad('cover')
    // over-long titles (older drafts, direct API calls) are cut so the cover stays on one line
    cover = { style: c.style, hero: c.hero, title: c.title.slice(0, MAX_COVER_TITLE) }
  }
  // logos are newer still: missing -> none; present -> two small PNG/JPEG data URIs (or '')
  let logos = NO_LOGOS
  if (o.logos !== undefined) {
    const l = o.logos
    if (!isObj(l) || !isLogo(l.left) || !isLogo(l.right)) return bad('logos')
    logos = { left: l.left, right: l.right }
  }
  return { ok: true, data: { ...(o as unknown as ConfirmationData), cover, logos } }
}
