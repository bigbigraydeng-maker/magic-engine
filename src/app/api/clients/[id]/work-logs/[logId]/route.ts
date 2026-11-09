import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

interface Params { params: { id: string; logId: string } }

// DELETE /api/clients/[id]/work-logs/[logId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, reason: access.reason },
      { status: access.status }
    )
  }

  // 会话必须带邮箱：邮箱为空的会话在管理员名单配置有空项时会被误判成管理员，先拦掉。
  const email = access.user.email
  if (typeof email !== 'string' || email.trim().length === 0) {
    return NextResponse.json({ error: 'Forbidden', reason: 'missing_email' }, { status: 403 })
  }

  if (access.tier !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden', reason: 'admin_only' },
      { status: 403 }
    )
  }

  // 双条件删除：logId 属于别的客户时一行都删不到，统一回 404，不当探针用。
  const { data, error } = await supabaseAdmin
    .from('fde_work_logs')
    .delete()
    .eq('id', params.logId)
    .eq('client_id', params.id)
    .select('id')

  if (error) {
    console.error('[work-logs DELETE] delete failed:', error)
    return NextResponse.json({ error: 'work_logs_delete_failed' }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
