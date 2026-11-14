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
import { isAssetSource, canBackRealPrice, readPosterLineage } from '@/lib/assets/provenance'

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
        error: '素材确认必须由 Magic Engine 团队成员来做 —— 自己给自己的素材背书，这个确认就没有意义了',
      },
      { status: 403 },
    )
  }

  let body: { source?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  // 签字必须知道是谁签的。拿不到邮箱就不让签，绝不写 'unknown'。
  const signer = typeof access.user.email === 'string' && access.user.email.trim() ? access.user.email : null

  if (body.action !== undefined) {
    if (!signer) return noSignerResponse()
    return posterSignOff(clientId, assetId, body.action, signer)
  }

  if (!isAssetSource(body.source)) {
    return NextResponse.json({ success: false, error: '未知的来源取值' }, { status: 400 })
  }
  const source = body.source
  if (canBackRealPrice(source) && !signer) return noSignerResponse()

  // AI 海报 / AI 图：来源不能被改写成能打真价的（见 refuseSourceChange）。
  const refusal = await refuseSourceChange(clientId, assetId, source)
  if (refusal) return refusal

  // 审计字段只在「升为可打真价」时写。降级回未核实要把签名清掉 ——
  // 留着旧签名会让人以为它还是被确认过的。
  const auditFields = canBackRealPrice(source) && signer
    ? { verified_by: signer, verified_at: new Date().toISOString() }
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

function noSignerResponse() {
  return NextResponse.json(
    { success: false, error: '读不到你的登录邮箱，签字记不了是谁签的，所以不让签。请重新登录后再试。' },
    { status: 403 },
  )
}

/**
 * `{ source }` 改来源前的两道拒绝（读失败按 500 拒绝，不放行）：
 *   1. 带合格海报血统的素材 —— 一律不许改，海报只能「对原图确认」签字；
 *   2. 现在是 ai_generated 的素材 —— 不许升成能打真价的来源（client_verified / fde_shot）。
 *      AI 画出来的图，谁签字它也不是实拍。
 */
async function refuseSourceChange(
  clientId: string,
  assetId: string,
  target: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabaseAdmin
    .from('client_assets')
    .select('id, source, vision_metadata')
    .eq('id', assetId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    console.error('[assets/provenance] source check error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  const row = data as { source: string | null; vision_metadata: unknown } | null
  if (row && readPosterLineage(row.vision_metadata) !== null) {
    return NextResponse.json(
      {
        success: false,
        error: '这是 AI 海报，来源不能改。海报只能用「已对原图，确认」签字（对过原图后点那个按钮）。',
      },
      { status: 400 },
    )
  }
  if (row && row.source === 'ai_generated' && canBackRealPrice(target)) {
    return NextResponse.json(
      { success: false, error: '这张是 AI 生成或改写的图，不能改成「客户实拍」或「我们拍的」。' },
      { status: 400 },
    )
  }
  return null
}

/**
 * AI 海报签字：团队成员看过海报、对过原图后点「已对原图，确认」；发现不对点「撤销」。
 *
 * 只改 verified_by / verified_at，**不改 source**（海报永远是 ai_generated）。
 * 签了字也不等于能打真价 —— 发布闸还要按原图**当前**来源再判一次。
 * 只对带合格 `vision_metadata.poster` 血统的素材生效，普通素材走上面的 `{ source }` 通道。
 */
async function posterSignOff(clientId: string, assetId: string, action: unknown, signer: string) {
  if (action !== 'confirm_poster' && action !== 'revoke_poster') {
    return NextResponse.json({ success: false, error: '未知的操作' }, { status: 400 })
  }

  const { data: row, error: readErr } = await supabaseAdmin
    .from('client_assets')
    .select('id, vision_metadata')
    .eq('id', assetId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (readErr) {
    console.error('[assets/provenance] poster read error:', readErr.message)
    return NextResponse.json({ success: false, error: readErr.message }, { status: 500 })
  }
  if (!row) return NextResponse.json({ success: false, error: '素材不存在' }, { status: 404 })
  if (readPosterLineage((row as { vision_metadata: unknown }).vision_metadata) === null) {
    return NextResponse.json({ success: false, error: '这张不是 AI 海报，不能用海报签字' }, { status: 400 })
  }

  const auditFields = action === 'confirm_poster'
    ? { verified_by: signer, verified_at: new Date().toISOString() }
    : { verified_by: null, verified_at: null }

  const { data, error } = await supabaseAdmin
    .from('client_assets')
    .update({ ...auditFields, updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('client_id', clientId)
    .select('id, source, verified_by, verified_at')
    .single()
  if (error) {
    console.error('[assets/provenance] poster sign-off error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, asset: data })
}
