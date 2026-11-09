// POST /api/public/site-check/report — email the full free website check to the visitor.
// Design: docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md §6 C.
// Our sender must not become a mailer: consent, one email per lead (atomic claim, released on failure),
// per-visitor / per-mailbox / whole-site daily caps, and every value from the site or the model escaped and defanged.

import { NextRequest, NextResponse } from 'next/server'
import { LIMITS, dayStartUtc, isAllowedOrigin, pruneOldVisitorKeys } from '@/lib/tools-lab/site-check/guards'
import { recipientKey, visitorKey } from '@/lib/tools-lab/visitor'
import { consumeSteps, fail, json, preflight, readSmallJson } from '@/lib/tools-lab/site-check/http'
import { claimLead, getLead, releaseLead, type LeadRow, type StoredFindings } from '@/lib/tools-lab/site-check/leads'
import { buildEmail, sendReportEmail } from '@/lib/tools-lab/site-check/report-email'
import { recordToolLead } from '@/lib/tools-lab/lead-events'
import { inngest } from '@/lib/inngest/client'
import { TOOLS_LAB_REPORT_EMAIL_ATTEMPTED_EVENT } from '@/lib/inngest/functions/tools-lab-lead-followup'

/** Best-effort audit receipt for a send attempt (success or failure) — never blocks the response. */
function receiptReportEmailAttempt(leadId: string, delivered: boolean, failureCode: string | null): void {
  void inngest
    .send({ name: TOOLS_LAB_REPORT_EMAIL_ATTEMPTED_EVENT, data: { leadId, delivered, failureCode, attempted_at: new Date().toISOString() } })
    .catch((err) => console.warn('[site-check] report_email.attempted emit failed', err instanceof Error ? err.message : String(err)))
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(req: NextRequest): NextResponse {
  return preflight(req)
}

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

type Checked = { lead: LeadRow; findings: StoredFindings; email: string; visitor: string; recipient: string } | NextResponse

async function checkRequest(req: NextRequest, origin: string | null): Promise<Checked> {
  const body = await readSmallJson(req)
  if (!body) return fail(400, 'bad_request', origin)
  const { leadId, email, consent } = body
  if (!isValidEmail(email)) return fail(400, 'invalid_email', origin)
  if (consent !== true) return fail(400, 'consent_required', origin)
  if (typeof leadId !== 'string' || !/^[0-9a-f-]{36}$/i.test(leadId)) return fail(400, 'report_not_ready', origin)
  const lead = await getLead(leadId)
  const findings = lead?.findings
  if (!lead || !findings || !Array.isArray(findings.findings) || findings.findings.length === 0) {
    return fail(400, 'report_not_ready', origin)
  }
  if (lead.status !== 'scouted') return fail(409, 'already_sent', origin)
  const visitor = visitorKey(req.headers, 'site-check')
  if (!visitor) return fail(400, 'no_visitor', origin)
  const recipient = recipientKey(email, 'site-check')
  if (!recipient) return fail(503, 'unavailable', origin)
  return { lead, findings, email: email.trim().toLowerCase(), visitor, recipient }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin')
  if (!isAllowedOrigin(origin)) return fail(403, 'forbidden', origin)
  try {
    const checked = await checkRequest(req, origin)
    if (checked instanceof NextResponse) return checked
    const { lead, findings, email, visitor, recipient } = checked

    const capped = await consumeSteps(
      [
        { bucket: 'site_report_ip', key: visitor, windowStart: dayStartUtc(), cap: LIMITS.reportPerVisitorPerDay, code: 'daily_limit' },
        { bucket: 'site_report_to', key: recipient, windowStart: dayStartUtc(), cap: LIMITS.reportPerRecipientPerDay, code: 'recipient_limit' },
        { bucket: 'site_report_day', key: 'all', windowStart: dayStartUtc(), cap: LIMITS.reportPerDay, code: 'site_busy' },
      ],
      origin,
    )
    if (capped) return capped
    void pruneOldVisitorKeys().catch(() => undefined)

    const claim = await claimLead(lead.id, email)
    if (claim === 'error') return fail(503, 'unavailable', origin)
    if (claim === 'taken') return fail(409, 'already_sent', origin)

    const { subject, body: html } = buildEmail({ url: lead.url, findings })
    try {
      // Keyed by lead and mailbox: a retry to the same address is de-duplicated by the provider,
      // while a corrected address after a failure is a different message.
      await sendReportEmail({ to: email, subject, html, idempotencyKey: `${lead.id}-${recipient.slice(0, 16)}` })
    } catch (err) {
      console.error('site-check report email failed:', err instanceof Error ? err.message : String(err))
      await releaseLead(lead.id)
      receiptReportEmailAttempt(lead.id, false, 'send_failed')
      return fail(502, 'send_failed', origin)
    }
    receiptReportEmailAttempt(lead.id, true, null)
    // A delivered report is the one genuine "this visitor wants to talk to us" signal in this flow —
    // record it as a Tools Lab lead so a human actually sees it (docs/registry/platform-candidates.md
    // shared-plumbing pass, criterion ②). Best effort: never blocks the response the visitor already got.
    void recordToolLead({
      tool: 'site-check',
      pagePath: '/cn/discover',
      targetHref: lead.url,
      dedupeKey: { lead_id: lead.id },
      extraMetadata: { url: lead.url, market: lead.market },
      email,
    }).catch(() => undefined)
    return json(200, { ok: true }, origin)
  } catch (err) {
    console.error('site-check report fatal error:', err instanceof Error ? err.message : String(err))
    return fail(500, 'send_failed', origin)
  }
}
