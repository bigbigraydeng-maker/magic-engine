import { FALLBACK, HERO_CHOICES, pickHeroName } from '@/lib/tailor-made/hero-rules'
import type { ConfirmationData } from './types'

/** Unique overnight cities (falling back to day routes), in trip order. */
export function coverRouteStops(d: ConfirmationData): string[] {
  const stops: string[] = []
  for (const day of d.days) {
    const c = day.overnight.trim()
    if (c && !stops.includes(c)) stops.push(c)
  }
  if (stops.length) return stops
  for (const day of d.days) {
    const r = day.route.trim()
    if (r && !stops.includes(r)) stops.push(r)
  }
  return stops
}

/** The cover picture actually used: the staff's choice, else picked from the itinerary like Tailor-made does. */
export function resolveHeroName(d: ConfirmationData): string {
  const chosen = d.cover.hero
  if (chosen !== 'auto' && HERO_CHOICES.some((c) => c.name === chosen)) return chosen
  // Ordered search list: overnight cities first (where the trip really is), then the route split
  // into single stops ("Beijing → Xi'an" -> Beijing, Xi'an), then the highlight lines.
  const split = (t: string) => t.split(/\s*(?:→|->|=>|–|—|\/|,|&|;| to )\s*/i).map((x) => x.trim()).filter(Boolean)
  const search = [
    ...d.days.map((day) => day.overnight),
    ...d.days.flatMap((day) => split(day.route)),
    ...d.days.flatMap((day) => day.highlights.split(/\r?\n/)),
  ].filter((x) => x.trim())
  return pickHeroName({ title: d.cover.title, route: search }) || FALLBACK
}

export function heroLabel(name: string): string {
  return HERO_CHOICES.find((c) => c.name === name)?.label ?? name
}

export function coverTitle(d: ConfirmationData): string {
  return d.cover.title.trim() || 'Welcome to China! 欢迎到中国！'
}

/** Width/height of a JPEG from its header (no image library needed); null if unreadable. */
export function jpegSize(buf: Uint8Array): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const m = buf[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { height: (buf[i + 5] << 8) | buf[i + 6], width: (buf[i + 7] << 8) | buf[i + 8] }
    }
    i += 2 + ((buf[i + 2] << 8) | buf[i + 3])
  }
  return null
}
