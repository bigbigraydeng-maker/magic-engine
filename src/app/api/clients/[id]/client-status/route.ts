/**
 * Client status — single write entry for clients.client_status.
 *
 * GET   → current value.
 * PATCH → replaces it with a value from CLIENT_STATUS_OPTIONS.
 *
 * 真客户闸门（DataForSEO 接入计划 阶段 0）：所有周期性监测 cron 只对
 * client_status = 'active' 的客户跑。这里是运营人员改状态的唯一入口 ——
 * FDE/PM 不碰数据库（CLAUDE.md 强约束：配置类数据必带 UI）。
 *
 * Mirrors src/app/api/clients/[id]/industry/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isKnownClientStatus } from '@/lib/clients/client-status'

interface PatchBody {
  client_status?: unknown
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('client_status')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { client_status: unknown }).client_status
  const clientStatus =
    typeof raw === 'string' && isKnownClientStatus(raw) ? raw : 'prospect'

  return NextResponse.json({ client_status: clientStatus })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // client_status 是 ME 内部的监测成本闸门，不是客户业务字段 ——
  // 客户侧账号（client-viewer / paid_client）不能开关自己的监测（魏征 🟡3）
  if (access.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = body.client_status
  // 状态没有"清空"语义（库列 NOT NULL DEFAULT 'prospect'），只收词表值
  if (typeof raw !== 'string' || !isKnownClientStatus(raw)) {
    return NextResponse.json(
      { error: 'Body must include `client_status: "active" | "prospect" | "archived"`' },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ client_status: raw })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update client_status: ${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({ success: true, client_status: raw })
}
