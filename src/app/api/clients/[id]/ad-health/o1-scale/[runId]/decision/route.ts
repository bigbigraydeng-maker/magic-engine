/** Approve/reject one O1 proposal; approval dispatches the already-authorized run to Inngest. */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { approveRun, rejectRun } from '@/lib/kernel/human-approval'
import { getDecision } from '@/lib/kernel/store'
import { KernelError } from '@/lib/kernel/errors'
import { assertActorMayApproveAction, parseExpectedDecisionId } from '@/lib/kernel-approval/service'
import { ApprovalError } from '@/lib/kernel-approval/errors'
import { ADS_O1_BUDGET_SCALE_ACTION_KEY } from '@/lib/action-submission/ads-o1-budget-scale'
import { inngest } from '@/lib/inngest/client'
import { ADS_O1_BUDGET_SCALE_APPROVED } from '@/lib/inngest/ads-events'

export const dynamic = 'force-dynamic'
type Params = { params: { id: string; runId: string } }

export async function POST(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.tier !== 'admin' || access.allowedClientId !== null || !access.user.email) {
    return NextResponse.json({ error: '只有内部负责人可以批准预算建议' }, { status: 403 })
  }
  const body = await req.json().catch(() => null) as { resolution?: unknown; expectedDecisionId?: unknown; reason?: unknown; historyReviewed?: unknown } | null
  if (!body || (body.resolution !== 'approve' && body.resolution !== 'reject')) {
    return NextResponse.json({ error: '请求内容不正确' }, { status: 400 })
  }
  let expectedDecisionId: string
  try { expectedDecisionId = parseExpectedDecisionId(body.expectedDecisionId) }
  catch (error) { return NextResponse.json({ error: error instanceof ApprovalError ? error.humanReason : '缺少审批编号' }, { status: 400 }) }

  const kernel = createKernel(supabaseAdmin)
  let run
  try { run = await kernel.requireRun(params.runId) }
  catch { return NextResponse.json({ error: '找不到这条预算建议' }, { status: 404 }) }
  if (run.client_id !== params.id || run.action_key !== ADS_O1_BUDGET_SCALE_ACTION_KEY) {
    return NextResponse.json({ error: '预算建议与客户不匹配' }, { status: 403 })
  }
  try {
    if (body.resolution === 'reject') {
      if (run.status !== 'pending_approval' || run.authorization_decision_id !== expectedDecisionId) {
        return NextResponse.json({ error: '审批内容已变化，请刷新后重新查看' }, { status: 409 })
      }
      const outcome = await rejectRun(kernel, run.id, access.user.email, typeof body.reason === 'string' ? body.reason : '不批准', { expectedDecisionId })
      return NextResponse.json({ ok: true, kind: outcome.run.status })
    }

    if (run.status === 'pending_approval') {
      if (body.historyReviewed !== true) {
        return NextResponse.json({ error: '批准前请先核对更长周期表现和 Meta 变更记录' }, { status: 400 })
      }
      assertActorMayApproveAction(run, access.tier)
      await approveRun(kernel, run.id, access.user.email, { expectedDecisionId })
      run = await kernel.requireRun(run.id)
    }
    if (run.status !== 'authorized' || !run.authorization_decision_id) {
      return NextResponse.json({ error: '这条预算建议当前不能执行' }, { status: 409 })
    }
    const decision = await getDecision(supabaseAdmin, run.authorization_decision_id)
    if (!decision || decision.action_run_id !== run.id || decision.verdict !== 'allow' || decision.decided_by !== 'human') {
      return NextResponse.json({ error: '找不到这条建议对应的人工批准记录' }, { status: 409 })
    }
    await inngest.send({
      name: ADS_O1_BUDGET_SCALE_APPROVED,
      data: { client_id: params.id, action_run_id: run.id },
    })
    return NextResponse.json({ ok: true, kind: 'queued', runId: run.id }, { status: 202 })
  } catch (error) {
    if (error instanceof KernelError) return NextResponse.json({ error: error.humanReason, code: error.code }, { status: 409 })
    console.error('[ad-health/o1-scale/decision] failed:', error)
    return NextResponse.json({ error: '批准已记录，但暂时无法排入执行队列；可以刷新后重试' }, { status: 503 })
  }
}
