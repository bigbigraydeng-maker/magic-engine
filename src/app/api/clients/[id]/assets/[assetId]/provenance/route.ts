/**
 * 改一张素材的「来源」—— 主要用途是把「客户提供（未核实）」升为「客户实拍（已确认）」。
 *
 * 为什么需要人点这一下：上传链接不过期、可无限转发，客户完全可能把网图或 AI 图
 * 从那条链接传进来。系统没有任何办法自动分辨。所以「能不能拿它去打真实价格」
 * 这个判断必须由看过东西的人来下，并且**留下是谁下的**。
 *
 * 平时不用点。只在要出「标了真实价格」的对外内容时，确认用到的那几张。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isAssetSource, canBackRealPrice } from '@/lib/assets/provenance'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: { id: string; assetId: string }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, assetId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  // 🔴 2026-08-05 魏征 P2-3：签字这一步的全部注释都写着「必须由 **FDE** 逐张确认」，
  // 但 `requireDashboardClientAccess` 对客户本人（paid_client）也返回 ok，
  // 路由里又没有任何 tier 判断 —— 于是中介自己登录后台，就能把自己传的网图
  // 签成「客户实拍（已确认）」，`verified_by` 记的还是他自己的邮箱。
  //
  // 「找一个跟这笔生意没有利害关系的人来背书」是这道签字的**全部意义**。
  // 客户给自己背书 = 没有背书。
  if (access.tier !== 'admin') {
    return NextResponse.json(
      {
        success: false,
        error: '素材确认必须由 Magic Engine 的人来做 —— 自己给自己的素材背书，这个确认就没有意义了',
      },
      { status: 403 },
    )
  }

  let body: { source?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isAssetSource(body.source)) {
    return NextResponse.json({ success: false, error: '未知的来源取值' }, { status: 400 })
  }
  const source = body.source

  // 审计字段只在「升为可打真价」时写。降级回未核实要把签名清掉 ——
  // 留着旧签名会让人以为它还是被确认过的。
  const auditFields = canBackRealPrice(source)
    ? { verified_by: access.user.email ?? 'unknown', verified_at: new Date().toISOString() }
    : { verified_by: null, verified_at: null }

  // 条件恒带 client_id：换个客户的 assetId 过来改不动别人的素材。
  const { data, error } = await supabaseAdmin
    .from('client_assets')
    .update({ source, ...auditFields, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('client_id', clientId)
    .select('id, source, verified_by, verified_at')
    .single()

  if (error) {
    console.error('[assets/provenance] db error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: '素材不存在' }, { status: 404 })
  }

  return NextResponse.json({ success: true, asset: data })
}
