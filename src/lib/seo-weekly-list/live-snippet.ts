/**
 * Live search-snippet facts for one of the client's own pages: the real `<title>`,
 * meta description, canonical and robots, read straight from the public HTML.
 *
 * Why this exists: `client_site_pages.title` is the page's top heading (the crawler falls
 * back to it when the reader returns no title — verified 2026-10-05: it equals the H1 and
 * differs from the `<title>` Google shows). Title-length / truncation / duplicate-brand
 * checks on that column describe the wrong string.
 *
 * Pure parsing + one injectable fetch. Only https URLs; short timeout; body size capped.
 */

export interface LiveSnippet {
  title: string | null
  description: string | null
  canonical: string | null
  noindex: boolean
  status: number
}

export type SnippetFetcher = (url: string) => Promise<LiveSnippet | null>

const MAX_BODY_CHARS = 600_000
const FETCH_TIMEOUT_MS = 10_000

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function metaContent(html: string, attr: 'name' | 'property', value: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    if (!new RegExp(`${attr}\\s*=\\s*["']${value}["']`, 'i').test(tag)) continue
    const c = tag.match(/content\s*=\s*"([^"]*)"/i) ?? tag.match(/content\s*=\s*'([^']*)'/i)
    if (c) return decodeEntities(c[1]).trim()
  }
  return null
}

export function parseSnippet(html: string, status: number): LiveSnippet {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const canonical = (html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)?.[0] ?? '').match(/href\s*=\s*["']([^"']+)["']/i)
  const robots = metaContent(html, 'name', 'robots')
  return {
    title: t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() || null : null,
    description: metaContent(html, 'name', 'description'),
    canonical: canonical ? canonical[1] : null,
    noindex: robots !== null && /noindex/i.test(robots),
    status,
  }
}

/** Default fetcher: public GET of an https page of the client's own site. Any failure → null. */
export const fetchLiveSnippet: SnippetFetcher = async (url) => {
  if (!/^https:\/\//i.test(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; me-seo-snippet-check)' } })
    if (!res.ok) return null
    const html = (await res.text()).slice(0, MAX_BODY_CHARS)
    return parseSnippet(html, res.status)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const TITLE_TRUNCATION_CHARS = 60
const DESCRIPTION_TRUNCATION_CHARS = 160

/**
 * Brand repeated in the title tail, e.g. "… | CTS | CTS Tours": two or more of the
 * `|`-separated trailing segments are the client's brand (alias match on whole words).
 */
export function brandTailRepeated(title: string, brandAliases: string[] | null): boolean {
  const aliases = (brandAliases ?? []).map(a => a.toLowerCase().trim()).filter(a => a.length >= 2)
  if (aliases.length === 0) return false
  const segs = title.split('|').map(s => s.trim().toLowerCase()).slice(1)
  const isBrand = (seg: string) => aliases.some(a => seg === a || new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(seg))
  return segs.filter(isBrand).length >= 2
}

/** Mechanical, checkable defects of the real snippet. Wording is plain; none claims an effect on clicks. */
export function snippetQuickFixes(snippet: LiveSnippet, brandAliases: string[] | null): string[] {
  const out: string[] = []
  if (snippet.noindex) out.push('页面带 noindex（谷歌不会收录），先解决这个')
  if (snippet.title) {
    if (brandTailRepeated(snippet.title, brandAliases)) out.push(`线上标题品牌后缀重复：「${snippet.title}」（网站模板会自动加后缀，标题里不要再写一遍品牌）`)
    if (snippet.title.length > TITLE_TRUNCATION_CHARS) out.push(`线上标题 ${snippet.title.length} 个字符，超过约 ${TITLE_TRUNCATION_CHARS}，在谷歌里可能被截断`)
  }
  if (snippet.description && snippet.description.length > DESCRIPTION_TRUNCATION_CHARS) {
    out.push(`线上描述 ${snippet.description.length} 个字符，超过约 ${DESCRIPTION_TRUNCATION_CHARS}（本站数据没显示描述长度影响点击率，仅供参考）`)
  }
  return out
}
