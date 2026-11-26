/**
 * GET /api/clients/[id]/crm/auto-letters   「自动发信」列表：下一批、按期发送的信、每封信的状态和人数
 *
 * 只读，不发信，不返回任何邮箱（只有姓名和订单人数）。权限同「邮件模板」：付费客户员工可看。
 * 形状见 src/lib/messaging/letters/types.ts（AutoLettersList）；约定见发信设计窗口的读数据接口约定 v0。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { accessFailure, unavailable } from '@/lib/messaging/letters/http'
import { loadAutoLettersList } from '@/lib/messaging/letters/load'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: { id: string }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const failure = accessFailure(access)
    return NextResponse.json(failure.body, { status: failure.status })
  }
  try {
    return NextResponse.json(await loadAutoLettersList(supabaseAdmin, params.id))
  } catch (err) {
    console.error('[crm/auto-letters] 读取失败:', err instanceof Error ? err.message : err)
    const failure = unavailable()
    return NextResponse.json(failure.body, { status: failure.status })
  }
}
