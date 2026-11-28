/**
 * POST /api/clients/[id]/crm/followup-letters/release — a person releases one letter from the "跟进信" page.
 *
 * Body: { contactId, subject, body, requestId, expectedRecipient, aiLetterId? }
 *   aiLetterId  the AI draft this letter came from; tied to this send before it runs, and no send if that fails.
 *
 * The list the person ticked from was a snapshot. Before anything is sent, three things are done again, now:
 *   1. the guest is judged again (`checkLetterRelease`): still in the group, still the AI's to write, nothing human
 *      has happened since the list was opened (the request id changes when it has), today's cap not reached;
 *   2. the text as it will be sent is checked again (`checkFollowUpLetter`): a letter with a failed check is refused,
 *      whatever the page showed, including after the person's own edits;
 *   3. the existing send (`sendTemplateEmail` → `sendMailNew`) runs with all its own gates and writes the receipts.
 * The signed-in person is the sender on record. Nothing here sends without a person's click.
 *
 * Not an Inngest workflow, on purpose: a person releases each letter from the page, one request per letter, and the
 * send path already writes its receipts (`crm_email_send_receipts`, `conversation_outbound_log`). If releasing is
 * ever made automatic, it must move to Inngest with receipts for the draft and the review as well.
 *
 * Responses: 200 { ok, duplicate? } / 400 / 401 / 403 / 409 { error, reason, final?, checks? } / 502 / 503
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { checkFollowUpLetter } from '@/lib/crm/email-compose/follow-up-draft'
import { sendTemplateEmail } from '@/lib/crm/email-templates/send-template-email'
import { checkLetterRelease } from '@/lib/crm/followup-progress/letter-list'
import { createLetterListDeps } from '@/lib/crm/followup-progress/letter-list-prod'
import { LINK_REFUSAL, linkAiLetterForSend, parseAiLetterId } from '@/lib/crm/email-compose/ai-letter-record'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const actorEmail = access.user.email?.toLowerCase().trim()
  if (!actorEmail) return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const contactId = text(payload?.contactId)
  const requestId = text(payload?.requestId)
  const subject = text(payload?.subject)
  const body = text(payload?.body)
  const ai = parseAiLetterId(payload?.aiLetterId)
  if (!contactId || !requestId || !subject || !body || !UUID_RE.test(contactId) || !UUID_RE.test(requestId) || !ai.ok) {
    return NextResponse.json({ error: '请求格式不对。', reason: 'invalid_input' }, { status: 400 })
  }

  try {
    const now = new Date()
    const still = await checkLetterRelease(await createLetterListDeps(supabaseAdmin, params.id, now), { contactId, requestId }, now)
    // `final`: editing the letter cannot change this answer, so the page does not offer "fix and send again".
    if (!still.ok) return NextResponse.json({ error: still.message, reason: still.reason, final: still.reason !== 'mail_check' }, { status: 409 })
    const checked = await checkFollowUpLetter(params.id, contactId, { subject, body })
    if (!checked.ok) return NextResponse.json({ error: `这封信现在没法检查，没有发：${checked.message}`, reason: checked.reason }, { status: 409 })
    const failed = checked.checks.filter((c) => c.status === 'fail')
    if (failed.length > 0) {
      return NextResponse.json({ error: `检查没过，这封没有发：${failed.map((c) => `${c.label}（${c.detail}）`).join('；')}`, reason: 'check_failed', checks: checked.checks }, { status: 409 })
    }
  } catch (err) {
    // Nothing has been sent yet at this point: the person may fix and release again.
    console.error('[crm/followup-letters/release] 放行前复核失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '放行前的复核没跑成，这封没有发。稍后再试。', reason: 'recheck_failed' }, { status: 409 })
  }

  if (ai.id !== null) {
    // Before the send: an AI letter must never reach a guest without its mark (PM 2026-11-28).
    const linked = await linkAiLetterForSend(supabaseAdmin, { clientId: params.id, contactId, aiLetterId: ai.id, requestId, actorEmail, subject, body, now: new Date() })
    if (!linked.ok) {
      const refusal = LINK_REFUSAL[linked.reason]
      return NextResponse.json({ error: refusal.message, reason: `ai_letter_${linked.reason}`, final: linked.reason !== 'write_failed' }, { status: refusal.status })
    }
  }

  const result = await sendTemplateEmail({
    clientId: params.id, contactId, actorEmail, requestId, subject, body,
    expectedRecipient: payload?.expectedRecipient, template: null,
  })
  if ('crashed' in result) return NextResponse.json({ error: result.message, reason: 'internal_error' }, { status: 503 })
  if (!result.ok) return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status })
  return NextResponse.json({ ok: true, messageId: result.messageId, conversationId: result.conversationId, duplicate: result.duplicate === true })
}
