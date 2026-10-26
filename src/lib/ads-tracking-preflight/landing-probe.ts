/**
 * 落地页探测：只探官网自己的主机，手动跟跳转，读出状态码 / 最终地址 / UTM 是否保留 / 页面里的像素编号。
 * 平台通用：不写任何客户名 / 域名 / 编号。
 */

import type { LandingProbeFact, LandingTarget } from './types'
import { sanitizeError } from './sanitize'
import { retryOnce, type Sleep } from './retry'

export const MAX_REDIRECTS = 5
export const MAX_BODY_BYTES = 2_000_000
export const PROBE_TIMEOUT_MS = 15_000

const PLACEHOLDER_BASE = 'https://placeholder.invalid'
const USER_AGENT = 'MagicEngine-TrackingPreflight/1.0'

// ─── 像素编号 ───────────────────────────────────────────────────────────────

/**
 * facebook.com/tr?...id=<digits>：允许 id= 前面还有别的查询参数。
 * 不用一条大正则扫全页：恶意页面里堆很多「facebook.com/tr?」再接一大片没有引号的字符时，
 * 那种写法对每个起点都扫到页尾，二次方级别。这里每个起点只看一小段（见 scanTrIds）。
 */
const TR_MARKER = 'facebook.com/tr?'
const MAX_TR_QUERY_CHARS = 600
const TR_ID_IN_QUERY_RE = /\bid=(\d{10,20})/

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

/** 查询串在引号 / 尖括号处结束；没有结束符时最多看 MAX_TR_QUERY_CHARS 个字符。 */
function scanTrIds(html: string, out: PixelHit[]): void {
  let from = 0
  for (;;) {
    const at = html.indexOf(TR_MARKER, from)
    if (at === -1) return
    const start = at + TR_MARKER.length
    const limit = Math.min(html.length, start + MAX_TR_QUERY_CHARS)
    let end = start
    while (end < limit) {
      const code = html.charCodeAt(end)
      if (code === 0x22 || code === 0x27 || code === 0x3c || code === 0x3e) break
      end += 1
    }
    const match = TR_ID_IN_QUERY_RE.exec(html.slice(start, end))
    if (match !== null) out.push({ index: at, id: match[1] })
    from = at + 1
  }
}

export function extractPixelIds(html: string): string[] {
  const hits: PixelHit[] = []
  scanTrIds(html, hits)
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
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
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

/** 瞬时故障的状态码：值得再试一次。404、跳转、200 都不算。 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504])

function isTransientStatus(res: Response): boolean {
  if (!TRANSIENT_STATUSES.has(res.status)) return false
  // 这一份响应不要了：把没读的正文丢掉，免得占着连接
  void res.body?.cancel().catch(() => undefined)
  return true
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
 * 正文也有上限：对方一直发数据时，读到上限就停手并取消，不能把内存读爆。
 */
async function readPixelIds(res: Response, timeoutMs: number): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('读取页面正文超时')), timeoutMs)
  })

  // 手写的假响应（只有 text()）没有 body 属性，运行时是 undefined，所以不能只判 null
  const body = res.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const readAll = async (): Promise<string> => {
      const decoder = new TextDecoder('utf-8')
      let text = ''
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value === undefined) continue
        const room = MAX_BODY_BYTES - total
        if (value.byteLength >= room) {
          text += decoder.decode(value.subarray(0, room), { stream: true })
          total += room
          await reader.cancel().catch(() => undefined)
          break
        }
        text += decoder.decode(value, { stream: true })
        total += value.byteLength
      }
      text += decoder.decode()
      return text
    }
    try {
      const text = await Promise.race([readAll(), timeout])
      return extractPixelIds(text)
    } catch (err) {
      await reader.cancel().catch(() => undefined)
      throw err
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  try {
    const text = await Promise.race([res.text(), timeout])
    return extractPixelIds(text.slice(0, MAX_BODY_BYTES))
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
      res = await retryOnce(() => fetchOnce(opts.fetcher, current, timeoutMs), {
        sleep: opts.sleep,
        retryResult: isTransientStatus,
      })
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
