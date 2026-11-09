/**
 * GET /api/clients/[id]/crm/contacts/[cid]/ai-takeover
 *
 * 抽屉里「📘 2027 目录」那一块要显示的：这位客人在不在「AI 跟进中」、从什么时候、接管之后客人有没有回来、
 * 目录是哪一版、发给哪个邮箱（和真发同一套判断，不碰邮箱服务、不写任何东西）。只读。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadTakeoverView } from '@/lib/crm/ai-takeover/view'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', params.cid)
    .eq('client_id', params.id)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: '暂时读不到这位客人，请稍后再试。' }, { status: 500 })
  if (!contact) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  try {
    return NextResponse.json(await loadTakeoverView(params.id, params.cid, new Date()))
  } catch (err) {
    console.error('[crm/ai-takeover] 读取失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到跟进状态，请稍后再试。' }, { status: 503 })
  }
}
