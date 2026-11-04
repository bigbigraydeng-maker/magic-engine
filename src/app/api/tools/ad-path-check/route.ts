import { NextRequest, NextResponse } from 'next/server'
import { scanWebsite, scanErrorMessage } from '@/lib/ad-path-checker/scan'
import { normalizeScanUrl } from '@/lib/ad-path-checker/url'
import { scanBudget } from '@/lib/ad-path-checker/budget'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '30' } : {}) } })
}

function allowedOrigin(request: NextRequest): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    // Next can canonicalize 127.0.0.1 to localhost in nextUrl. Compare the
    // browser-controlled Host header, not a forwarded header or that rewrite.
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === (request.headers.get('host') ?? request.nextUrl.host)
  } catch { return false }
}

async function readBody(request: NextRequest): Promise<unknown> {
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > 8192) throw new Error('size')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let body = ''
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}) }, 3000)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (timedOut) throw new Error('timeout')
      if (done) break
      bytes += value.byteLength
      if (bytes > 8192) { await reader.cancel(); throw new Error('size') }
      body += decoder.decode(value, { stream: true })
    }
    return JSON.parse(body + decoder.decode()) as unknown
  } finally { clearTimeout(timer); reader.releaseLock() }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.AD_PATH_CHECKER_ENABLED !== 'true') return reply({ error: '体检服务暂未开放，请先查看示例。' }, 503)
  if (!allowedOrigin(request)) return reply({ error: '请从体检页面开始。' }, 403)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply({ error: '请从体检页面提交网址。' }, 415)
  let input: unknown
  try { input = await readBody(request) } catch { return reply({ error: '提交内容不完整或过长，请重新填写网址。' }, 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({ error: '请填写网站地址。' }, 400)
  const body = input as Record<string, unknown>
  if (typeof body.url !== 'string' || (body.adUrl !== undefined && typeof body.adUrl !== 'string')) return reply({ error: '请填写网站地址。' }, 400)
  let release: (() => void) | null = null
  try {
    const url = normalizeScanUrl(body.url)
    if (body.adUrl) normalizeScanUrl(body.adUrl as string, true)
    release = scanBudget.acquire(url.hostname)
    if (!release) return reply({ error: '正在处理其他体检，或这个网站刚检查过。请半分钟后再试。' }, 429)
    const report = await scanWebsite(url.href, body.adUrl as string | undefined)
    return reply({ report })
  } catch (error: unknown) {
    const failure = scanErrorMessage(error)
    return reply({ error: failure.message }, failure.status)
  } finally { release?.() }
}
