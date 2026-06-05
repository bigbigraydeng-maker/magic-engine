/**
 * GET /api/clients/[id]/unassigned-actions
 *
 * 列出该客户在 "Unassigned Backlog" Initiative 下的所有 execution_items
 * （来自 Phase 31 M1 migration 的兜底 bucket）。
 *
 * 用于 FDE 把老 actions 批量迁移到真实 Initiative。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 找该客户的 unassigned initiative
  const { data: unassignedInit } = await supabaseAdmin
    .from('initiatives')
    .select('id')
    .eq('client_id', params.id)
    .eq('initiative_type', 'unassigned')
    .maybeSingle<{ id: string }>()

  if (!unassignedInit) {
    return NextResponse.json({ actions: [], count: 0 })
  }

  // 列出该 initiative 下的所有 execution_items
  const { data, error } = await supabaseAdmin
    .from('execution_items')
    .select('id, title, dimension, status, created_at')
    .eq('initiative_id', unassignedInit.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    actions: data ?? [],
    count: data?.length ?? 0,
    backlog_initiative_id: unassignedInit.id,
  })
}
