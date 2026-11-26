/**
 * GET /api/clients/[id]/crm/send-stats?days=7   「发信统计」页的数据：发出了哪些信、客人点了什么链接、发信后有没有联系我们
 *
 * 只读。没有邮箱地址、没有正文、没有主题；客人只给姓名和 contactId（页面据此链接到抽屉）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { clampDays, readSendStats } from '@/lib/crm/send-stats/read'
import { supabaseAdmin } from '@/lib/supabase'

interface RouteParams {
  params: { id: string }
}

export async function GET(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const payload = await readSendStats(supabaseAdmin, params.id, clampDays(req.nextUrl.searchParams.get('days')))
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[crm/send-stats] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '读取失败，请联系 Magic Lab 团队。' }, { status: 503 })
  }
}
