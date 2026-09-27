// Next.js route handler: POST /api/public/site-check/report
// Port of website/functions/api/report.js (onRequestPost) using the app modules in
// src/lib/tools-lab/site-check/{guards,leads,report-email}.ts. Same order of steps, same error codes.

import { NextRequest, NextResponse } from 'next/server'
import {
  LIMITS,
  QuotaUnavailable,
  consumeQuota,
  dayStartUtc,
  isAllowedOrigin,
  recipientKey,
  visitorKey,
} from '@/lib/tools-lab/site-check/guards'
import { claimLead, getLead, releaseLead } from '@/lib/tools-lab/site-check/leads'
import { buildEmail, sendReportEmail } from '@/lib/tools-lab/site-check/report-email'

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

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

interface BodyShape {
  leadId?: unknown
  email?: unknown
  consent?: unknown
}

async function consumeOrFail(
  bucketType: string,
  bucketKey: string,
  windowStart: string,
  cap: number,
  origin: string | null,
): Promise<NextResponse | null> {
  try {
    const allowed = await consumeQuota(bucketType, bucketKey, windowStart, cap)
    if (!allowed) return fail(429, 'daily_limit', origin)
    return null
  } catch (err) {
    if (err instanceof QuotaUnavailable) return fail(503, 'unavailable', origin)
    throw err
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) return fail(403, 'forbidden', origin)
  try {
    const body = (await req.json().catch(() => null)) as BodyShape | null
    if (!body || typeof body !== 'object') return fail(400, 'bad_request', origin)
    const { leadId, email, consent } = body
    if (!isValidEmail(email)) return fail(400, 'invalid_email', origin)
    if (consent !== true) return fail(400, 'consent_required', origin)
    if (typeof leadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(leadId)) return fail(400, 'report_not_ready', origin)

    const lead = await getLead(leadId)
    if (!lead || !Array.isArray(lead.findings?.findings) || lead.findings.findings.length === 0) {
      return fail(400, 'report_not_ready', origin)
    }
    if (lead.status !== 'scouted') return fail(409, 'already_sent', origin)

    const key = visitorKey(req.headers)
    if (!key) return fail(400, 'no_visitor', origin)

    const ipFail = await consumeOrFail('site_report_ip', key, dayStartUtc(), LIMITS.reportPerVisitorPerDay, origin)
    if (ipFail) return ipFail
    const toFail = await consumeOrFail('site_report_to', recipientKey(email), dayStartUtc(), LIMITS.reportPerRecipientPerDay, origin)
    if (toFail) return toFail
    const dayFail = await consumeOrFail('site_report_day', 'all', dayStartUtc(), LIMITS.reportPerDay, origin)
    if (dayFail) return dayFail

    const cleanEmail = email.trim().toLowerCase()
    if (!(await claimLead(lead.id, cleanEmail))) return fail(409, 'already_sent', origin)

    const { subject, body: html } = buildEmail({ url: lead.url, findings: lead.findings })
    try {
      await sendReportEmail({ to: cleanEmail, subject, html, idempotencyKey: lead.id })
    } catch (err) {
      console.error('site-check report email failed:', err instanceof Error ? err.message : String(err))
      await releaseLead(lead.id)
      return fail(502, 'send_failed', origin)
    }
    return json(200, { ok: true }, origin)
  } catch (err) {
    console.error('site-check report fatal error:', err instanceof Error ? err.message : String(err))
    return fail(500, 'send_failed', origin)
  }
}
