/**
 * POST /api/clients/[id]/marketing-plan/[planId]/approve
 *
 * 批准 Plan：
 *   1. 把 status 从 draft → approved
 *   2. 调用 task-dispatcher 把 plan_data.tasks 批量插入 execution_items
 *   3. 返回派发结果
 *
 * 幂等性：如果 Plan 已是 approved 状态，返回当前状态，不重复派发。
 * 重试安全：派发中途失败时计划保持 draft，再点一次只会补派还没派过的任务
 * （dispatchPlanTasks 按「标题+截止日」跳过已存在的）。
 * 保证强度：应用层；两个人「同时」点批准仍可能各派一份内部待办（设计稿 §0.1，PM 已接受）。
 * 实际逻辑在 lib/marketing-plan/approve-plan.ts（处方「同意」随批计划共用同一份）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { approvePlan } from '@/lib/marketing-plan/approve-plan'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePlanApproverAccess } from '@/lib/auth/client-access'

export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  const denied = await rejectAgentAdsBearer(_req, {
    clientId: params.id,
    action: 'approve',
    resourceId: params.planId,
  })
  if (denied) return denied

  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const result = await approvePlan({
      clientId: params.id,
      planId: params.planId,
      approvedBy: access.user.email ?? null,
    })
    switch (result.kind) {
      case 'not_found':
        return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
      case 'already_approved':
        return NextResponse.json({
          success: true,
          plan: result.plan,
          already_approved: true,
          existing_task_count: result.existingTaskCount,
        })
      case 'not_draft':
        return NextResponse.json({
          success: false,
          error: `Cannot approve a plan with status="${result.status}". Only drafts can be approved.`,
        }, { status: 400 })
      case 'invalid_spec':
        return NextResponse.json({ success: false, error: '推广计划结构不合法，不能批准', issues: result.issues }, { status: 400 })
      case 'blocked':
        return NextResponse.json({
          success: false,
          error: '检查清单有没过的硬门，暂时不能批准',
          blockers: result.blockers.map(b => ({ key: b.key, label: b.label, light: b.light, reason: b.reason, how: b.how, phase_id: b.phase_id, phase_name: b.phase_name })),
        }, { status: 409 })
      case 'conflict':
        return NextResponse.json({ success: false, error: result.error }, { status: result.status })
      case 'approved':
        return NextResponse.json({ success: true, plan: result.plan, dispatch: result.dispatch, receipt: result.receipt })
      default:
        // needs_confirmation only comes back when requireAllGreen is set; this route never sets it.
        return NextResponse.json({ success: false, error: 'Unexpected approval result' }, { status: 500 })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[marketing-plan approve] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
