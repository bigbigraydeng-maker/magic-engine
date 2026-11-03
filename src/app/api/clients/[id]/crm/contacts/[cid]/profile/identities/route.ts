/**
 * POST /api/clients/[id]/crm/contacts/[cid]/profile/identities     给这个客人加一个邮箱或电话
 * Body: { kind: 'email' | 'phone', value: string }
 *
 * 已经是他的 → 200（幂等）；已经是别的客人的 → 409（库里有重复的人，合并另有设计，这里不自动合并）；
 * 邮箱 / 电话认不出来 → 400。不提供删除 / 改主联系方式（牵动合并与认人，另立设计）。
 *
 * Responses: 200 { profile, added } / 400 / 401 / 403 / 404 / 409 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { addProfileIdentity, loadProfile } from '@/lib/crm/profile'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { kind?: unknown; value?: unknown }
  try {
    body = (await req.json()) as { kind?: unknown; value?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }
  if (body?.kind !== 'email' && body?.kind !== 'phone') {
    return NextResponse.json({ error: 'kind 只能是 email 或 phone' }, { status: 400 })
  }

  try {
    // 默认国家的判据跟手工录入路由（crm/contacts POST）同一份：NZ 客户 → NZ，其余 → AU。
    // （clients.default_phone_country 在生产库全是空的，不能靠它——否则 AU 客户的本地号码会被补成 +64。）
    const { data: client } = await supabaseAdmin.from('clients').select('country, semrush_db').eq('id', params.id).maybeSingle()
    const c = client as { country: string | null; semrush_db: string | null } | null
    const country: 'NZ' | 'AU' = c?.country === 'NZ' || c?.semrush_db === 'nz' ? 'NZ' : 'AU'

    const result = await addProfileIdentity(supabaseAdmin, params.id, params.cid, body.kind, body.value, country)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, ...(result.ownerContactId ? { ownerContactId: result.ownerContactId } : {}) }, { status: result.status })
    }

    const profile = await loadProfile(supabaseAdmin, params.id, params.cid)
    return NextResponse.json({ profile, added: result.added })
  } catch {
    return NextResponse.json({ error: '保存失败，请稍后再试' }, { status: 500 })
  }
}
