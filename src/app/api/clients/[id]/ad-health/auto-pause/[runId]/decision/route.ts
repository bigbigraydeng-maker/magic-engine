/**
 * Ads D3 自动暂停——一键批准 / 驳回。
 *
 * POST { resolution: 'approve' | 'reject', reason?: string }
 *
 * 🔴 批准 = 签批准 + 立刻执行（一次调用），不是「先签、再另外去点执行」——
 *    PM 2026-09-22 明确要的是这个。走
 *    `src/lib/action-submission/ads-auto-pause.ts` 的
 *    `approveAndExecuteAdsAutoPause`，那个模块是这一个动作专属的一键批准
 *    入口，不是通用审批面（`kernel-approval/` 那条路只签批准、不执行）。
 *
 * 🔴 操作者身份**只来自服务端认证会话**（`access.user.email`），
 *    请求体不接受、也不信任何身份字段。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { KernelError } from '@/lib/kernel/errors'
import { approveAndExecuteAdsAutoPause, rejectAdsAutoPause, ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause'

export const dynamic = 'force-dynamic'

interface RouteParams { params: { id: string; runId: string } }

function parseBody(body: unknown): { resolution: 'approve' | 'reject'; reason?: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (record.resolution !== 'approve' && record.resolution !== 'reject') return null
  if (record.reason !== undefined && typeof record.reason !== 'string') return null
  return { resolution: record.resolution, ...(record.reason ? { reason: record.reason } : {}) }
}

/** 这次决定之后，把对应的 flywheel_actions 记录改成一个终态——待办列表靠这个消失。 */
async function updateLedgerStatus(
  clientId: string,
  runId: string,
  status: 'paused' | 'rejected' | 'failed',
  extra: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .eq('action_type', 'ads.auto_pause_on_d3')
    .eq('payload->>action_run_id', runId)
    .maybeSingle()
  const row = data as { id: string; payload: Record<string, unknown> } | null
  if (!row) return
  await supabaseAdmin
    .from('flywheel_actions')
    .update({ payload: { ...row.payload, ...extra, status } })
    .eq('id', row.id)
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = parseBody(await req.json().catch(() => null))
  if (!body) return NextResponse.json({ error: 'resolution 只能是 approve 或 reject' }, { status: 400 })

  const kernel = createKernel(supabaseAdmin)

  // 归属核对：这条 run 必须真的属于这个客户、真的是这一个动作——不能拿
  // clientId 之外的 runId 来批别的客户/别的动作（跟 kernel-approval 的
  // decisionBelongsToRun 同一个道理，只是这里是单动作专属路由，判据更简单）。
  let run
  try {
    run = await kernel.requireRun(params.runId)
  } catch {
    return NextResponse.json({ error: '找不到这条动作' }, { status: 404 })
  }
  if (run.client_id !== params.id || run.action_key !== ADS_AUTO_PAUSE_ACTION_KEY) {
    return NextResponse.json({ error: '这条动作不属于这个客户，或不是自动暂停建议' }, { status: 403 })
  }

  const actorEmail = access.user.email
  if (!actorEmail) {
    return NextResponse.json({ error: '登录账号没有邮箱，无法记录是谁批准的' }, { status: 400 })
  }

  try {
    if (body.resolution === 'reject') {
      const outcome = await rejectAdsAutoPause(kernel, params.runId, actorEmail, body.reason ?? '不批准')
      await updateLedgerStatus(params.id, params.runId, 'rejected', { reason: outcome.humanReason })
      return NextResponse.json({ ok: true, kind: outcome.kind })
    }

    const outcome = await approveAndExecuteAdsAutoPause(kernel, params.runId, actorEmail)
    const status = outcome.kind === 'succeeded' ? 'paused' : 'failed'
    await updateLedgerStatus(params.id, params.runId, status, { reason: outcome.humanReason })
    return NextResponse.json({ ok: outcome.kind === 'succeeded', kind: outcome.kind, humanReason: outcome.humanReason })
  } catch (e) {
    if (e instanceof KernelError) {
      return NextResponse.json({ error: e.humanReason, code: e.code }, { status: 409 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
