/**
 * POST /api/clients/[id]/crm/contacts/[cid]/email/compose/draft
 *
 * 给「第一封邮件」框起草主题 + 正文。**只返回文字，不发、不落库、不碰客人。**
 * 只有「这个人现在能写第一封」（previewCompose 通过）才起草 —— 开关没开、没咨询过、别再联系的人不烧 AI。
 *
 * Responses: 200 { subject, body } / 401 / 403 / 404 / 409 { reason } / 429 冷却 / 502 { reason }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { claimDraftSlot, generateFirstEmailDraft } from '@/lib/crm/email-compose/ai-draft'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function POST(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let preview
  try {
    preview = await previewCompose({ clientId: params.id, contactId: params.cid }, createMailNewDeps())
  } catch {
    return NextResponse.json({ error: '系统暂时读不到发信设置。', reason: 'config_unreadable' }, { status: 502 })
  }
  if (!preview.canCompose) {
    return NextResponse.json({ error: preview.message, reason: preview.reason }, { status: 409 })
  }

  if (!claimDraftSlot(`${params.id}:${params.cid}`)) {
    return NextResponse.json({ error: '刚刚起草过，请稍等几秒再试。', reason: 'cooldown' }, { status: 429 })
  }

  const result = await generateFirstEmailDraft(params.id, params.cid)
  if (!result.ok) {
    const status = result.reason === 'contact_not_found' ? 404 : 502
    return NextResponse.json({ error: result.message, reason: result.reason }, { status })
  }
  return NextResponse.json({ subject: result.draft.subject, body: result.draft.body })
}
