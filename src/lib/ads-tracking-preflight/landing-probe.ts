/**
 * 落地页探测：只探官网自己的主机，手动跟跳转，读出状态码 / 最终地址 / UTM 是否保留 / 页面里的像素编号。
 * 平台通用：不写任何客户名 / 域名 / 编号。
 */

import type { LandingProbeFact, LandingTarget } from './types'
import { sanitizeError } from './sanitize'

export const MAX_REDIRECTS = 5
export const MAX_BODY_CHARS = 2_000_000
export const PROBE_TIMEOUT_MS = 15_000

const PLACEHOLDER_BASE = 'https://placeholder.invalid'
const USER_AGENT = 'MagicEngine-TrackingPreflight/1.0'

// ─── 像素编号 ───────────────────────────────────────────────────────────────

/** facebook.com/tr?...id=<digits>：允许 id= 前面还有别的查询参数。 */
const TR_ID_RE = /facebook\.com\/tr\?[^"'<>]*?\bid=(\d{10,20})/g

/** fbq('init', '<digits>')：单双引号、空格都认；后面还可以跟高级匹配参数 fbq('init', 'id', {...})。 */
const FBQ_INIT_RE = /fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g

interface PixelHit {
  index: number
  id: string
}

function collect(re: RegExp, html: string, out: PixelHit[]): void {
  re.lastIndex = 0
  let match: RegExpExecArray | null = re.exec(html)
  while (match !== null) {
    out.push({ index: match.index, id: match[1] })
    match = re.exec(html)
  }
}

export function extractPixelIds(html: string): string[] {
  const hits: PixelHit[] = []
  collect(TR_ID_RE, html, hits)
  collect(FBQ_INIT_RE, html, hits)
  hits.sort((a, b) => a.index - b.index)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const hit of hits) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    ids.push(hit.id)
  }
  return ids
}

// ─── UTM ────────────────────────────────────────────────────────────────────

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw, PLACEHOLDER_BASE)
  } catch {
    return null
  }
}

export function utmPreserved(requestedUrl: string, finalUrl: string): boolean | null {
  const requested = parseUrl(requestedUrl)
  if (requested === null) return null
  const utmEntries: [string, string][] = []
  requested.searchParams.forEach((value, name) => {
    if (name.startsWith('utm_')) utmEntries.push([name, value])
  })
  if (utmEntries.length === 0) return null
  const final = parseUrl(finalUrl)
  if (final === null) return false
  return utmEntries.every(([name, value]) => final.searchParams.get(name) === value)
}

// ─── 主机白名单 ─────────────────────────────────────────────────────────────

function normalizeHost(hostname: string): string {
  const lower = hostname.toLowerCase()
  return lower.startsWith('www.') ? lower.slice(4) : lower
}

export function isProbeUrlAllowed(url: string, siteUrl: string): boolean {
  const site = parseUrl(siteUrl)
  if (site === null) return false
  const target = parseUrl(url)
  if (target === null) return false
  if (target.protocol !== 'https:') return false
  if (target.username !== '' || target.password !== '') return false
  if (target.port !== '') return false
  return normalizeHost(target.hostname) === normalizeHost(site.hostname)
}

// ─── 探测 ───────────────────────────────────────────────────────────────────

interface ProbeOpts {
  siteUrl: string
  fetcher: typeof fetch
  maxRedirects?: number
  timeoutMs?: number
}

function baseFact(target: LandingTarget): LandingProbeFact {
  return {
    label: target.label,
    url: target.url,
    http_status: null,
    final_url: null,
    redirects: 0,
    utm_preserved: null,
    pixel_ids: [],
    error: null,
  }
}

async function fetchOnce(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': USER_AGENT,
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399
}

function resolveLocation(location: string, current: string): string | null {
  try {
    return new URL(location, current).toString()
  } catch {
    return null
  }
}

/**
 * 读页面正文也要有时限：超时计时器在拿到响应头之后就清掉了，
 * 如果对方把正文卡住不发，没有这一道就会一直挂在这一步。
 */
async function readPixelIds(res: Response, timeoutMs: number): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('读取页面正文超时')), timeoutMs)
  })
  try {
    const text = await Promise.race([res.text(), timeout])
    return extractPixelIds(text.slice(0, MAX_BODY_CHARS))
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function probeLanding(target: LandingTarget, opts: ProbeOpts): Promise<LandingProbeFact> {
  const base = baseFact(target)
  if (!isProbeUrlAllowed(target.url, opts.siteUrl)) {
    return { ...base, error: '落地页地址不在官网主机上，已跳过' }
  }

  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  let current = target.url
  let redirects = 0

  for (;;) {
    let res: Response
    try {
      res = await fetchOnce(opts.fetcher, current, timeoutMs)
    } catch (err) {
      return { ...base, redirects, error: sanitizeError(err) }
    }

    if (isRedirect(res.status)) {
      const location = res.headers.get('location')
      if (location === null || location === '') {
        return { ...base, http_status: res.status, final_url: current, redirects, error: '跳转没有给出目标地址' }
      }
      const next = resolveLocation(location, current)
      if (next === null) {
        return { ...base, http_status: res.status, final_url: current, redirects, error: '跳转地址无法解析' }
      }
      if (!isProbeUrlAllowed(next, opts.siteUrl)) {
        return { ...base, http_status: res.status, final_url: current, redirects, error: '跳转到了站外主机，已停止' }
      }
      if (redirects >= maxRedirects) {
        return { ...base, http_status: res.status, final_url: current, redirects, error: `跳转超过 ${maxRedirects} 次，已停止` }
      }
      redirects += 1
      current = next
      continue
    }

    let pixelIds: string[] = []
    if (res.status === 200) {
      try {
        pixelIds = await readPixelIds(res, timeoutMs)
      } catch (err) {
        // 页面没读完 = 这个页面没法评估（不是「没有像素」），按没连上处理
        return { ...base, redirects, error: sanitizeError(err) }
      }
    }
    return {
      ...base,
      http_status: res.status,
      final_url: current,
      redirects,
      utm_preserved: utmPreserved(target.url, current),
      pixel_ids: pixelIds,
      error: null,
    }
  }
}
