export const BUSINESS_PROJECTION_VERSION = 'business-content-v1'

export type BusinessPageRole = 'homepage' | 'product_listing' | 'product_detail' | 'offers' | 'news' | 'other'

export interface BusinessContentProfile {
  id: string
  classifyPath(pathname: string): BusinessPageRole | null
  projectContent?(raw: string, role: BusinessPageRole): string | null
  interpretationGuidance?: string
}

const TRACKER = /(?:bat\.bing\.com|google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.com\/tr|connect\.facebook\.net)/i
const RESOURCE = /(?:\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|css|js)(?:\?.*)?$|\/(?:assets?|static|_next)\/)/i
const BOILERPLATE = /^(?:accept all cookies|cookie settings|manage cookies|skip to (?:main )?content)$/i

export function classifyBusinessPage(url: string, profile?: BusinessContentProfile): BusinessPageRole {
  const path = new URL(url).pathname.toLowerCase().replace(/\/+$/, '') || '/'
  const industryRole = profile?.classifyPath(path)
  if (industryRole) return industryRole
  if (path === '/') return 'homepage'
  if (/(?:^|\/)(?:offers?|deals?|promotions?|sale)(?:\/|$)/.test(path)) return 'offers'
  if (/(?:^|\/)(?:products?|catalogue?|catalog|collections?|search)(?:\/|$)/.test(path)) return 'product_listing'
  if (/(?:^|\/)(?:news|press|announcements?|blog)(?:\/|$)/.test(path)) return 'news'
  return 'other'
}

/**
 * Keep the full provider text in the snapshot, but compare this deterministic
 * projection so tracking pixels and asset churn cannot become market signals.
 */
export function projectBusinessContent(raw: string): string {
  const projected: string[] = []
  let previousKey = ''
  const prepared = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

  for (const sourceLine of prepared.replace(/\r\n/g, '\n').split('\n')) {
    const line = sourceLine
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/<[^>]+>/g, ' ')
      .trim()
      .replace(/[\t ]+/g, ' ')
    if (!line || BOILERPLATE.test(line) || TRACKER.test(line)) continue
    if (/^https?:\/\/\S+$/i.test(line) && RESOURCE.test(line)) continue
    if (/^(?:image|background image):\s*/i.test(line)) continue
    const key = line.toLocaleLowerCase('en-NZ')
    if (key === previousKey) continue
    previousKey = key
    projected.push(line)
  }
  return projected.join('\n')
}
