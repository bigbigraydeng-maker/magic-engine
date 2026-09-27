// POST /api/public/site-check — the free website check behind magicengine.com.au/discover and /cn/discover.
// Design: docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md (§6, §7).
// Order: origin → body → trusted visitor → request cap → 24h reuse (capped) → read homepage (no charge if
// unreadable) → paid caps → model (never canned findings) → store lead with a cost receipt.

import { NextRequest, NextResponse } from 'next/server'
import { LIMITS, dayStartUtc, isAllowedOrigin, monthStartUtc, pruneOldVisitorKeys, siteHost, vetUrl } from '@/lib/tools-lab/site-check/guards'
import { visitorDiagnostic, visitorKey } from '@/lib/tools-lab/site-check/visitor'
import { fetchRealHomepage } from '@/lib/tools-lab/site-check/homepage'
import { consumeSteps, fail, json, preflight, readSmallJson } from '@/lib/tools-lab/site-check/http'
import {
  buildPrompt,
  cleanAnswers,
  detectMarket,
  pickContext,
  runCheck,
  type CheckContext,
  type CheckLang,
  type CheckSource,
  type NoWebsiteAnswers,
} from '@/lib/tools-lab/site-check/diagnose'
import { recentResult, storeLead, type StoredFindings } from '@/lib/tools-lab/site-check/leads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The browser gives up at 90 s; a second model attempt only starts before this point in the request. */
const RETRY_CUTOFF_MS = 25_000

export function OPTIONS(req: NextRequest): NextResponse {
  return preflight(req)
}

interface ParsedInput {
  lang: CheckLang
  url: URL | null
  answers: NoWebsiteAnswers | null
  attribution: unknown
}

/** The visitor's input, or the error code that tells them what to change. */
function parseInput(body: Record<string, unknown>): ParsedInput | { code: 'invalid_url' | 'answers_too_short' } {
  const lang: CheckLang = body.lang === 'zh' ? 'zh' : 'en'
  if (body.url) {
    const url = vetUrl(body.url)
    return url ? { lang, url, answers: null, attribution: body.attribution } : { code: 'invalid_url' }
  }
  const answers = cleanAnswers(body.noWebsite)
  return answers ? { lang, url: null, answers, attribution: body.attribution } : { code: 'answers_too_short' }
}

function publicResult(leadId: string | null, market: string, findings: StoredFindings, reused: boolean): Record<string, unknown> {
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

interface CheckPlan extends ParsedInput {
  key: string
  market: string
  ctx: CheckContext
  siteKey: string | null
  origin: string | null
  startedAt: number
}

/** Same site in the last 24 h: a new lead row with a copy of the original result, within a site-wide cap. */
async function tryReuse(plan: CheckPlan): Promise<NextResponse | null> {
  if (!plan.siteKey || !plan.url) return null
  const recent = await recentResult(plan.siteKey)
  if (!recent) return null
  const capped = await consumeSteps(
    [{ bucket: 'site_check_reuse_day', key: 'all', windowStart: dayStartUtc(), cap: LIMITS.reusePerDay, code: 'site_busy' }],
    plan.origin,
  )
  if (capped) return capped
  // The copy carries no cost receipt: no model was called for it.
  const meta = { tool: 'site-check', site_key: plan.siteKey, lang: plan.lang, context: plan.ctx }
  const copy: StoredFindings = { ...recent.findings, reused: true, meta }
  const leadId = await storeLead({ url: `${plan.url.origin}/`, market: plan.market, findings: copy, answers: null, attribution: plan.attribution })
  return json(200, publicResult(leadId, plan.market, copy, true), plan.origin)
}

async function gatherEvidence(plan: CheckPlan): Promise<{ text: string; source: CheckSource } | NextResponse> {
  if (plan.url) {
    const page = await fetchRealHomepage(plan.url.toString())
    if (!page.ok) return fail(422, page.reason === 'blocked_address' ? 'invalid_url' : page.reason, plan.origin)
    return { text: page.text, source: 'homepage' }
  }
  const a = plan.answers as NoWebsiteAnswers
  return { text: [`Business: ${a.what}`, `Where: ${a.where}`, `Customers: ${a.who}`].join('\n'), source: 'answers' }
}

function paidCaps(key: string): Parameters<typeof consumeSteps>[0] {
  return [
    { bucket: 'site_check_ip', key, windowStart: dayStartUtc(), cap: LIMITS.checkPerVisitorPerDay, code: 'daily_limit' },
    { bucket: 'site_check_day', key: 'all', windowStart: dayStartUtc(), cap: LIMITS.checkPerDay, code: 'site_busy' },
    { bucket: 'site_check_month', key: 'all', windowStart: monthStartUtc(), cap: LIMITS.checkPerMonth, code: 'monthly_limit' },
  ]
}

async function diagnose(plan: CheckPlan): Promise<NextResponse> {
  const evidence = await gatherEvidence(plan)
  if (evidence instanceof NextResponse) return evidence
  const capped = await consumeSteps(paidCaps(plan.key), plan.origin)
  if (capped) return capped
  void pruneOldVisitorKeys().catch(() => undefined)

  const hostname = plan.url ? plan.url.hostname : ''
  const prompt = buildPrompt({ lang: plan.lang, context: plan.ctx, market: plan.market as 'AU' | 'NZ', text: evidence.text, hostname, source: evidence.source })
  const run = await runCheck(prompt, plan.startedAt + RETRY_CUTOFF_MS)
  console.info('[site-check] model receipt', { attempts: run.attempts, cost_usd: run.costUsd, ok: !!run.result })
  if (!run.result) return fail(502, 'analysis_failed', plan.origin)

  const findings: StoredFindings = {
    ...run.result,
    lang: plan.lang,
    context: plan.ctx,
    source: evidence.source,
    reused: false,
    meta: { tool: 'site-check', site_key: plan.siteKey, lang: plan.lang, context: plan.ctx, model: run.model, attempts: run.attempts, cost_usd: run.costUsd },
  }
  const leadId = await storeLead({ url: plan.url ? `${plan.url.origin}/` : '', market: plan.market, findings, answers: plan.answers, attribution: plan.attribution })
  return json(200, publicResult(leadId, plan.market, findings, false), plan.origin)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now()
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) return fail(403, 'forbidden', origin)
  try {
    const body = await readSmallJson(req)
    if (!body) return fail(400, 'bad_request', origin)
    const parsed = parseInput(body)
    if ('code' in parsed) return fail(400, parsed.code, origin)

    const key = visitorKey(req.headers)
    console.info('[site-check] visitor', visitorDiagnostic(req.headers))
    if (!key) return fail(400, 'no_visitor', origin)
    const tooMany = await consumeSteps(
      [{ bucket: 'site_check_any', key, windowStart: dayStartUtc(), cap: LIMITS.requestsPerVisitorPerDay, code: 'too_many_requests' }],
      origin,
    )
    if (tooMany) return tooMany

    const hostname = parsed.url ? parsed.url.hostname : ''
    const ctx = pickContext(parsed.lang, hostname)
    const siteKey = parsed.url ? `${siteHost(hostname)}|${parsed.lang}|${ctx}` : null
    const plan: CheckPlan = { ...parsed, key, market: detectMarket(hostname), ctx, siteKey, origin, startedAt }
    return (await tryReuse(plan)) ?? (await diagnose(plan))
  } catch (err) {
    console.error('site-check fatal error:', err instanceof Error ? err.message : String(err))
    return fail(500, 'analysis_failed', origin)
  }
}
