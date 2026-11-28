/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/compose/check — run the follow-up letter checks on a text.
 * Body: { subject, body }. Read-only, calls no model, sends nothing.
 * For a letter a person has edited after the AI drafted it: the checks shown with the draft were for the AI's text.
 * Same access as drafting. Responses: 200 { checks } / 400 / 401 / 403 / 409 / 502
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { checkFollowUpLetter } from '@/lib/crm/email-compose/follow-up-draft'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string; cid: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const subject = typeof payload?.subject === 'string' ? payload.subject : ''
  const body = typeof payload?.body === 'string' ? payload.body : ''
  if (subject.trim() === '' || body.trim() === '' || subject.length > 300 || body.length > 8000) {
    return NextResponse.json({ error: '主题和正文都要有，而且不能太长。', reason: 'invalid_input' }, { status: 400 })
  }
  try {
    const result = await checkFollowUpLetter(params.id, params.cid, { subject, body })
    if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.reason === 'contact_not_found' ? 404 : 409 })
    return NextResponse.json({ checks: result.checks })
  } catch (err) {
    console.error('[crm/compose/check] 检查失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时没法检查，请稍后再试。', reason: 'check_unavailable' }, { status: 502 })
  }
}
