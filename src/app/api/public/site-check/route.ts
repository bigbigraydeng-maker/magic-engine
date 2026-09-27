// Next.js route handler: POST /api/public/site-check
// Port of website/functions/api/scout.js (onRequestPost) using the app modules in
// src/lib/tools-lab/site-check/{guards,diagnose,leads}.ts. Same order of steps, same error codes.

import { NextRequest, NextResponse } from 'next/server'
import {
  LIMITS,
  QuotaUnavailable,
  consumeQuota,
  dayStartUtc,
  fetchRealHomepage,
  isAllowedOrigin,
  monthStartUtc,
  pruneOldVisitorKeys,
  siteHost,
  vetUrl,
  visitorAddress,
  visitorKey,
} from '@/lib/tools-lab/site-check/guards'
import {
  buildPrompt,
  cleanAnswers,
  detectMarket,
  pickContext,
  runCheck,
  type CheckContext,
  type CheckLang,
  type CheckSource,
} from '@/lib/tools-lab/site-check/diagnose'
import { recentResult, storeLead, type StoredFindings } from '@/lib/tools-lab/site-check/leads'

export const dynamic = 'force-dynamic'

function corsHeaders(origin: string | null): Record<string, string> {
  if (isAllowedOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin as string,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    }
  }
  return { Vary: 'Origin' }
}

function json(status: number, payload: unknown, origin: string | null): NextResponse {
  return NextResponse.json(payload, { status, headers: corsHeaders(origin) })
}

function fail(status: number, code: string, origin: string | null): NextResponse {
  return json(status, { error: code, code }, origin)
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

interface PublicResultInput {
  leadId: string | null
  market: string
  findings: StoredFindings
  reused: boolean
}

function publicResult({ leadId, market, findings, reused }: PublicResultInput): Record<string, unknown> {
  return {
    leadId,
    market,
    context: findings.context,
    lang: findings.lang,
    source: findings.source,
    reused,
    teaser: findings.findings.slice(0, 3),
    totalCount: findings.findings.length,
    summary: findings.summary,
    topOpportunity: findings.top_opportunity,
  }
}

interface BodyShape {
  url?: unknown
  noWebsite?: unknown
  lang?: unknown
  attribution?: unknown
}

interface ParsedInput {
  lang: CheckLang
  url: URL | null
  answers: { what: string; where: string; who: string } | null
  attribution: unknown
}

function parseInput(body: BodyShape): ParsedInput | null {
  const lang: CheckLang = body.lang === 'zh' ? 'zh' : 'en'
  const answers = body.url ? null : cleanAnswers(body.noWebsite)
  const url = body.url ? vetUrl(body.url) : null
  if (body.url && !url) return null
  if (!url && !answers) return null
  return { lang, url, answers, attribution: body.attribution }
}

async function consumeOrFail(
  bucketType: string,
  bucketKey: string,
  windowStart: string,
  cap: number,
  origin: string | null,
  limitCode: 'daily_limit' | 'monthly_limit' = 'daily_limit',
): Promise<NextResponse | null> {
  try {
    const allowed = await consumeQuota(bucketType, bucketKey, windowStart, cap)
    if (!allowed) return fail(429, limitCode, origin)
    return null
  } catch (err) {
    if (err instanceof QuotaUnavailable) return fail(503, 'unavailable', origin)
    throw err
  }
}

async function handleReuse(
  siteKey: string,
  url: URL,
  market: string,
  attribution: unknown,
  origin: string | null,
): Promise<NextResponse | null> {
  const recent = await recentResult(siteKey)
  if (!recent) return null
  const copy: StoredFindings = { ...recent.findings, reused: true }
  const leadId = await storeLead({
    url: `${url.origin}/`,
    market,
    findings: copy,
    answers: null,
    attribution,
  })
  return json(200, publicResult({ leadId, market, findings: copy, reused: true }), origin)
}

interface Evidence {
  text: string
  source: CheckSource
}

async function gatherEvidence(
  url: URL | null,
  answers: { what: string; where: string; who: string } | null,
  origin: string | null,
): Promise<Evidence | NextResponse> {
  if (url) {
    const page = await fetchRealHomepage(url.toString())
    if (!page.ok) {
      const code = page.reason === 'blocked_address' ? 'invalid_url' : page.reason
      return fail(422, code, origin)
    }
    return { text: page.text, source: 'homepage' }
  }
  const a = answers as { what: string; where: string; who: string }
  return {
    text: [`Business: ${a.what}`, `Where: ${a.where}`, `Customers: ${a.who}`].join('\n'),
    source: 'answers',
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) return fail(403, 'forbidden', origin)
  try {
    const body = (await req.json().catch(() => null)) as BodyShape | null
    if (!body || typeof body !== 'object') return fail(400, 'bad_request', origin)
    const parsed = parseInput(body)
    if (!parsed) return fail(400, 'bad_request', origin)
    const { lang, url, answers, attribution } = parsed

    const key = visitorKey(req.headers)
    if (!key) return fail(400, 'no_visitor', origin)
    console.info('[site-check] visitor address source', visitorAddress(req.headers)?.source)

    const anyFail = await consumeOrFail('site_check_any', key, dayStartUtc(), LIMITS.requestsPerVisitorPerDay, origin)
    if (anyFail) return anyFail

    const hostname = url ? url.hostname : ''
    const market = detectMarket(hostname)
    const ctx: CheckContext = pickContext(lang, hostname)
    const siteKey = url ? `${siteHost(hostname)}|${lang}|${ctx}` : null

    if (siteKey && url) {
      const reused = await handleReuse(siteKey, url, market, attribution, origin)
      if (reused) return reused
    }

    const evidence = await gatherEvidence(url, answers, origin)
    if (evidence instanceof NextResponse) return evidence

    const ipFail = await consumeOrFail('site_check_ip', key, dayStartUtc(), LIMITS.checkPerVisitorPerDay, origin)
    if (ipFail) return ipFail
    const dayFail = await consumeOrFail('site_check_day', 'all', dayStartUtc(), LIMITS.checkPerDay, origin, 'monthly_limit')
    if (dayFail) return dayFail
    const monthFail = await consumeOrFail('site_check_month', 'all', monthStartUtc(), LIMITS.checkPerMonth, origin, 'monthly_limit')
    if (monthFail) return monthFail

    void pruneOldVisitorKeys().catch(() => undefined)

    const prompt = buildPrompt({ lang, context: ctx, market, text: evidence.text, hostname, source: evidence.source })
    const result = await runCheck(prompt)
    if (!result) return fail(502, 'analysis_failed', origin)

    const findings: StoredFindings = {
      ...result,
      lang,
      context: ctx,
      source: evidence.source,
      reused: false,
      meta: { tool: 'site-check', site_key: siteKey, lang, context: ctx },
    }
    const leadId = await storeLead({
      url: url ? `${url.origin}/` : '',
      market,
      findings,
      answers,
      attribution,
    })
    return json(200, publicResult({ leadId, market, findings, reused: false }), origin)
  } catch (err) {
    console.error('site-check fatal error:', err instanceof Error ? err.message : String(err))
    return fail(500, 'analysis_failed', origin)
  }
}
