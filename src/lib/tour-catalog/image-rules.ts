/**
 * Image URL rules for the tour catalog. Pure, no I/O.
 *
 * An image address is acceptable when it is already used somewhere in the client's draft
 * catalog, or when it is a site-relative path under /images/, or when it is an https URL on
 * the client's own website domain (or a subdomain) or on one of the client's extra image hosts.
 * SVG is refused: it can carry script. Design §6.10.1 item 6 / §6.11.1 item 5.
 */

import type { CatalogTour } from './types'
import type { ImageHostSuggestion } from './catalog-contract'
import { hostBelongsToDomain } from './settings-validation'

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
const BAD_CHARS_RE = /[\s\u0000-\u001f\u007f\\]/

/** The lower-cased extension of the last path segment, or '' when there is none. */
function pathExtension(pathname: string): string {
  const segments = pathname.split('/')
  const last = segments.length === 0 ? '' : segments[segments.length - 1]
  const dot = last.lastIndexOf('.')
  if (dot < 0) return ''
  return last.slice(dot + 1).toLowerCase()
}

/** Check a site-relative path: /images/… with a raster extension, no '..' and no '//'. */
function sitePathIssue(raw: string): ImageUrlIssue | null {
  if (!SITE_PATH_RE.test(raw)) return 'invalid_image_url'
  if (raw.includes('..')) return 'invalid_image_url'
  if (raw.includes('//')) return 'invalid_image_url'
  return null
}

/** Check an https URL: no credentials, no port, no SVG, host allowed. */
function httpsUrlIssue(raw: string, ctx: ImageRuleContext): ImageUrlIssue | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'invalid_image_url'
  }
  if (url.protocol !== 'https:') return 'invalid_image_url'
  if (url.username !== '' || url.password !== '' || url.port !== '') return 'invalid_image_url'
  const ext = pathExtension(url.pathname)
  if (ext === 'svg' || ext === 'svgz') return 'invalid_image_url'
  const host = url.hostname.toLowerCase()
  if (hostBelongsToDomain(host, ctx.clientDomain)) return null
  if (ctx.imageHosts.includes(host)) return null
  return 'image_host_not_allowed'
}

export function imageUrlIssue(raw: string, ctx: ImageRuleContext): ImageUrlIssue | null {
  if (ctx.imagePool.has(raw)) return null
  if (raw.length > MAX_IMAGE_URL_LENGTH) return 'too_long'
  if (BAD_CHARS_RE.test(raw)) return 'invalid_image_url'
  if (raw.startsWith('/')) return sitePathIssue(raw)
  if (raw.startsWith('https://')) return httpsUrlIssue(raw, ctx)
  return 'invalid_image_url'
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
