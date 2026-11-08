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
import { ADS_O1_BUDGET_SCALE_ACTION_KEY, submitAdsO1BudgetScale } from '@/lib/action-submission/ads-o1-budget-scale'
import type { MoneyHold, MoneyWriteResult } from '@/lib/action-submission/money-card'
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

    return NextResponse.json({
      error: '加预算要先在没过期的确认卡上点确认。这次没有改预算。',
      wroteMeta: false,
    }, { status: 409 })
  } catch (error) {
    // 加钱类只有 PM 本人能批（第 3 刀 3a）：别人点批准是权限问题，答 403 而不是「状态冲突」。
    if (error instanceof KernelError && error.code === 'NOT_AUTHORIZED' && error.detail?.reason === 'spend_approver_only') {
      return NextResponse.json({ error: error.humanReason, code: error.code }, { status: 403 })
    }
    if (error instanceof KernelError) return NextResponse.json({ error: error.humanReason, code: error.code }, { status: 409 })
    console.error('[ad-health/o1-scale/decision] failed:', error)
    return NextResponse.json({ error: '这次没有改预算。', wroteMeta: false }, { status: 503 })
  }
}

/** Called only after a budget confirmation card is already confirmed. */
export async function queueRaiseAfterCard(
  kernel: ReturnType<typeof createKernel>,
  access: Extract<Awaited<ReturnType<typeof requirePaidClientAccess>>, { ok: true }>,
  clientId: string,
  hold: MoneyHold,
): Promise<MoneyWriteResult> {
  if (!access.user.email || !hold.goalId || !hold.cycleDate) {
    return { wroteMeta: false, readbackCents: null, reason: '加预算的确认材料不齐，没有改。' }
  }
  const outcome = await submitAdsO1BudgetScale(kernel, {
    clientId,
    access,
    goalId: hold.goalId,
    cycleDate: hold.cycleDate,
    adAccountId: hold.adAccountId,
    adsetId: hold.scaleAdsetId ?? hold.entityId,
    ...(hold.level === 'campaign' && hold.campaignId ? { campaignId: hold.campaignId } : {}),
    beforeCents: hold.beforeCents,
    afterCents: hold.afterCents,
    source: hold.source === 'scorecard_up' ? 'ads_health_scorecard' : 'ads_health_o1',
    evidence: { currency: null, target_level: hold.level },
  })
  if (outcome.kind !== 'pending_approval') {
    return { wroteMeta: false, readbackCents: null, reason: outcome.humanReason ?? '没有排上，没有改。' }
  }
  const run = outcome.run
  if (!run.authorization_decision_id) {
    return { wroteMeta: false, readbackCents: null, reason: '没有审批编号，没有改。' }
  }
  assertActorMayApproveAction(run, access.tier)
  const approval = await approveRun(kernel, run.id, access.user.email, { expectedDecisionId: run.authorization_decision_id })
  if (approval.verdict !== 'allow') {
    return { wroteMeta: false, readbackCents: null, reason: approval.decision.reason }
  }
  const approved = await kernel.requireRun(run.id)
  if (approved.status !== 'authorized' || !approved.authorization_decision_id) {
    return { wroteMeta: false, readbackCents: null, reason: '批准没有落成，没有改。' }
  }
  const decision = await getDecision(supabaseAdmin, approved.authorization_decision_id)
  if (!decision || decision.action_run_id !== approved.id || decision.verdict !== 'allow' || decision.decided_by !== 'human') {
    return { wroteMeta: false, readbackCents: null, reason: '找不到人工批准记录，没有改。' }
  }
  await inngest.send({ name: ADS_O1_BUDGET_SCALE_APPROVED, data: { client_id: clientId, action_run_id: approved.id } })
  return { wroteMeta: false, queued: true, readbackCents: null, reason: '已排队，回读在执行之后。' }
}
