/**
 * GET   /api/admin/prospecting/[id] — full detail for one prospect,
 *        including the heavy jsonb fields the list endpoint excludes.
 * PATCH /api/admin/prospecting/[id] — review-queue actions:
 *        { action: 'edit_email', subject, body }  outreach_ready only
 *        { action: 'send' }                       outreach_ready → contacted
 *                                                 (sends the email via Resend)
 *        { action: 'mark_contacted' }             outreach_ready → contacted
 *        { action: 'archive' }                    any active status → archived
 *        { action: 'opt_out' }                    permanent do-not-contact
 *                                                 (honours the footer promise)
 */

import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { renderFullOutreachBody, senderIdentity, type OutreachEmail } from '@/lib/prospecting/outreach'
import { isJunkContactEmail } from '@/lib/prospecting/tracking-detector'
import type { ProspectAudit } from '@/lib/prospecting/audit'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Public link host for report + unsubscribe URLs (same fallback as the queue UI). */
function publicBase(): string {
  return (process.env.NEXT_PUBLIC_REPORT_BASE_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || 'https://magicengine.cloud').replace(/\/$/, '')
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({ prospect: data })
}

type PatchBody =
  | { action: 'edit_email'; subject: string; body: string }
  | { action: 'send' }
  | { action: 'mark_contacted' }
  | { action: 'archive' }
  | { action: 'opt_out' }

async function handleEditEmail(id: string, body: { subject?: unknown; body?: unknown }): Promise<NextResponse> {
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 120) : ''
  const text    = typeof body.body === 'string' ? body.body.trim() : ''
  if (!subject || text.length < 40) {
    return NextResponse.json({ error: '主题不能为空，正文至少 40 字符' }, { status: 400 })
  }

  // Read draft + version stamp; merge so angle/generated_at survive the edit.
  const { data: row, error: readError } = await supabaseAdmin
    .from('outbound_prospects')
    .select('outreach_email, updated_at')
    .eq('id', id)
    .eq('status', 'outreach_ready')
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!row?.outreach_email) return NextResponse.json({ error: '草稿已不在待审状态（可能刚被处理）' }, { status: 409 })

  const updated: OutreachEmail = { ...(row.outreach_email as OutreachEmail), subject, body: text, edited: true }
  // Optimistic lock on updated_at: zero rows means the draft moved on (marked
  // contacted / edited elsewhere) between read and write — the caller must
  // know, or the edit silently vanishes.
  const { data: written, error } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ outreach_email: updated, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'outreach_ready')
    .eq('updated_at', row.updated_at)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!written || written.length === 0) {
    return NextResponse.json({ error: '保存冲突：草稿刚被其他操作修改，请刷新后重试' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, outreach_email: updated })
}

/**
 * Send the approved outreach email via Resend, then move the prospect to
 * `contacted`. Human-approved: a person clicks send in the review queue for
 * each prospect (sending is never automated).
 *
 * Order guards against a double-send far more than a lost send: we CLAIM the
 * row (outreach_ready → contacted) before calling Resend, so a second click
 * matches zero rows and 409s. If Resend then fails we revert the claim so the
 * card returns to the queue for a retry.
 */
async function handleSend(id: string): Promise<NextResponse> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return NextResponse.json({ error: '发信未配置（RESEND_API_KEY 缺失）' }, { status: 503 })

  const { data: row, error: readError } = await supabaseAdmin
    .from('outbound_prospects')
    .select('business_name, status, audit, outreach_email')
    .eq('id', id)
    .maybeSingle<{ business_name: string; status: string; audit: ProspectAudit | null; outreach_email: OutreachEmail | null }>()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (row.status !== 'outreach_ready') return NextResponse.json({ error: '不在待审状态（可能已发送）' }, { status: 409 })

  const to = row.audit?.tracking?.emails?.[0]?.trim()
  if (!to) return NextResponse.json({ error: '该商家没有邮箱，只能电话跟进' }, { status: 400 })
  // Refuse placeholder / marketing-service addresses scraped before the junk
  // filter widened — sending there wastes a send and dents domain reputation.
  if (isJunkContactEmail(to)) {
    return NextResponse.json({ error: '占位/服务邮箱，跳过（需人工核实真实邮箱）' }, { status: 422 })
  }
  const subject = row.outreach_email?.subject?.trim()
  const draftBody = row.outreach_email?.body?.trim()
  if (!subject || !draftBody) return NextResponse.json({ error: '邮件草稿缺失' }, { status: 409 })

  const fullBody = renderFullOutreachBody({
    draftBody,
    businessName: row.business_name,
    reportUrl: `${publicBase()}/report/${id}`,
    unsubscribeUrl: `${publicBase()}/unsubscribe/${id}`,
  })

  // Claim before sending so a double-click can't double-send.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ status: 'contacted', contacted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'outreach_ready')
    .select('id')
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: '不在待审状态（可能刚被其他操作处理）' }, { status: 409 })
  }

  const fromEmail = process.env.OUTREACH_FROM_EMAIL ?? 'hello@magicengine.cloud'
  const from = `${senderIdentity().name} <${fromEmail}>`
  try {
    const resend = new Resend(apiKey)
    // Idempotency key (stable per prospect): if a send actually goes out but the
    // response is lost and we revert + retry, Resend dedupes on this key and
    // returns the original result instead of sending a SECOND real email —
    // closing the "ambiguous failure → double-send" hole (魏征 C1).
    const { error: sendErr } = await resend.emails.send(
      { from, to, replyTo: fromEmail, subject, text: fullBody },
      { idempotencyKey: `outreach/${id}` },
    )
    if (sendErr) throw new Error(typeof sendErr === 'string' ? sendErr : JSON.stringify(sendErr))
  } catch (err) {
    // Send failed — release the claim so the card returns to the queue.
    await supabaseAdmin
      .from('outbound_prospects')
      .update({ status: 'outreach_ready', contacted_at: null })
      .eq('id', id)
      .eq('status', 'contacted')
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `发送失败：${message}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}

async function transition(
  id: string,
  fromStatuses: string[],
  patch: Record<string, string>,
  conflictMessage: string,
): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', fromStatuses)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: conflictMessage }, { status: 409 })
  return NextResponse.json({ ok: true })
}

const ACTIVE_STATUSES = ['discovered', 'audited', 'qualified', 'analyzed', 'outreach_ready']

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => null) as PatchBody | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  switch (body.action) {
    case 'edit_email':
      return handleEditEmail(params.id, body)
    case 'send':
      return handleSend(params.id)
    case 'mark_contacted':
      return transition(params.id, ['outreach_ready'],
        { status: 'contacted', contacted_at: new Date().toISOString() }, '不在待审状态')
    case 'archive':
      return transition(params.id, ACTIVE_STATUSES, { status: 'archived' }, '当前状态不可归档')
    case 'opt_out':
      // Footer promise: "you won't hear from us again". Terminal from any
      // pre-conversion state — including contacted/replied, where the
      // unsubscribe reply actually arrives.
      return transition(params.id, [...ACTIVE_STATUSES, 'contacted', 'replied'],
        { status: 'opted_out' }, '当前状态不可标记拒收')
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
