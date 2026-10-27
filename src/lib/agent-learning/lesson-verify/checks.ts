/**
 * SEO/GEO 只读检查：只回答"这个站点现在符合不符合这条经验"，
 * 不证明"照做就会变好"。不调模型、不写库。
 */
import { safeFetchText } from '@/lib/net/safe-fetch'
import { detectAntibotChallenge } from '@/lib/site-audit/antibot-detector'
import { extractText, extractTitle, looksLikeChallenge, MAX_PAGE_BYTES, MIN_TEXT_CHARS } from '@/lib/tools-lab/site-check/homepage'
import { siteHost, vetUrl } from '@/lib/tools-lab/site-check/guards'

export interface CheckResult {
  pass: boolean
  /** 给非技术人员看的一句话。 */
  summary: string
}

export function checkHtmlText(html: string): CheckResult {
  const chars = extractText(html).length
  return chars >= MIN_TEXT_CHARS
    ? { pass: true, summary: `符合：首页纯 HTML 里能直接看到约 ${chars} 字正文（不靠 JavaScript）。` }
    : { pass: false, summary: `不符合：首页纯 HTML 里只有约 ${chars} 字正文，内容可能要靠 JavaScript 才出现。` }
}

/** 线性扫描 <script type="application/ld+json">，避免对攻击者页面跑复杂正则。 */
export function countJsonLd(html: string): number {
  const lower = html.toLowerCase()
  let count = 0
  let pos = 0
  while (pos < lower.length) {
    const open = lower.indexOf('<script', pos)
    if (open === -1) break
    const gt = lower.indexOf('>', open)
    if (gt === -1) break
    if (lower.slice(open, gt).includes('application/ld+json')) count += 1
    pos = gt + 1
  }
  return count
}

export function checkStructuredData(html: string): CheckResult {
  const n = countJsonLd(html)
  return n > 0
    ? { pass: true, summary: `符合：首页有 ${n} 段结构化数据（JSON-LD）。` }
    : { pass: false, summary: '不符合：首页没有发现结构化数据（JSON-LD）。' }
}

/** 判定前先确认拿到的确实是所选站点的真实 HTML 页面；否则"无法检查"，不给符合/不符合。 */
function responseProblem(res: { url: string; text: string; headers: Headers }, startHostname: string): string | null {
  const final = vetUrl(res.url)
  if (!final || siteHost(final.hostname) !== siteHost(startHostname)) return '站点跳转到了别的网站，没法检查'
  if (!/text\/html|application\/xhtml\+xml/i.test(res.headers.get('content-type') || '')) {
    return '站点返回的不是网页（HTML），没法检查'
  }
  const title = extractTitle(res.text)
  const text = extractText(res.text)
  if (looksLikeChallenge(title, text, res.text) || (text.length >= MIN_TEXT_CHARS && detectAntibotChallenge(text, title) !== null)) {
    return '站点返回的是防爬验证页，没法检查'
  }
  return null
}

export type SiteCheckKind = 'html_visible' | 'structured_data'

export type SiteCheckOutcome =
  | { ok: true; url: string; result: CheckResult }
  | { ok: false; error: string }

export async function runSiteCheck(
  kind: SiteCheckKind,
  domain: string,
  fetchText: typeof safeFetchText = safeFetchText,
): Promise<SiteCheckOutcome> {
  const given = vetUrl(domain)
  if (!given) return { ok: false, error: '站点地址不合法' }
  const url = `${given.origin}/`
  try {
    const res = await fetchText(url, {
      maxRedirects: 3,
      maxResponseBytes: MAX_PAGE_BYTES,
      timeoutMs: 10_000,
      dnsTimeoutMs: 4_000,
      userAgent: 'MagicEngineSiteCheck/1.0 (+https://magicengine.com.au)',
      headers: { Accept: 'text/html' },
    })
    if (!res.ok) return { ok: false, error: `站点返回 ${res.status}，没法检查` }
    const problem = responseProblem(res, given.hostname)
    if (problem) return { ok: false, error: problem }
    const result = kind === 'html_visible' ? checkHtmlText(res.text) : checkStructuredData(res.text)
    return { ok: true, url, result }
  } catch {
    return { ok: false, error: '站点打不开或被拦截，没法检查' }
  }
}
