/**
 * POST /api/report/[id]/interest
 *
 * Public (no auth): the lead-capture form on a prospect's own report page
 * (Phase 35). When the business owner submits interest we:
 *   1. store their response on the prospect row (ai_report.lead_response —
 *      existing jsonb, no migration), and
 *   2. move the prospect to `replied` so it surfaces in the CRM "replied"
 *      column, and
 *   3. best-effort email a notification so a human follows up fast.
 *
 * The DB write is the source of truth — if email isn't configured the lead is
 * still captured and visible in the CRM, never lost.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import type { ProspectAnalysis } from '@/lib/prospecting/analyze'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Statuses from which a form submission means "they replied to us". Terminal /
// post-reply states (replied already, converted, opted_out, archived) keep
// their status but still record the response.
const ACTIVE = ['discovered', 'audited', 'qualified', 'analyzed', 'outreach_ready', 'contacted']

interface LeadResponse {
  name: string
  email: string
  phone: string | null
  message: string | null
  submitted_at: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const name    = typeof body?.name === 'string' ? body.name.trim() : ''
  const email   = typeof body?.email === 'string' ? body.email.trim() : ''
  const phone   = typeof body?.phone === 'string' ? body.phone.trim() : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!name || !email) {
    return NextResponse.json({ error: 'Your name and email are required.' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'That email doesn’t look right — please check it.' }, { status: 400 })
  }
  if (name.length > 120 || email.length > 160 || phone.length > 40 || message.length > 2000) {
    return NextResponse.json({ error: 'One of those fields is too long.' }, { status: 400 })
  }

  const { data: prospect, error: readErr } = await supabaseAdmin
    .from('outbound_prospects')
    .select('business_name, status, ai_report')
    .eq('id', params.id)
    .maybeSingle<{ business_name: string; status: string; ai_report: ProspectAnalysis | null }>()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const lead_response: LeadResponse = {
    name, email,
    phone:   phone || null,
    message: message || null,
    submitted_at: new Date().toISOString(),
  }
  // Merge into the existing analysis jsonb (extra key is ignored by the report
  // renderer). Flip to `replied` only from a still-active status.
  const mergedReport = { ...(prospect.ai_report ?? {}), lead_response }
  const nextStatus = ACTIVE.includes(prospect.status) ? 'replied' : prospect.status

  const { error: writeErr } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ ai_report: mergedReport, status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', params.id)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  // Best-effort notification — never blocks the captured lead.
  await notify(prospect.business_name, lead_response).catch(err =>
    console.error('[report/interest] notify failed:', err instanceof Error ? err.message : err),
  )

  return NextResponse.json({ ok: true })
}

async function notify(businessName: string, lead: LeadResponse): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return
  const to = process.env.OUTREACH_REPLY_EMAIL ?? 'hello@magicengine.cloud'
  const resend = new Resend(apiKey)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  await resend.emails.send({
    from: 'Magic Engine Leads <onboarding@resend.dev>',
    to: [to],
    replyTo: lead.email,
    subject: `🔥 Report reply from ${businessName}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 16px;font-size:18px;color:#0f172a">${esc(businessName)} filled in their report form</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;width:90px;color:#475569">Name</td><td style="padding:8px 12px;border-left:3px solid #e2e8f0">${esc(lead.name)}</td></tr>
        <tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Email</td><td style="padding:8px 12px;border-left:3px solid #e2e8f0">${esc(lead.email)}</td></tr>
        ${lead.phone ? `<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#475569">Phone</td><td style="padding:8px 12px;border-left:3px solid #e2e8f0">${esc(lead.phone)}</td></tr>` : ''}
        ${lead.message ? `<tr><td style="padding:8px 12px;background:#f8fafc;font-weight:600;vertical-align:top;color:#475569">Message</td><td style="padding:8px 12px;border-left:3px solid #e2e8f0;white-space:pre-wrap">${esc(lead.message)}</td></tr>` : ''}
      </table>
      <p style="margin-top:16px;font-size:12px;color:#94a3b8">They're now in the CRM "replied" column. Reply to this email to reach them directly.</p>
    </div>`,
  })
}
