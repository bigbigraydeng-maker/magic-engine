/**
 * POST /api/clients/[id]/crm/contacts/[cid]/catalogue-send
 *
 * 「发送 2027 目录」：发目录信（127 号的 sendCatalogueEmail，所有发信闸照跑），**确认发出之后**才给客人挂上
 * 「AI 跟进中」（lib/crm/ai-takeover/actions.ts）。被挡、或发没发出去不确定时，什么都不写。
 * 不改阶段。
 *
 * Body: { requestId: uuid, expectedRecipient: string }
 *   requestId 每次点击一个：双击 / 重试同一个 → 不重发、不重记。
 * 发信人只取登录身份，不读请求体。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendCatalogueEmail } from '@/lib/crm/catalogue-line/send-catalogue'
import { createCatalogueDeps } from '@/lib/crm/catalogue-line/prod'
import { sendCatalogueAndTakeOver } from '@/lib/crm/ai-takeover/actions'
import { createTakeoverStore } from '@/lib/crm/ai-takeover/prod'

interface RouteParams {
  params: { id: string; cid: string }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const actorEmail = access.user.email?.toLowerCase().trim()
  if (!actorEmail) return NextResponse.json({ error: '无法确认发送者身份' }, { status: 403 })

  const raw: unknown = await req.json().catch(() => null)
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  const expectedRecipient = typeof body.expectedRecipient === 'string' ? body.expectedRecipient.trim() : ''
  if (!UUID_RE.test(requestId)) return NextResponse.json({ error: '缺少或不认识的 requestId（幂等键）' }, { status: 400 })
  if (!expectedRecipient || expectedRecipient.length > 320) {
    return NextResponse.json({ error: '缺少收件地址' }, { status: 400 })
  }

  try {
    const result = await sendCatalogueAndTakeOver(
      { clientId: params.id, contactId: params.cid, actorEmail, requestId, expectedRecipient },
      { sendCatalogue: (a) => sendCatalogueEmail(a, createCatalogueDeps(params.id)), store: createTakeoverStore() },
    )
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    // Thrown after the send may have started: never say "not sent".
    console.error('[crm/catalogue-send] 失败:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, sent: 'unknown', reason: 'internal_error', message: '这封有没有发出去还不确定。请一分钟后看下面的往来记录，先别重发。' },
      { status: 503 },
    )
  }
}
