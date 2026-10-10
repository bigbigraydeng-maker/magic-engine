/**
 * Image URL rules for the tour catalog. Pure, no I/O.
 *
 * An image address is acceptable when it is a site-relative path under /images/, or an https URL
 * made of URL-safe characters only whose host is the client's own website domain (or a
 * subdomain) or one of the client's extra image hosts. An address already used somewhere in the
 * client's draft catalog is excused from the host list, and from nothing else.
 * SVG is refused: it can carry script. Design §6.10.1 item 6 / §6.11.1 item 5.
 */

import type { CatalogTour } from './types'
import type { ImageHostSuggestion } from './catalog-contract'
import { hostBelongsToDomain } from './settings-validation'
import { hasForbiddenChars } from './text-rules'

export { isValidImageHost } from './settings-validation'

export interface ImageRuleContext {
  /** Every image URL already used anywhere in this client's draft catalog. */
  imagePool: ReadonlySet<string>
  /** Extra allowed hostnames (lower-case). */
  imageHosts: readonly string[]
  /** The client's registered website domain as stored, or null. */
  clientDomain: string | null
}

export type ImageUrlIssue = 'too_long' | 'invalid_image_url' | 'image_host_not_allowed'

export const MAX_IMAGE_URL_LENGTH = 500
export const MAX_IMAGE_HOSTS = 10

const SITE_PATH_RE = /^\/images\/[A-Za-z0-9._/-]+\.(jpg|jpeg|png|webp|avif)$/
/**
 * The whole https address, as stored: letters, digits and URL-safe punctuation only. No
 * credentials, no port, no `#` fragment, and none of `< > " ' \`` or white space — the website
 * hands these addresses to the browser as they are (design §6.11.1).
 */
const HTTPS_URL_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?(\?[A-Za-z0-9._~!$&()*+,;=:@%/?-]*)?$/
/** Refused in every image address, whatever its form. */
const BAD_CHARS_RE = /[\s<>"'`\\]/
/** `.svg` / `.svgz` anywhere in the decoded path, in any letter case. SVG can carry script. */
const SVG_RE = /\.svgz?(\b|$|[/;?%])/i

export type ImageShapeIssue = 'too_long' | 'invalid_image_url'

/** True when the path, percent-decoded once, names an SVG (or cannot be decoded at all). */
function pathIsSvg(pathname: string): boolean {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return true
  }
  return SVG_RE.test(decoded)
}

/** Check a site-relative path: /images/… with a raster extension, no '..' and no '//'. */
function sitePathIssue(raw: string): ImageShapeIssue | null {
  if (!SITE_PATH_RE.test(raw)) return 'invalid_image_url'
  if (raw.includes('..')) return 'invalid_image_url'
  if (raw.includes('//')) return 'invalid_image_url'
  if (pathIsSvg(raw)) return 'invalid_image_url'
  return null
}

/** Check an https URL: safe characters only, parses, no credentials, no port, no SVG. */
function httpsUrlShapeIssue(raw: string): ImageShapeIssue | null {
  if (!HTTPS_URL_RE.test(raw)) return 'invalid_image_url'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'invalid_image_url'
  }
  if (url.protocol !== 'https:') return 'invalid_image_url'
  if (url.username !== '' || url.password !== '' || url.port !== '') return 'invalid_image_url'
  if (pathIsSvg(url.pathname)) return 'invalid_image_url'
  return null
}

/**
 * Everything about an image address except whose host it is: length, characters, protocol and
 * form. Used when saving AND when reading the website in, where there is no host list yet.
 */
export function imageUrlShapeIssue(raw: string): ImageShapeIssue | null {
  if (raw.length > MAX_IMAGE_URL_LENGTH) return 'too_long'
  if (BAD_CHARS_RE.test(raw) || hasForbiddenChars(raw)) return 'invalid_image_url'
  if (raw.startsWith('/')) return sitePathIssue(raw)
  if (raw.startsWith('https://')) return httpsUrlShapeIssue(raw)
  return 'invalid_image_url'
}

/**
 * The shape checks always run. An address the catalog already uses is excused from ONE thing
 * only — the host allow-list — so data read in from the website can still be saved before the
 * list is filled in, and nothing else rides in on "it was already there".
 */
export function imageUrlIssue(raw: string, ctx: ImageRuleContext): ImageUrlIssue | null {
  const shape = imageUrlShapeIssue(raw)
  if (shape !== null) return shape
  if (raw.startsWith('/')) return null
  if (ctx.imagePool.has(raw)) return null
  const host = new URL(raw).hostname.toLowerCase()
  if (hostBelongsToDomain(host, ctx.clientDomain)) return null
  if (ctx.imageHosts.includes(host)) return null
  return 'image_host_not_allowed'
}

/** Every image address used by these tours, de-duplicated and sorted ascending. */
export function collectImagePool(tours: readonly CatalogTour[]): string[] {
  const pool = new Set<string>()
  for (const tour of tours) {
    if (typeof tour.heroImage === 'string' && tour.heroImage !== '') pool.add(tour.heroImage)
    for (const item of tour.gallery) pool.add(item)
    for (const day of tour.itinerary) {
      const logo = day.operatorLogo
      if (logo !== undefined) pool.add(logo.src)
    }
  }
  return Array.from(pool).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Every image address used by these tours, in order, with repeats. */
function allImageAddresses(tours: readonly CatalogTour[]): string[] {
  const out: string[] = []
  for (const tour of tours) {
    if (typeof tour.heroImage === 'string' && tour.heroImage !== '') out.push(tour.heroImage)
    for (const item of tour.gallery) out.push(item)
    for (const day of tour.itinerary) {
      const logo = day.operatorLogo
      if (logo !== undefined) out.push(logo.src)
    }
  }
  return out
}

/** Hosts seen in the catalog's own images but not on the allow-list yet, most used first. */
export function imageHostSuggestions(
  tours: readonly CatalogTour[],
  imageHosts: readonly string[],
  clientDomain: string | null,
): ImageHostSuggestion[] {
  const counts = new Map<string, number>()
  for (const raw of allImageAddresses(tours)) {
    if (!raw.startsWith('https://')) continue
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase()
    if (imageHosts.includes(host)) continue
    if (hostBelongsToDomain(host, clientDomain)) continue
    counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  const out: ImageHostSuggestion[] = []
  for (const [host, count] of counts) out.push({ host, count })
  out.sort((a, b) => (b.count - a.count) || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
  return out
}
