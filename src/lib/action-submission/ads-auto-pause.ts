/**
 * `ads.auto_pause_on_d3` → 受治理的 Kernel submission + 一键批准执行。
 *
 * 🔴 **为什么这个文件既提交又批准执行**（跟 GEO 的
 *    `submitPageOptimizationRequest` 分工不同）：通用审批面
 *    （`src/lib/kernel-approval/**`）有架构测试锁死**不许**出现任何执行入口
 *    （`approveAndRun` 在禁用清单里）——那条闸的目的是保证"批准之后一步都
 *    不会自动跑"，因为 WP07（批准之后谁来真正执行）通用还没建。
 *
 *    但 PM 2026-09-22 对这一个动作明确要的是"一键批准"：待办卡片上点一下
 *    "批准"要**立刻执行**，不用另外再点"运行"。所以本文件是这一个动作
 *    专属的、绕过通用审批面走的 caller——它活在 `action-submission/`
 *    （`boundaries.ts` 的 `KERNEL_RUNNER_ALLOWED_CALLER_DIRS` 允许这里
 *    import `runAction` / `approveAndRun` / `rejectPendingRun`），不在
 *    `kernel-approval/` 下，所以不受那条"零执行入口"的架构测试约束。
 *
 * 🔴 只处理这一个 actionKey——不是通用 caller，不接别的动作。
 */

import { runAction, approveAndRun, rejectPendingRun } from '@/lib/kernel/runner'
import { KernelError } from '@/lib/kernel/errors'
import { isUuid } from '@/lib/validation-utils'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'

import { ADS_AUTO_PAUSE_ACTION_KEY } from './ads-auto-pause-key'

export { ADS_AUTO_PAUSE_ACTION_KEY }

export interface AdsAutoPauseCandidateInput {
  readonly clientId: string
  readonly adAccountId: string
  readonly adsetId: string
  readonly diagnosisCode: string
  readonly insightDate: string
  readonly triggeredByRef: string
  /** 一句话说清依据（进 `action_runs.rationale`，今日待办直接能读）。 */
  readonly rationale: string
  /** 诊断结论摘要（进 `action_runs.evidence`，纯展示，不参与判定）。 */
  readonly evidence: Record<string, unknown>
}

/**
 * 结构化提交结果——只有 `pending_approval` 是「成功排上了」。
 * 其余一律结构化 non-success，不粉饰。
 */
export type SubmitAdsAutoPauseResult =
  | { readonly ok: true; readonly outcome: 'pending_approval'; readonly runId: string; readonly authorizationDecisionId: string }
  | { readonly ok: true; readonly outcome: 'idempotent_hit'; readonly runId: string }
  | { readonly ok: false; readonly reason: 'kernel_denied'; readonly runId: string; readonly humanReason: string | null }
  | { readonly ok: false; readonly reason: 'kernel_dead_letter'; readonly runId: string; readonly humanReason: string | null }
  | { readonly ok: false; readonly reason: 'kernel_unexpected_outcome'; readonly runId: string; readonly outcomeKind: ActionRunOutcome['kind'] }
  | { readonly ok: false; readonly reason: 'kernel_inconsistent_pending_approval'; readonly runId: string }

export async function submitAdsAutoPauseCandidate(
  deps: KernelDeps,
  input: AdsAutoPauseCandidateInput,
): Promise<SubmitAdsAutoPauseResult> {
  const submitInput: SubmitActionInput = {
    clientId: input.clientId,
    actionKey: ADS_AUTO_PAUSE_ACTION_KEY,
    purpose: 'maintenance',
    triggeredBy: 'signal',
    triggeredByRef: input.triggeredByRef,
    rationale: input.rationale,
    evidence: input.evidence,
    input: {
      ad_account_id: input.adAccountId,
      adset_id: input.adsetId,
      diagnosis_code: input.diagnosisCode,
      insight_date: input.insightDate,
    },
  }

  const outcome = await runAction(deps, submitInput)
  return interpretOutcome(outcome)
}

