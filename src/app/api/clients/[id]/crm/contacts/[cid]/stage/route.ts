/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/stage
 *
 * 把一个联系人推进 / 改到另一个阶段,并留一条审计(谁、从哪档、改到哪档、为什么)。
 *
 * 安全 / 稳定:
 *   IDOR   contact 必须属于 path client:WHERE id=cid AND client_id=clientId → 404。
 *   合法值  toStage 必须是「本客户」真实存在的 stage_key,否则 400 —— 禁写任意字符串。
 *   幂等    current.stage === toStage → 直接 200,不写重复 event(吸收双击)。
 *
 * Body: { toStage, note? }
 * Responses: 200 { stage } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

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

  // ── IDOR 闸:contact 必须属于 path client。同时拿当前 stage 做 from + 幂等判断。 ──
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, stage')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  if (!contact) {
    return NextResponse.json({ error: '联系人不存在' }, { status: 404 })
  }

  // 合法值闸:toStage 必须是本客户真实存在的阶段。
  const { data: stageRow, error: sErr } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
    .eq('stage_key', toStage)
    .maybeSingle()

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 })
  }
  if (!stageRow) {
    return NextResponse.json({ error: '这个阶段不存在' }, { status: 400 })
  }

  const fromStage = (contact.stage as string | null) ?? null

  // 幂等:没变就不写 event。
  if (fromStage === toStage) {
    return NextResponse.json({ stage: toStage, changed: false })
  }

  const nowIso = new Date().toISOString()
  const { error: updErr } = await supabaseAdmin
    .from('contacts')
    .update({ stage: toStage, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', contactId)
    .eq('client_id', clientId)

  if (updErr) {
    return NextResponse.json({ error: `改阶段失败: ${updErr.message}` }, { status: 500 })
  }

  // 审计。UPDATE 已成、这条即使失败也只是少一条历史,低危(幂等已挡重复)。
  await supabaseAdmin.from('contact_stage_events').insert({
    client_id: clientId,
    contact_id: contactId,
    from_stage: fromStage,
    to_stage: toStage,
    changed_by: access.user.email ?? null,
    note,
  })

  return NextResponse.json({ stage: toStage, changed: true })
}
