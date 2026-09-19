/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/stage
 *
 * 把一个联系人推进 / 改到另一个阶段,并留一条审计(谁、从哪档、改到哪档、为什么)。
 *
 * 实际逻辑在 `src/lib/crm/advance-contact-stage.ts`——这个路由只管鉴权 + 解析 body，
 * 好让 `nal-mark-won` 那类需要"推进阶段 + 顺带做别的事"的端点能在进程内直接调用
 * 同一份逻辑，不用对内发 HTTP 请求（那样会因为没有浏览器 session cookie 而 401）。
 *
 * Body: { toStage, note? }
 * Responses: 200 { stage } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { advanceContactStage } from '@/lib/crm/advance-contact-stage'

interface Body {
  toStage?: unknown
  note?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const contactId = params.cid

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const toStage = typeof body.toStage === 'string' ? body.toStage.trim() : ''
  if (!toStage) {
    return NextResponse.json({ error: '缺少目标阶段' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim() || null : null

  const result = await advanceContactStage(
    supabaseAdmin,
    clientId,
    contactId,
    toStage,
    note,
    access.user.email ?? null,
  )

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ stage: result.stage, changed: result.changed })
}
