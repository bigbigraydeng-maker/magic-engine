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
  /** 调用方看到的「改之前是哪一档」——不传 = 老行为，逐字不变。 */
  expectedFromStage?: unknown
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
  /**
   * 🔴 字段没传（key 不存在）和「明确传了 null」是两件不同的事，不能都塌成
   * undefined——`null` 是「这个人还没标过任何阶段」的合法值，也正是并发保护
   * 最该管的那个起点（魏征 2026-09-28 复审 B2 查出：塌成 undefined 会让并发闸
   * 对这批人形同虚设）。只有 key 真的不在 body 里，才当「没传」处理。
   */
  const expectedFromStage: string | null | undefined =
    'expectedFromStage' in body
      ? typeof body.expectedFromStage === 'string'
        ? body.expectedFromStage
        : null
      : undefined

  const result = await advanceContactStage(
    supabaseAdmin,
    clientId,
    contactId,
    toStage,
    note,
    access.user.email ?? null,
    expectedFromStage,
  )

  if (!result.ok) {
    if (result.status === 409) {
      return NextResponse.json({ error: result.error, actualStage: result.actualStage }, { status: 409 })
    }
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  const qualifiedLead = result.changed
    ? await noteQualifiedLead(supabaseAdmin, clientId, contactId, toStage, access.user.email ?? null)
    : null
  return NextResponse.json({
    stage: result.stage,
    changed: result.changed,
    ...(qualifiedLead ? { qualifiedLead } : {}),
  })
}

/** The stage is already saved. A send problem is reported, not rolled back. */
async function noteQualifiedLead(
  db: typeof supabaseAdmin,
  clientId: string,
  contactId: string,
  stageKey: string,
  actor: string | null,
): Promise<{ message: string } | null> {
  try {
    const { recordQualifiedStageLead } = await import('@/lib/conversions/crm-qualified-lead')
    const recorded = await recordQualifiedStageLead(db, { clientId, contactId, stageKey, actor })
    return recorded.attempted ? { message: recorded.message } : null
  } catch {
    return null
  }
}
