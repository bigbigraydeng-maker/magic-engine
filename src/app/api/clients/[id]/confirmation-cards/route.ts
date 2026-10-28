import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { isUuid } from '@/lib/validation-utils'
import {
  assertMayClick,
  clickerFromSession,
  issueConfirmationCard,
  listConfirmationCards,
} from '@/lib/confirmation-card'
import { parseIssueBody, publicError } from '@/lib/confirmation-card/http'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { isPlanApprovalCard } from '@/lib/marketing-plan/plan-card-subject'
import { pausedDraftResultLines } from '@/lib/ads-strategy/paused-draft-submit'

function clickerOf(req: Request, email: string, role: 'admin' | 'client-viewer', allowedClientId: string | null, clientId: string) {
  return clickerFromSession({
    email,
    role,
    allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
}

function refused(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return refused(access.status, access.status === 401 ? '请先登录。' : '你不能看这位客户的确认卡。')
  }
  const clicker = clickerOf(req, access.user.email ?? '', access.role, access.allowedClientId, params.id)
  try {
    const kernel = createKernel(supabaseAdmin)
    const cards = await listConfirmationCards(kernel, params.id, clicker)
    const lines = await pausedDraftResultLines(kernel.supabase, params.id)
    const shown = cards.map((card) => {
      const line = lines.get(card.runId)
      return line ? { ...card, statusLine: line } : card
    })
    return NextResponse.json({ cards: shown })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[confirmation-card] list failed')
    return refused(mapped.status, mapped.message)
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return refused(access.status, access.status === 401 ? '请先登录。' : '你不能看这位客户的确认卡。')
  }
  const clicker = clickerOf(req, access.user.email ?? '', access.role, access.allowedClientId, params.id)
  try {
    assertMayClick(clicker, params.id)
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return refused(400, '请求内容读不懂，没有收下。')
    }
    const facts = parseIssueBody(raw)
    if (isPlanApprovalCard(facts.subjectKey)) {
      throw new ConfirmationCardError('invalid', '计划批准卡不能从这里开。请从处方的同意里出。')
    }
    const card = await issueConfirmationCard(createKernel(supabaseAdmin), {
      clientId: params.id,
      clicker,
      facts,
    })
    return NextResponse.json(card)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[confirmation-card] issue failed')
    return refused(mapped.status, mapped.message)
  }
}
