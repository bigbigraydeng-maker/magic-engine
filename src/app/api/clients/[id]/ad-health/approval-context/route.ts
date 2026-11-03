/** GET — 单条待批/已执行 run 在同广告组上的只读上下文（上次动作、冷却、本条读回）。 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAdsetApprovalContext } from '@/lib/ads-strategy/approval-run-context/load-adset-approval-context'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const adsetId = req.nextUrl.searchParams.get('adset_id')?.trim() ?? ''
  const runId = req.nextUrl.searchParams.get('run_id')?.trim() ?? ''
  if (!adsetId || !runId) {
    return NextResponse.json({ error: '缺少 adset_id 或 run_id' }, { status: 400 })
  }

  const { data: run, error } = await supabaseAdmin
    .from('action_runs')
    .select('id, client_id, status, input')
    .eq('id', runId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: '读取失败' }, { status: 500 })
  if (!run || run.client_id !== params.id) {
    return NextResponse.json({ error: '找不到这条动作' }, { status: 404 })
  }
  const inputAdset = (run.input as { adset_id?: unknown })?.adset_id
  if (typeof inputAdset !== 'string' || inputAdset !== adsetId) {
    return NextResponse.json({ error: '广告组与动作不匹配' }, { status: 400 })
  }

  const context = await loadAdsetApprovalContext(supabaseAdmin, {
    clientId: params.id,
    adsetId,
    thisRunId: runId,
    thisRunStatus: String(run.status),
  })
  return NextResponse.json({ context })
}
