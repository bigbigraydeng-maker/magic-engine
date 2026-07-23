/**
 * Brief products — FDE-managed list of what the client actually sells.
 *
 * GET   → reads master_briefs.products for the active brief.
 * PATCH → writes master_briefs.products on the active brief.
 *
 * 消费方:src/lib/content/brief-injector.ts 渲染成「主力产品:名称(卖点);…」送进
 * 内容生成的 system prompt —— 内容工厂每条广告文案都会读到它。
 *
 * 为什么补这个:CTS / Oztop / Magic Lab Class 三个客户的 products 全是空的,AI 一直
 * 拿到「主力产品:未设置」,只能靠内容支柱去推 —— 这正是「编出客户根本不卖的品类」
 * 类事故的结构性根因。字段本来就可写(brief PATCH 接口放行任意字段),缺的只是界面。
 *
 * Mirrors excluded-topics/route.ts pattern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { normalizeProducts } from '@/lib/brief/products'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('master_briefs')
    .select('id, products')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .single()

  // PGRST116 = 没有 active brief。不算错误:客户可能还没建档,UI 要能提示去建档而不是报错。
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Failed to load brief' }, { status: 500 })
  }

  return NextResponse.json({
    products: normalizeProducts((data as { products?: unknown } | null)?.products),
    has_brief: Boolean(data?.id),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { products?: unknown }
  try {
    body = (await req.json()) as { products?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(body.products)) {
    return NextResponse.json({ error: 'Body must include `products: {name, usp}[]`' }, { status: 400 })
  }

  const cleaned = normalizeProducts(body.products)

  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select('id')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .single()
  if (!brief?.id) {
    return NextResponse.json({ error: '这个客户还没有启用中的品牌档案,先去建档' }, { status: 404 })
  }

  // 空数组存 null 而非 []:brief-injector 用 `products?.map(...) || '未设置'` 判断,
  // 两者行为一致,但 null 更贴近「没填」的语义,也跟 excluded_topics 的处理一致。
  const { error: updateErr } = await supabaseAdmin
    .from('master_briefs')
    .update({ products: cleaned.length === 0 ? null : cleaned, updated_at: new Date().toISOString() })
    .eq('id', brief.id)

  if (updateErr) {
    return NextResponse.json({ error: `保存失败: ${updateErr.message}` }, { status: 500 })
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, products: cleaned, count: cleaned.length })
}
