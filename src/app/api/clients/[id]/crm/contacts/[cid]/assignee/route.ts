/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/assignee
 *
 * 改一个人的「跟进人」—— `contacts.assigned_to`。空字符串或 null = 清空（设回未分配）。
 *
 * 这是 issue #3158 part 3 的 UI 入口：PersonDrawer 的「跟进人」下拉直接 PATCH 到这里。
 *
 * 校验：
 *   - IDOR：contact 必须属于 path 上的 client，否则 404。
 *   - 候选名单：assignee 必须是这个客户的 `client_portal_users` 中 `receives_round_robin_leads=true` 的邮箱之一。
 *     不校验的话任何字符串都能塞进去，前端下拉外的脏值会污染后面的 round-robin 持有数统计。
 *
 * Body: { assignee: string | null }
 * Responses: 200 { assignee: string | null } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { listAssignees } from '@/lib/crm/lead-assignee'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let nextAssignee: string | null
  try {
    const body = (await req.json()) as { assignee?: unknown }
    if (body.assignee === null || body.assignee === '' || body.assignee === undefined) {
      nextAssignee = null
    } else if (typeof body.assignee === 'string') {
      nextAssignee = body.assignee.toLowerCase().trim()
      if (nextAssignee.length === 0) nextAssignee = null
    } else {
      return NextResponse.json({ error: 'assignee 必须是邮箱字符串或 null' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  // 候选名单校验（nextAssignee 不为空时才查）—— 跟 round-robin 挑人用同一份名单，
  // 两边不会说两套话。
  if (nextAssignee !== null) {
    try {
      const candidates = await listAssignees({ clientId, supabase: supabaseAdmin })
      const ok = candidates.some((c) => c.email.toLowerCase() === nextAssignee)
      if (!ok) {
        return NextResponse.json(
          { error: '这个邮箱不在当前客户的跟进人名单里' },
          { status: 400 },
        )
      }
    } catch (err) {
      console.error('[crm/assignee] 查候选失败:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: '操作失败' }, { status: 500 })
    }
  }

  // 必须带 client_id 一起查，否则换个 cid 就能改到别家客户的联系人（跟 pin / stage 同款）。
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (findErr) {
    console.error('[crm/assignee] 查联系人失败:', findErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const { error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update({ assigned_to: nextAssignee })
    .eq('id', cid)
    .eq('client_id', clientId)

  if (updateErr) {
    console.error('[crm/assignee] 更新失败:', updateErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({ assignee: nextAssignee })
}
