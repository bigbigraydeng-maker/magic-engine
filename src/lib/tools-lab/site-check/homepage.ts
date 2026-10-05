// Read a visitor-supplied site's homepage — only if it is a real, readable page of that same site.
//
// Network safety (private / loopback / metadata addresses, DNS rebinding, per-hop re-validation, size cap,
// DNS timeout) is delegated to the platform's connection-bound fetch `safeFetchText` (src/lib/net/safe-fetch.ts).
// This module adds the site-check rules: homepage only, same site after redirects, 2xx, HTML, UTF-8,
// enough visible text, and not a firewall / challenge page. All HTML handling is linear-time.

import { BlockedAddressError, safeFetchText, type SafeFetchTextResponse } from '@/lib/net/safe-fetch'
import { detectAntibotChallenge } from '@/lib/site-audit/antibot-detector'
import { siteHost, vetUrl } from './guards'

export const MAX_PAGE_BYTES = 2_000_000
export const MAX_REDIRECTS = 3
export const MIN_TEXT_CHARS = 300
/** Whole-fetch budget, so the model still has time before the browser's 90 s timeout. */
export const FETCH_BUDGET_MS = 25_000

export type HomepageFailureReason =
  | 'invalid_url'
  | 'blocked_address'
  | 'unreachable'
  | 'not_html'
  | 'encoding'
  | 'challenge'
  | 'too_little_text'
  | 'redirected_away'

export type HomepageResult =
  | { ok: true; text: string; title: string; finalUrl: string }
  | { ok: false; reason: HomepageFailureReason }

export interface FetchHomepageOptions {
  fetchText?: typeof safeFetchText
  budgetMs?: number
}

// ── Linear-time HTML helpers (pages are attacker-supplied: no regex over the whole page) ─────────────────

export function extractTitle(html: string): string {
  const src = String(html || '')
  const lower = src.toLowerCase()
  const open = lower.indexOf('<title')
  if (open === -1) return ''
  const start = lower.indexOf('>', open)
  if (start === -1) return ''
  const end = lower.indexOf('</title', start)
  if (end === -1) return ''
  return src.slice(start + 1, Math.min(end, start + 1 + 1000)).replace(/\s+/g, ' ').trim()
}

/** Drop <tag ...>...</tag> blocks; an unclosed block runs to the end of the page. */
function dropBlocks(src: string, tag: string): string {
  const lower = src.toLowerCase()
  const open = `<${tag}`
  const close = `</${tag}`
  let out = ''
  let pos = 0
  while (pos < src.length) {
    const start = lower.indexOf(open, pos)
    if (start === -1) break
    out += src.slice(pos, start) + ' '
    const end = lower.indexOf(close, start + open.length)
    if (end === -1) return out
    const gt = lower.indexOf('>', end)
    pos = gt === -1 ? src.length : gt + 1
  }
  return out + src.slice(pos)
}

/** Replace every <...> tag with a space; an unclosed tag runs to the end. */
function dropTags(src: string): string {
  let out = ''
  let pos = 0
  while (pos < src.length) {
    const lt = src.indexOf('<', pos)
    if (lt === -1) break
    out += src.slice(pos, lt) + ' '
    const gt = src.indexOf('>', lt + 1)
    if (gt === -1) return out
    pos = gt + 1
  }
  return out + src.slice(pos)
}

