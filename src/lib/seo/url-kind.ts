/**
 * URL classification for SEO checks (2026-08-02).
 *
 * The site crawler stores whatever it discovers, including asset URLs
 * (`/wp-content/uploads/…/tile.jpg`). Feeding those into index checks or
 * orphan-page rules produces pure noise: an image not being "indexed as a
 * page" is normal, not a problem — and a to-do item telling a human to fix
 * it burns the credibility of every other item in the list.
 *
 * Real case that prompted this: Oztop's first index-check run flagged a
 * 750x900 JPEG as "URL is unknown to Google".
 */

/** Extensions that are assets/downloads, never indexable content pages. */
const NON_PAGE_EXTENSIONS = new Set([
  // images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tiff',
  // documents & archives
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'gz',
  // media
  'mp4', 'webm', 'mov', 'avi', 'mp3', 'wav', 'ogg',
  // code & data
  'css', 'js', 'mjs', 'json', 'xml', 'txt', 'map', 'woff', 'woff2', 'ttf', 'eot',
])

/**
 * True when the URL looks like an HTML content page worth SEO checks.
 * Extension-less paths (/china-tours, /) are pages; anything ending in a
 * known asset extension is not.
 */
export function isHtmlPageUrl(raw: string): boolean {
  let pathname: string
  try {
    pathname = new URL(raw).pathname
  } catch {
    return false
  }

  const lastSegment = pathname.replace(/\/+$/, '').split('/').pop() ?? ''
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0) return true // no extension → treat as a page

  const ext = lastSegment.slice(dotIndex + 1).toLowerCase()
  return !NON_PAGE_EXTENSIONS.has(ext)
}
