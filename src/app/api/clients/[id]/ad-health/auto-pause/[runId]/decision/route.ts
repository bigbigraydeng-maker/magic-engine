/**
 * Ads D3 自动暂停——一键批准 / 驳回。
 *
 * POST { resolution: 'approve' | 'reject', expectedDecisionId: string, reason?: string }
 *
 * 🔴 `expectedDecisionId` = 页面渲染那一刻这条 run 挂着的审批请求 id（列表 GET 给的）。
 *    批准和驳回都必填：对不上 = 人看的是旧的一版，Kernel 在**任何写入之前**拒掉
 *    （409 STALE_DECISION），页面重拉列表让人重看。不传就不往 Kernel 走。
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
import { requirePlanApproverAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { KernelError } from '@/lib/kernel/errors'
import { approveAndExecuteAdsAutoPause, rejectAdsAutoPause, ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause'
import { assertActorMayApproveAction, parseExpectedDecisionId } from '@/lib/kernel-approval/service'
import { ApprovalError } from '@/lib/kernel-approval/errors'
import type { AccessTier } from '@/lib/auth/access-types'

export const dynamic = 'force-dynamic'

interface RouteParams { params: { id: string; runId: string } }

interface DecisionBody {
  resolution: 'approve' | 'reject'
  expectedDecisionId: string
  reason?: string
}

function parseBody(body: unknown): DecisionBody | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: '请求内容不是合法的 JSON 对象' }
  const record = body as Record<string, unknown>
  if (record.resolution !== 'approve' && record.resolution !== 'reject') return { error: 'resolution 只能是 approve 或 reject' }
  if (record.reason !== undefined && typeof record.reason !== 'string') return { error: 'reason 必须是文字' }
  let expectedDecisionId: string
  try {
    // 跟通用审批面同一套判据（非空 + uuid 形态 + 归一小写），不另写一份
    expectedDecisionId = parseExpectedDecisionId(record.expectedDecisionId)
  } catch (e) {
    return { error: e instanceof ApprovalError ? e.humanReason : '缺少 expectedDecisionId' }
  }
  return { resolution: record.resolution, expectedDecisionId, ...(record.reason ? { reason: record.reason } : {}) }
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

type Kernel = ReturnType<typeof createKernel>
type OwnedRun = Awaited<ReturnType<Kernel['requireRun']>>

/**
 * 归属核对：这条 run 必须真的属于这个客户、真的是这一个动作——不能拿
 * clientId 之外的 runId 来批别的客户/别的动作（跟 kernel-approval 的
 * decisionBelongsToRun 同一个道理，只是这里是单动作专属路由，判据更简单）。
 */
async function loadOwnedRun(kernel: Kernel, params: RouteParams['params']): Promise<OwnedRun | NextResponse> {
  let run: OwnedRun
  try {
    run = await kernel.requireRun(params.runId)
  } catch {
    return NextResponse.json({ error: '找不到这条动作' }, { status: 404 })
  }
  if (run.client_id !== params.id || run.action_key !== ADS_AUTO_PAUSE_ACTION_KEY) {
    return NextResponse.json({ error: '这条动作不属于这个客户，或不是自动暂停建议' }, { status: 403 })
  }
  return run
}

/**
 * 🔴 批准要过注册表定的档次 + 版本（通用审批面对这个动作不给批，这里是唯一的批准入口，
 *    门槛必须跟着注册表走，不能靠 requirePaidClientAccess 碰巧一样）。拒绝不过这道（不授权任何执行）。
 */
function approveGate(run: OwnedRun, tier: AccessTier): NextResponse | null {
  try {
    assertActorMayApproveAction(run, tier)
    return null
  } catch (e) {
    if (e instanceof ApprovalError) return NextResponse.json({ error: e.humanReason, code: e.code }, { status: 403 })
    throw e
  }
}

async function decide(kernel: Kernel, params: RouteParams['params'], body: DecisionBody, actorEmail: string): Promise<NextResponse> {
  try {
    if (body.resolution === 'reject') {
      const outcome = await rejectAdsAutoPause(kernel, params.runId, actorEmail, body.reason ?? '不批准', body.expectedDecisionId)
      await updateLedgerStatus(params.id, params.runId, 'rejected', { reason: outcome.humanReason })
      return NextResponse.json({ ok: true, kind: outcome.kind })
    }
    const outcome = await approveAndExecuteAdsAutoPause(kernel, params.runId, actorEmail, body.expectedDecisionId)
    // 🔴 只有确定的结果才记账：idempotent_hit 跟 succeeded 一样是**已经做完**
    //    （outcomeForSettledRun 只在 run.status === 'succeeded' 时才答 idempotent_hit，
    //    见 src/lib/kernel/runner.ts），必须同样记 paused、同样报成功，
    //    否则账表会永远停在 awaiting_approval、页面一直说「正在暂停」。
    //    真正未定的只有 in_progress（另一个执行者还没跑完）——结果未定就不动账，
    //    由真正执行的那一方记，这里记「失败」会是假账（广告马上就会停）。
    const status = outcome.kind === 'succeeded' || outcome.kind === 'idempotent_hit' ? 'paused' : outcome.kind === 'dead_letter' || outcome.kind === 'denied' ? 'failed' : null
    if (status) await updateLedgerStatus(params.id, params.runId, status, { reason: outcome.humanReason })
    return NextResponse.json({ ok: outcome.kind === 'succeeded' || outcome.kind === 'idempotent_hit', kind: outcome.kind, humanReason: outcome.humanReason })
  } catch (e) {
    if (e instanceof KernelError) {
      return NextResponse.json({ error: e.humanReason, code: e.code }, { status: 409 })
    }
    // 原始错误只进日志。🔴 不说「什么都没改」—— 失败可能发生在暂停之后（例如回写账表），结果未知就说未知
    console.error('[ad-health/auto-pause/decision] 未预期的失败:', e)
    return NextResponse.json({ error: '这次操作的结果不确定——刷新看这条还在不在列表里，别连着再点' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  // 批准和驳回都只给内部账号：客户自己的员工不该替自己的预算做决定。
  const access = await requirePlanApproverAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = parseBody(await req.json().catch(() => null))
  if ('error' in body) return NextResponse.json({ error: body.error }, { status: 400 })

  const kernel = createKernel(supabaseAdmin)
  const run = await loadOwnedRun(kernel, params)
  if (run instanceof NextResponse) return run

  const actorEmail = access.user.email
  if (!actorEmail) {
    return NextResponse.json({ error: '登录账号没有邮箱，无法记录是谁批准的' }, { status: 400 })
  }

  if (body.resolution === 'approve') {
    const denied = approveGate(run, access.tier)
    if (denied) return denied
  }
  return decide(kernel, params, body, actorEmail)
}
