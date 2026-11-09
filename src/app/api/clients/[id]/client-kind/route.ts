/**
 * GET   /api/clients/[id]/client-kind — 客户类型（普通 / 个人 IP）。空值按普通客户。
 * PATCH /api/clients/[id]/client-kind — 设一次，以后开方都照它开。
 *
 * 单独一条路由：clients.client_kind 列还没加上的环境里，这里读不到只会返回「普通」，
 * 不会拖垮 /api/clients/[id] 那条被很多页面用的路由。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { loadClientKind } from '@/lib/huatuo/client-kind'

type RouteContext = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const clientKind = await loadClientKind(supabaseAdmin, params.id)
  return NextResponse.json({ client_kind: clientKind })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const body = await req.json().catch(() => null) as { client_kind?: unknown } | null
  const value = body?.client_kind
  if (value !== 'standard' && value !== 'personal_ip') {
    return NextResponse.json({ error: 'client_kind must be standard or personal_ip' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('clients')
    .update({ client_kind: value })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ client_kind: value })
}
