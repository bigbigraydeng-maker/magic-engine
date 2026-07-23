/**
 * Factory config — single write entry for clients.factory_config (jsonb).
 *
 * 存在理由:这一列此前**没有任何 API 或 UI 写入路径**,只能进 Supabase Studio 手改。
 * 违反 CLAUDE.md「FDE/PM 配置类数据必须有 UI」的硬约束,而且接一个客户就要人工敲一次库
 * —— 一个客户还行,十个就崩。
 *
 * GET   → 当前配置 + 该客户的活跃 Goal 列表(供下拉,避免手填 UUID 填错)+ 已登记的
 *         FB 主页 URL(填 page_id 时的对照提示)。
 * PATCH → 按 key 合并,不整体替换(见 lib/factory/client-config.ts 头注)。
 *
 * 投影 / 合并 / 格式校验在 src/lib/factory/client-config.ts(纯函数,可测);
 * 这里只留鉴权 + 查库 + Goal 归属确认。镜像 brand-redlines/route.ts 的鉴权与返回形状。
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import {
  SUPPORTED_PLATFORMS,
  mergeFactoryConfig,
  projectFactoryConfig,
} from '@/lib/factory/client-config'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('factory_config, facebook_page_url')
    .eq('id', clientId)
    .single()
  if (error || !data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Goal 下拉:只给活跃的。pickFactoryGoal 对不在活跃列表里的 id 会静默退回「最新活跃
  // Goal」——填错不会报错,只会安静地按错的战略量产,所以从源头限制成选择而非输入。
  const { data: goals } = await supabaseAdmin
    .from('goals')
    .select('id, title')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  return NextResponse.json({
    config: projectFactoryConfig(data.factory_config),
    active_goals: (goals ?? []).map((g) => ({
      id: g.id as string,
      title: (g.title as string) ?? '(无标题)',
    })),
    facebook_page_url: (data.facebook_page_url as string | null) ?? null,
    supported_platforms: SUPPORTED_PLATFORMS,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data: existing, error: readErr } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .single()
  if (readErr || !existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const merged = mergeFactoryConfig(existing.factory_config, body)
  if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 400 })

  // 跨客户 / 已归档的 Goal id 会让工厂按别人的(或过期的)战略出片,必须查库确认
  if (merged.goalIdToVerify) {
    const { data: goal } = await supabaseAdmin
      .from('goals')
      .select('id')
      .eq('id', merged.goalIdToVerify)
      .eq('client_id', clientId)
      .eq('status', 'active')
      .maybeSingle()
    if (!goal) {
      return NextResponse.json({ error: '这个 Goal 不属于本客户,或已不是活跃状态' }, { status: 400 })
    }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ factory_config: merged.config })
    .eq('id', clientId)
  if (updateErr) {
    return NextResponse.json({ error: `保存失败: ${updateErr.message}` }, { status: 500 })
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, config: projectFactoryConfig(merged.config) })
}
