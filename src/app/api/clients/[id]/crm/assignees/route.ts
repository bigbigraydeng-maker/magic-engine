/**
 * GET /api/clients/[id]/crm/assignees
 *
 * 候选跟进人列表 —— `client_portal_users.receives_round_robin_leads=true` 的那几个人。
 * 用在：PersonDrawer 的「跟进人」下拉 + 「全部客人」页的跟进人筛选条。
 *
 * 这个接口只读 `client_portal_users.email`，不含「每人持有多少线索」—— 看板那边
 * 要用再加。先把最小闭环接通。
 *
 * IDOR：按 client_id 收口，调用方必须对这个客户有付费客户访问权。
 * Responses: 200 { assignees: [{ email }], viewerEmail } / 401 / 403 / 500
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { listAssignees } from '@/lib/crm/lead-assignee'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const rows = await listAssignees({ clientId, supabase: supabaseAdmin })
    return NextResponse.json({
      assignees: rows.map((r) => ({ email: r.email })),
      viewerEmail: access.user.email?.toLowerCase().trim() ?? null,
    })
  } catch (err) {
    console.error('[crm/assignees]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '读取跟进人名单失败' }, { status: 500 })
  }
}
