/**
 * html-sanitizer — allowlist-based HTML sanitizer for content pushed to external CMS platforms.
 *
 * Phase 14.A.7: upgraded from MVP regex-only to a three-pass approach.
 * Bug-fix update: JSON-LD schema blocks (<script type="application/ld+json">) are now
 *   extracted before sanitisation and re-injected afterwards so they survive Pass 2/3.
 *
 * Sanitisation pipeline:
 *   Pre-pass  — extract JSON-LD blocks to null-char placeholders.
 *   Pass 1    — remove inherently dangerous elements (script, iframe, style, form, svg, …).
 *   Pass 2    — strip any remaining tags not in the allowlist, preserving their inner content.
 *   Pass 3    — strip any remaining attributes not in the per-tag allowlist.
 *   Post-pass — restore JSON-LD blocks from placeholders.
 *
 * No external dependencies — uses only Node.js built-ins and string manipulation.
 *
 * Allowed tags: headings, text formatting, lists, links, images, tables, structural blocks.
 * Allowed attributes: class, id, href (https? only), src (https? only), alt, title,
 *                     target, rel, width, height, colspan, rowspan.
 */

// ─── Pre-pass: extract JSON-LD blocks before sanitisation ────────────────────

// Matches <script type="application/ld+json">…</script> blocks that should be preserved.
const JSONLD_BLOCK_RE = /<script\s[^>]*type=['"]application\/ld\+json['"][^>]*>[\s\S]*?<\/script\s*>/gi

// ─── Pass 1: remove dangerous element blocks (tag + content) ─────────────────

// Strip all remaining <script> blocks (JSON-LD already extracted by pre-pass).
const DANGEROUS_SCRIPT_RE = /<script[^>]*>[\s\S]*?<\/script\s*>/gi

// Strip other dangerous block elements.
const DANGEROUS_BLOCK_RE = new RegExp(
  '<(?:style|iframe|object|embed|applet|form|svg|math|template)' +
  '\\b[^>]*>[\\s\\S]*?<\\/(?:style|iframe|object|embed|applet|form|svg|math|template)\\s*>',
  'gi',
)

// Self-closing / void dangerous tags.
const DANGEROUS_VOID_RE =
  /<(?:input|button|select|textarea|base|link|meta)\b[^>]*\/?>/gi

// Inline event handlers: onXxx="..." or onXxx='...'.
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

// javascript: / vbscript: / data: URLs in any href/src/action attribute.
const DANGEROUS_URL_ATTR_RE =
  /\b(href|src|action)\s*=\s*(['"]?\s*(?:javascript|vbscript|data)\s*:)/gi

// ─── Pass 2: allowlist-based tag stripping ────────────────────────────────────

const ALLOWED_TAGS = new Set([
  // Block
  'p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav',
  'blockquote', 'pre', 'hr', 'br',
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Inline text
  'span', 'strong', 'em', 'b', 'i', 's', 'u', 'del', 'ins', 'mark',
  'code', 'kbd', 'var', 'samp', 'abbr', 'cite', 'q', 'small', 'sub', 'sup',
  // Links & media
  'a', 'img', 'figure', 'figcaption', 'picture', 'source',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Other semantic
  'details', 'summary', 'time', 'address',
])

// ─── Pass 3: attribute allowlist per tag ──────────────────────────────────────

// Global attributes safe on any tag.
const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'lang', 'dir'])

// Extra attributes allowed on specific tags.
const TAG_EXTRA_ATTRS: Record<string, Set<string>> = {
  a:        new Set(['href', 'target', 'rel', 'download']),
  img:      new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  source:   new Set(['src', 'srcset', 'type', 'media', 'sizes']),
  picture:  new Set([]),
  th:       new Set(['colspan', 'rowspan', 'scope']),
  td:       new Set(['colspan', 'rowspan']),
  col:      new Set(['span']),
  colgroup: new Set(['span']),
  time:     new Set(['datetime']),
}

// Regex to match an individual attribute: name="value" | name='value' | name=value | name
const ATTR_RE = /\s+([a-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/gi

// Allowed URL schemes for href and src.
const SAFE_URL_RE = /^https?:\/\//i

function sanitizeAttributes(tag: string, attrString: string): string {
  const tagLower = tag.toLowerCase()
  const allowed  = TAG_EXTRA_ATTRS[tagLower] ?? new Set<string>()
  const parts: string[] = []

  let m: RegExpExecArray | null
  ATTR_RE.lastIndex = 0

  while ((m = ATTR_RE.exec(attrString)) !== null) {
    const name  = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? null

    if (!GLOBAL_ATTRS.has(name) && !allowed.has(name)) continue

    // URL safety check for href and src.
    if ((name === 'href' || name === 'src') && value) {
      const trimmed = value.trim()
      if (!SAFE_URL_RE.test(trimmed) && !trimmed.startsWith('/') && !trimmed.startsWith('#')) {
        continue
      }
    }

    // Enforce rel="noopener noreferrer" on external links.
    if (tagLower === 'a' && name === 'href' && value && SAFE_URL_RE.test(value.trim())) {
      parts.push(`rel="noopener noreferrer" target="_blank"`)
    }

    if (value !== null) {
      const escaped = value.replace(/"/g, '&quot;')
      parts.push(`${name}="${escaped}"`)
    } else {
      parts.push(name)
    }
  }

  return parts.length ? ' ' + parts.join(' ') : ''
}

// Match an opening tag with its attribute string (not self-closing void tags).
const OPENING_TAG_WITH_ATTRS_RE = /<([a-z][a-z0-9-]*)((?:\s+[a-z][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*\/?>/gi

function rewriteAttributes(html: string): string {
  return html.replace(
    OPENING_TAG_WITH_ATTRS_RE,
    (_full, tag: string, attrs: string) => {
      if (!ALLOWED_TAGS.has(tag.toLowerCase())) return ''
      const cleanAttrs = sanitizeAttributes(tag, attrs)
      return `<${tag}${cleanAttrs}>`
    },
  )
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function sanitizeHtml(input: string): string {
  // Pre-pass: extract JSON-LD blocks — Pass 2/3 would strip <script> tags regardless of type.
  const jsonLdBlocks: string[] = []
  let out = input.replace(JSONLD_BLOCK_RE, (match) => {
    const idx = jsonLdBlocks.push(match) - 1
    return `\x00JSONLD${idx}\x00`
  })

  // Pass 1: remove dangerous block/void elements and dangerous attribute patterns.
  out = out
    .replace(DANGEROUS_SCRIPT_RE, '')
    .replace(DANGEROUS_BLOCK_RE, '')
    .replace(DANGEROUS_VOID_RE, '')
    .replace(EVENT_HANDLER_RE, '')
    .replace(DANGEROUS_URL_ATTR_RE, (_, attr) => `${attr}="#"`)

  // Pass 2: rewrite opening tags — strip unknown tags, clean attributes.
  out = rewriteAttributes(out)

  // Pass 3: strip any remaining unknown closing tags.
  out = out.replace(/<\/([a-z][a-z0-9-]*)\s*>/gi, (_full, tag: string) =>
    ALLOWED_TAGS.has(tag.toLowerCase()) ? `</${tag}>` : '',
  )

  // Post-pass: restore JSON-LD blocks.
  jsonLdBlocks.forEach((block, i) => {
    out = out.replace(`\x00JSONLD${i}\x00`, block)
  })

  return out
}

/**
 * Strip the first H1 element from HTML before CMS publishing.
 * WordPress and Shopify both render the post `title` field as an H1 automatically,
 * so keeping H1 in the body would create a duplicate heading.
 */
export function stripLeadingH1(html: string): string {
  return html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '').replace(/^\s+/, '')
}

/**
 * Layer-2 CMS content preparation pipeline.
 * Run this instead of bare sanitizeHtml() in every CMS publish route:
 *   1. Strip duplicate H1 (CMS title field adds one automatically).
 *   2. Sanitize HTML (allowlist tags/attrs, strip scripts except JSON-LD).
 */
export function prepareCmsContent(html: string): string {
  return sanitizeHtml(stripLeadingH1(html))
}