export function extractText(html: string): string {
  let src = String(html || '')
  for (const tag of ['script', 'style', 'noscript']) src = dropBlocks(src, tag)
  return dropTags(src)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const TITLE_CHALLENGE = [/robot\s+challenge\s+screen/i, /siteground.{0,20}security/i, /just\s+a\s+moment\.\.\./i, /wordfence/i, /sucuri.{0,40}firewall/i]
const TITLE_GENERIC = [/^attention\s+required/i, /access\s+denied/i, /security\s+check/i]
const BODY_CHALLENGE = [/sg[-_]?captcha/i, /\bsgs[-_]?block\b/i, /checking\s+the\s+site\s+connection\s+security/i, /cf[-_]chl[-_](?:jschl|opt)/i, /enable\s+javascript\s+and\s+cookies\s+to\s+continue/i, /generated\s+by\s+wordfence/i, /sucuri\s+website\s+firewall/i]

/** Mirrors src/lib/site-audit/antibot-detector.ts: firewall / challenge pages are not the site. */
export function looksLikeChallenge(title: string, text: string, rawHtml: string): boolean {
  const t = String(title || '').trim()
  if (TITLE_CHALLENGE.some((re) => re.test(t))) return true
  if (TITLE_GENERIC.some((re) => re.test(t)) && String(text || '').trim().length <= 200) return true
  const scan = String(rawHtml || '').slice(0, 8192)
  return BODY_CHALLENGE.some((re) => re.test(scan))
}

// ── Fetch ─────────────────────────────────────────────────────────────────────────────────────────────────

async function fetchWithinBudget(
  url: string,
  fetchText: typeof safeFetchText,
  budgetMs: number,
): Promise<SafeFetchTextResponse | HomepageFailureReason> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const overBudget = new Promise<HomepageFailureReason>((resolve) => {
    timer = setTimeout(() => resolve('unreachable'), budgetMs)
  })
  const attempt = fetchText(url, {
    maxRedirects: MAX_REDIRECTS,
    maxResponseBytes: MAX_PAGE_BYTES,
    timeoutMs: 10_000,
    dnsTimeoutMs: 4_000,
    userAgent: 'MagicEngineSiteCheck/1.0 (+https://magicengine.com.au/cn/lab/)',
    headers: { Accept: 'text/html' },
  }).catch((err: unknown): HomepageFailureReason => (err instanceof BlockedAddressError ? 'blocked_address' : 'unreachable'))
  try {
    return await Promise.race([attempt, overBudget])
  } finally {
    clearTimeout(timer)
  }
}

/** Response-level rules: same site, 2xx, HTML, UTF-8. Returns a failure reason or null. */
function responseProblem(res: SafeFetchTextResponse, startHost: string): HomepageFailureReason | null {
  const final = vetUrl(res.url)
  if (!final || siteHost(final.hostname) !== startHost) return 'redirected_away'
  if (!res.ok) return 'unreachable'
  const type = res.headers.get('content-type') || ''
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) return 'not_html'
  const declared = (type.match(/charset=([^;]+)/i) || [])[1]
  if (declared && !/^\s*utf-?8\s*$/i.test(declared)) return 'encoding'
  if (/<meta[^>]+charset=["']?\s*(gb2312|gbk|gb18030|big5|shift_jis|euc-[a-z]+|iso-8859-\d+|windows-\d+)/i.test(res.text.slice(0, 4096))) {
    return 'encoding'
  }
  return null
}

/** Fetch the homepage (origin + '/') only if it is a real, readable page of the same site. */
export async function fetchRealHomepage(input: string, opts: FetchHomepageOptions = {}): Promise<HomepageResult> {
  const given = vetUrl(input)
  if (!given) return { ok: false, reason: 'invalid_url' }
  // Homepage only: a path or query could point at a page whose text the visitor controls.
  const homepage = `${given.origin}/`
  const res = await fetchWithinBudget(homepage, opts.fetchText ?? safeFetchText, opts.budgetMs ?? FETCH_BUDGET_MS)
  if (typeof res === 'string') return { ok: false, reason: res }
  const problem = responseProblem(res, siteHost(given.hostname))
  if (problem) return { ok: false, reason: problem }
  const title = extractTitle(res.text)
  const text = extractText(res.text)
  if (looksLikeChallenge(title, text, res.text)) return { ok: false, reason: 'challenge' }
  // Too little text first: the shared detector also flags "no title + very short body", which for a JS-only
  // shell would wrongly tell the visitor they were shown a security check.
  if (text.length < MIN_TEXT_CHARS) return { ok: false, reason: 'too_little_text' }
  if (detectAntibotChallenge(text, title) !== null) return { ok: false, reason: 'challenge' }
  return { ok: true, text: text.slice(0, 8000), title, finalUrl: res.url }
}

/** The address that will actually be fetched for a visitor-supplied URL. */
export function homepageOf(input: string): string | null {
  const given = vetUrl(input)
  return given ? `${given.origin}/` : null
}
