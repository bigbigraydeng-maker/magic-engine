import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { isUuid } from '@/lib/validation-utils'
import { assertMayClick, clickerFromSession, decideConfirmationCard } from '@/lib/confirmation-card'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'

export async function POST(
  req: Request,
  { params }: { params: { id: string; runId: string } },
) {
  if (!isUuid(params.id) || !isUuid(params.runId)) {
    return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  }
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const message = access.status === 401 ? '请先登录。' : '你不能看这位客户的确认卡。'
    return NextResponse.json({ error: message }, { status: access.status })
  }
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId: params.id,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  try {
    assertMayClick(clicker, params.id)
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
    }
    const body = parseDecisionBody(raw)
    const card = await decideConfirmationCard(createKernel(supabaseAdmin), {
      clientId: params.id,
      runId: params.runId,
      clicker,
      resolution: body.resolution,
      expectedDecisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
    })
    return NextResponse.json(card)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[confirmation-card] decision failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