function interpretOutcome(outcome: ActionRunOutcome): SubmitAdsAutoPauseResult {
  const runId = outcome.run.id

  if (outcome.kind === 'pending_approval') {
    const decisionId = outcome.run.authorization_decision_id
    // 🔴 跟 GEO caller 同一条判据：待批准 run 没挂 decision id，待办卡片
    //    没法安全带上 expectedDecisionId 去点批准——如实标出，不假装能批。
    if (!decisionId) return { ok: false, reason: 'kernel_inconsistent_pending_approval', runId }
    return { ok: true, outcome: 'pending_approval', runId, authorizationDecisionId: decisionId }
  }
  if (outcome.kind === 'idempotent_hit' || outcome.kind === 'in_progress') {
    return { ok: true, outcome: 'idempotent_hit', runId }
  }
  if (outcome.kind === 'denied') {
    return { ok: false, reason: 'kernel_denied', runId, humanReason: outcome.humanReason }
  }
  if (outcome.kind === 'dead_letter') {
    return { ok: false, reason: 'kernel_dead_letter', runId, humanReason: outcome.humanReason }
  }
  // succeeded 不该在「刚提交」这条路上出现（提交即执行只会发生在已授权复用时，
  // 而这个动作要求 require_approval，提交阶段不会走到 auto allow）。
  return { ok: false, reason: 'kernel_unexpected_outcome', runId, outcomeKind: outcome.kind }
}

export interface ApproveAndExecuteResult {
  readonly runId: string
  readonly kind: ActionRunOutcome['kind']
  readonly humanReason: string | null
}

/**
 * 🔴 审批人页面上看到的那份审批请求 id —— **运行时**也要校验。
 *    请求体里的 JSON 不受 TypeScript 约束；这里一旦漏成 undefined，Kernel 会
 *    静默退回「服务端重读当前那份」再照批（`human-approval.ts` 的老行为），
 *    也就是替人批了他没看见的东西。所以缺了 / 形态不对一律当场抛，不往下走。
 */
function requireSeenDecisionId(expectedDecisionId: unknown): string {
  if (typeof expectedDecisionId !== 'string' || !isUuid(expectedDecisionId.trim())) {
    throw new KernelError(
      'INVALID_INPUT',
      '没有带上你页面上看到的那份审批请求 —— 没法确认你批的是你看见的那一件，这次没有生效。刷新一下再点',
    )
  }
  return expectedDecisionId.trim().toLowerCase()
}

/**
 * PM/FDE 在待办卡片上点「批准」——签批准 + 立刻执行，一次调用。
 *
 * `approvedByUser` 必须来自服务端认证会话（登录邮箱），**绝不**信请求体。
 * `expectedDecisionId` 必须是页面渲染那一刻拿到的那份；对不上 Kernel 在写库前就拒。
 */
export async function approveAndExecuteAdsAutoPause(
  deps: KernelDeps,
  runId: string,
  approvedByUser: string,
  expectedDecisionId: string,
): Promise<ApproveAndExecuteResult> {
  const seen = requireSeenDecisionId(expectedDecisionId)
  const outcome = await approveAndRun(deps, runId, approvedByUser, { expectedDecisionId: seen })
  return { runId: outcome.run.id, kind: outcome.kind, humanReason: outcome.humanReason }
}

/** PM/FDE 点「驳回」——只签拒绝，不执行任何东西。拒的也必须是人看到的那份。 */
export async function rejectAdsAutoPause(
  deps: KernelDeps,
  runId: string,
  rejectedByUser: string,
  reason: string,
  expectedDecisionId: string,
): Promise<ApproveAndExecuteResult> {
  const seen = requireSeenDecisionId(expectedDecisionId)
  const outcome = await rejectPendingRun(deps, runId, rejectedByUser, reason, { expectedDecisionId: seen })
  return { runId: outcome.run.id, kind: outcome.kind, humanReason: outcome.humanReason }
}
