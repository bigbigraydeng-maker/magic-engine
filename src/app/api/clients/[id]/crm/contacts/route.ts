/**
 * POST /api/clients/[id]/crm/contacts
 *
 * 新客人快速录入。销售最高频动作之一:「刚有个新客人打进来,先记一下」。没有这个
 * 入口,纯电话新 lead 就只能继续记在 Excel 里 —— Sheet 永远死不了。
 *
 * 复用 identity.resolveContact:靠电话 / 邮箱合并,不靠姓名。同一个人重复录入
 * (双击 / 又打来一次)不会产生两条,命中既有身份即复用 —— 天然幂等,无需 clientRef。
 * 新建的联系人零触点,segments 会把他排进「新进线，没人碰过」,当天名单里立刻能看到。
 *
 * Body: { name?, phone?, email? }  (phone / email 至少一个能规范化)
 * Responses: 200 { contactId, created } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { buildIdentities, resolveContact, AmbiguousIdentityError } from '@/lib/crm/identity'

interface Body {
  name?: unknown
  phone?: unknown
  email?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
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

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone : null
  const email = typeof body.email === 'string' ? body.email : null

  // 市场决定本地号码怎么补国码(CTS=NZ / Oztop=AU)。
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('semrush_db, country')
    .eq('id', clientId)
    .maybeSingle()
  const defaultCountry: 'NZ' | 'AU' =
    client?.country === 'NZ' || client?.semrush_db === 'nz' ? 'NZ' : 'AU'

  const identities = buildIdentities({ phone, email, defaultCountry })
  if (identities.length === 0) {
    return NextResponse.json(
      { error: '至少要填一个能用的电话或邮箱' },
      { status: 400 },
    )
  }

  try {
    const result = await resolveContact({
      clientId,
      identities,
      displayName: name || null,
      source: 'me_manual',
      // 手工录入:电话打错一位就可能撞上另一个老客户。自动合并会把两个真人的
      // 全部历史搅在一起且不可逆,所以交给人看一眼;也不拿新名字盖掉老客户的名字。
      mergeStrategy: 'reject',
      overwriteDisplayName: false,
    })
    return NextResponse.json({ contactId: result.contactId, created: result.created })
  } catch (err) {
    if (err instanceof AmbiguousIdentityError) {
      // 电话和邮箱分别属于两个已存在的人 —— 多半是打错了。把两边摆出来让人看。
      const { data: rows } = await supabaseAdmin
        .from('contacts')
        .select('id, display_name, primary_phone, primary_email')
        .in('id', err.contactIds)
        .eq('client_id', clientId)

      return NextResponse.json(
        {
          error: '这个电话和邮箱分别属于两位已有的客人，请确认是不是填错了',
          reason: 'ambiguous',
          candidates: (rows ?? []).map((r) => ({
            contactId: r.id,
            name: r.display_name ?? '未留姓名',
            phone: r.primary_phone,
            email: r.primary_email,
          })),
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '录入失败' },
      { status: 500 },
    )
  }
}
