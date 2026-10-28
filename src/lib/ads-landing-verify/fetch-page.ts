/**
 * Read-only GET of one landing page on the client's own site.
 * Redirects that leave the site are not followed. Nothing is posted.
 */

import {
  isProbeUrlAllowed,
  MAX_REDIRECTS,
  PROBE_TIMEOUT_MS,
} from '@/lib/ads-tracking-preflight/landing-probe'
import { retryOnce, type Sleep } from '@/lib/ads-tracking-preflight/retry'

const BODY_CAP = 200_000
const USER_AGENT = 'MagicEngine-LandingVerify/1.0'
const TRANSIENT = new Set([429, 502, 503, 504])

export interface PageRead {
  readonly status: number | null
  readonly finalUrl: string | null
  readonly html: string | null
  readonly error: string | null
}

type PageFetcher = (url: string, init?: RequestInit) => Promise<Response>

export interface ReadPageOpts {
  readonly siteUrl: string
  readonly fetcher?: PageFetcher
  readonly timeoutMs?: number
  readonly sleep?: Sleep
}

function blocked(error: string): PageRead {
  return { status: null, finalUrl: null, html: null, error }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399
}

async function fetchOnce(fetcher: PageFetcher, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': USER_AGENT },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function readCapped(res: Response, timeoutMs: number): Promise<string> {
  const body = res.body
  if (!body || typeof body.getReader !== 'function') return (await res.text()).slice(0, BODY_CAP)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const started = Date.now()
  for (;;) {
    if (Date.now() - started > timeoutMs) {
      await reader.cancel().catch(() => undefined)
      throw new Error('读取页面正文超时')
    }
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    const room = BODY_CAP - text.length
    text += decoder.decode(value.subarray(0, Math.max(0, room)), { stream: true })
    if (room <= value.byteLength) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  return text
}

function transient(res: Response): boolean {
  if (!TRANSIENT.has(res.status)) return false
  void res.body?.cancel().catch(() => undefined)
  return true
}

function nextUrl(res: Response, current: string, siteUrl: string, redirects: number): string | PageRead {
  const location = res.headers.get('location')
  if (!location) return blocked('跳转没有给出目标地址')
  let next: string
  try {
    next = new URL(location, current).toString()
  } catch {
    return blocked('跳转地址无法解析')
  }
  if (!isProbeUrlAllowed(next, siteUrl)) return blocked('跳转到了别的网站，已经停下')
  if (redirects >= MAX_REDIRECTS) return blocked(`跳转超过 ${MAX_REDIRECTS} 次，已经停下`)
  return next
}

async function oneHop(
  fetcher: PageFetcher,
  url: string,
  timeoutMs: number,
  sleep: Sleep | undefined,
): Promise<Response> {
  return retryOnce(() => fetchOnce(fetcher, url, timeoutMs), { sleep, retryResult: transient })
}

export async function readLandingPage(url: string, opts: ReadPageOpts): Promise<PageRead> {
  if (!isProbeUrlAllowed(url, opts.siteUrl)) return blocked('地址不在这位客户的网站上')
  const fetcher = opts.fetcher ?? fetch
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS
  let current = url
  let redirects = 0
  for (;;) {
    let res: Response
    try {
      res = await oneHop(fetcher, current, timeoutMs, opts.sleep)
    } catch {
      return blocked('页面没有在时限内打开')
    }
    if (isRedirect(res.status)) {
      void res.body?.cancel().catch(() => undefined)
      const next = nextUrl(res, current, opts.siteUrl, redirects)
      if (typeof next !== 'string') return next
      redirects += 1
      current = next
      continue
    }
    if (res.status !== 200) {
      void res.body?.cancel().catch(() => undefined)
      return { status: res.status, finalUrl: current, html: null, error: null }
    }
    try {
      const html = await readCapped(res, timeoutMs)
      return { status: 200, finalUrl: current, html, error: null }
    } catch {
      return blocked('页面没有在时限内打开')
    }
  }
}
