/**
 * html-sanitizer — strip dangerous HTML before pushing to external platforms.
 *
 * Phase 14.A.4 MVP: regex-based strip of the most dangerous vectors.
 * Phase 14.A.7 will replace this with a proper allowlist-based parser
 * (e.g. DOMPurify on the server side via jsdom, or a headless parse pass).
 *
 * Current coverage:
 *   - Remove <script> … </script> blocks (including content)
 *   - Remove <iframe> … </iframe> blocks
 *   - Remove <object>, <embed>, <applet> tags
 *   - Strip inline event handlers (on*)
 *   - Strip javascript: / vbscript: href/src attributes
 *
 * What it does NOT do (P14.A.7 job):
 *   - Allowlist-based attribute filtering
 *   - CSS sanitization
 *   - SVG/MathML vector neutralisation
 */

// Remove script blocks (and their content).
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi

// Remove iframe blocks.
const IFRAME_RE = /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi

// Remove object / embed / applet tags (self-closing or block).
const EMBED_RE = /<(object|embed|applet)\b[^>]*\/?>[\s\S]*?<\/\1\s*>|<(object|embed|applet)\b[^>]*\/>/gi

// Strip inline event handlers: onXxx="..." or onXxx='...'.
const EVENT_HANDLER_RE = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

// Strip javascript: and vbscript: URLs in href/src attributes.
const DANGEROUS_URL_RE = /\b(href|src|action)\s*=\s*(['"]?\s*(?:javascript|vbscript)\s*:)/gi

export function sanitizeHtml(input: string): string {
  return input
    .replace(SCRIPT_RE, '')
    .replace(IFRAME_RE, '')
    .replace(EMBED_RE, '')
    .replace(EVENT_HANDLER_RE, '')
    .replace(DANGEROUS_URL_RE, (_, attr) => `${attr}="#"`)
}
