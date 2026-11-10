/**
 * POST /api/clients/[id]/crm/contacts/[cid]/ai-takeover-off
 *
 * 「收回人工」：员工手动把这位客人从「AI 跟进中」收回来。**只有员工点这里才收回**（PM 2026-11-08）：
 * 打电话、客人回信都不会自动摘。先写一条 ai_takeover_off 记录，再清镜像列；镜像列没清上就报「只改了一半，再点一下」
 * （写法同 contacts/[cid]/dnc/route.ts）。不改阶段。
 *
 * Body: { clientRef: string }  幂等键，双击只记一笔。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { takeOverManually } from '@/lib/crm/ai-takeover/actions'
import { createTakeoverStore } from '@/lib/crm/ai-takeover/prod'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const actorEmail = access.user.email?.toLowerCase().trim()
  if (!actorEmail) return NextResponse.json({ error: '无法确认操作者身份' }, { status: 403 })

  const raw: unknown = await req.json().catch(() => null)
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const clientRef = typeof body.clientRef === 'string' ? body.clientRef.trim().slice(0, 150) : ''
  if (!clientRef) return NextResponse.json({ error: '缺少 clientRef(幂等键)' }, { status: 400 })

  // IDOR 闸：contact 必须属于 path 上的 client
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', params.cid)
    .eq('client_id', params.id)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: '暂时读不到这位客人，请稍后再试。' }, { status: 500 })
  if (!contact) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const result = await takeOverManually(
    { clientId: params.id, contactId: params.cid, actorEmail, clientRef },
    createTakeoverStore(),
  )
  return NextResponse.json(result.body, { status: result.status })
}
