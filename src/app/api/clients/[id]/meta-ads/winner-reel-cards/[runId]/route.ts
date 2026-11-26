/**
 * Confirm or decline one winner-sync card.
 * The scan does not write. This route writes only after a person confirms.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { assertMayClick, clickerFromSession } from '@/lib/confirmation-card'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { isUuid } from '@/lib/validation-utils'
import { confirmWinnerFromSession } from '@/lib/action-submission/winner-reel-confirm'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params
  const denied = await rejectAgentAdsBearer(req, { clientId: id, action: 'write_meta' })
  if (denied) return denied
  if (!isUuid(id) || !isUuid(runId)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const access = await requirePaidClientAccess(id)
  if (!access.ok) {
    const message = access.status === 401 ? '请先登录。' : '你不能替这位客户确认这张卡。'
    return NextResponse.json({ error: message }, { status: access.status })
  }
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId: id,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  try {
    assertMayClick(clicker, id)
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  try {
    const body = parseDecisionBody(raw)
    const result = await confirmWinnerFromSession(supabaseAdmin, {
      clientId: id,
      runId,
      decisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
      choice: body.resolution,
      clicker,
    })
    if (!result.card) return NextResponse.json({ error: result.resultLine }, { status: 409 })
    return NextResponse.json({ ...result.card, statusLine: result.resultLine })
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
