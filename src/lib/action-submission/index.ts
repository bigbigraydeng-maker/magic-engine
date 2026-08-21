/**
 * PageOptimizationRequest → 受治理的 Kernel submission —— 实现。
 *
 * 详见 `docs/specs/2026-08-19-me2-page-optimization-request-caller-v1.0.md`。
 *
 * 🔴 这个文件**唯一**的公开产出：
 *    · `submitPageOptimizationRequest(deps, input)` —— 平台级 caller
 *    · `createDefaultDeps(kernelDeps)` —— 生产默认接线（把 mapper 与 runAction
 *      默认接到 `mapCandidateIdentity` / `runAction`）
 *
 *    没有 UI 入口、没有 API route、没有 cron —— 触发端由消费方自己拼
 *    （Customer Zero trigger script 等；本 PR 不含）。
 *
 * 🔴 本文件**不 hardcode**：
 *    · ActionKey 字面量（"page.apply_optimization_request" 或其它）
 *    · `{domain, intent}` 字面量（GEO / 任何其它域的语义）
 *    · 客户 ID
 *    · 页面 URL
 *    这几条都是架构测试盯着的（见 `kernel/__tests__/architecture.test.ts`）。
 */

import { mapCandidateIdentity } from '@/lib/action-bridge'
import { runAction } from '@/lib/kernel/runner'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'
import type {
  PageOptimizationRequestCallerDeps,
  SubmitPageOptimizationRequestInput,
  SubmitPageOptimizationRequestResult,
} from './types'

export type {
  PageOptimizationRequestCallerDeps,
  SubmitPageOptimizationRequestInput,
  SubmitPageOptimizationRequestResult,
  CandidateIdentity,
} from './types'

/**
 * 生产默认接线：mapper = 真实 `mapCandidateIdentity`；runAction = 真实 `runAction`。
 *
 * 🔴 单独抽出来是为了让**测试**能只替换其中一项、也能全替换 —— 而不用把
 *    caller 拆成一堆参数。
 */
export function createDefaultDeps(kernelDeps: KernelDeps): PageOptimizationRequestCallerDeps {
  return {
    kernelDeps,
    mapCandidate: mapCandidateIdentity,
    runAction,
  }
}

/**
 * 提交一份 `PageOptimizationRequest`。
 *
 * 步骤（跟 spec §3 一一对应，绝不多做一件）：
 *   1. assert `request.clientId === kernelMeta.clientId`
 *   2. assert `request.basedOnVersion.known === true`
 *   3. 调 `deps.mapCandidate(input.candidateIdentity)`
 *   4. bridge rejected → 返回 `{ok:false, reason:'bridge_rejected', ...}`
 *   5. bridge mapped → 构造 `SubmitActionInput`，调 `deps.runAction(...)`
 *   6. 按 Kernel outcome 分派：只有 `pending_approval` 是 success
 *
 * 🔴 Kernel `KernelError` **原样抛**（不吞、不改） —— 触发端决定怎么呈现。
 */
export async function submitPageOptimizationRequest(
  deps: PageOptimizationRequestCallerDeps,
  input: SubmitPageOptimizationRequestInput,
): Promise<SubmitPageOptimizationRequestResult> {
  const { request, kernelMeta, precomputed, candidateIdentity } = input

  // ① 客户归属必须一致。二选一是最容易出跨客户串台的地方，不许猜。
  if (request.clientId !== kernelMeta.clientId) {
    return {
      ok: false,
      reason: 'client_id_mismatch',
      requestClientId: request.clientId,
      kernelMetaClientId: kernelMeta.clientId,
    }
  }

  // ② basedOnVersion 必须已知 —— unknown 表示上游没拿到 page version token，
  //    这时构造 SubmitActionInput.input.page_version_token 只有两种选择：
  //    fail closed，或者编一个值。编值就是把「不知道」表示成「知道」，是
  //    「查不到 = 空 = 通过」这一类事故的翻版。
  if (!request.basedOnVersion.known) {
    return { ok: false, reason: 'basedOnVersion_unknown' }
  }

  // ③ Bridge —— 唯一的 ActionKey 来源。
  const mapping = deps.mapCandidate(candidateIdentity)
  if (mapping.outcome === 'rejected') {
    return {
      ok: false,
      reason: 'bridge_rejected',
      bridgeCode: mapping.code,
      bridgeReason: mapping.reason,
    }
  }
  if (
    mapping.submissionBoundary !== undefined &&
    mapping.submissionBoundary !== 'generic_page_optimization'
  ) {
    return { ok: false, reason: 'submission_boundary_mismatch' }
  }

  // ④ 构造 SubmitActionInput —— input 字段严格按 spec §7。
  //    intents / do_not_touch 保持 request 里的引用；WP01 已经保证 JSON-safe。
  const submitInput: SubmitActionInput = {
    clientId: kernelMeta.clientId,
    actionKey: mapping.actionKey,
    purpose: kernelMeta.purpose,
    goalId: kernelMeta.goalId ?? null,
    executionItemId: kernelMeta.executionItemId ?? null,
    triggeredBy: kernelMeta.triggeredBy,
    triggeredByRef: kernelMeta.triggeredByRef ?? null,
    rationale: kernelMeta.rationale ?? null,
    evidence: kernelMeta.evidence ?? {},
    ...(kernelMeta.correlationId ? { correlationId: kernelMeta.correlationId } : {}),
    input: {
      page_url: request.page.url,
      page_version_token: request.basedOnVersion.value,
      validated_diff_hash: precomputed.validatedDiffHash,
      intents: request.intents,
      do_not_touch: request.constraints.doNotTouch,
    },
  }

  // ⑤ 走 Kernel。KernelError 原样抛，不包一层。
  const outcome = await deps.runAction(deps.kernelDeps, submitInput)

  return interpretOutcome(outcome)
}

/**
 * 把 `ActionRunOutcome` 翻成 caller 的 result。
 *
 * 🔴 对 outward + require_approval 的 action，`runAction` 的正常出口**只有**
 *    `pending_approval`。其它 outcome 都视作意料之外 —— 不粉饰成成功。
 *    这条规则是 spec §8 的核心：Caller v1 不驱动执行，不"顺便"接住 execution 分支。
 */
function interpretOutcome(outcome: ActionRunOutcome): SubmitPageOptimizationRequestResult {
  const runId = outcome.run.id

  if (outcome.kind === 'pending_approval') {
    const decisionId = outcome.run.authorization_decision_id
    // 🔴 Approval Queue 的读路径要拿这一份 decision id 做归属核对
    //    （`decisionBelongsToRun` 的 7 条判据锚点）。库里 authorization_decision_id
    //    为空的 pending_approval run 会被 Queue **静默跳过**（进 skippedRunIds、
    //    不进 items）—— caller 若报 ok:true 承诺"能被人点头"，触发端去看队列时
    //    根本看不到。这是隐形失败，比 fail closed 危险得多。所以见到 null 时
    //    如实返回结构化 non-success，让触发端排查而不是等着一份永远不会出现的
    //    待办。
    if (!decisionId) {
      return { ok: false, reason: 'kernel_inconsistent_pending_approval', runId }
    }
    return {
      ok: true,
      outcome: 'pending_approval',
      runId,
      authorizationDecisionId: decisionId,
    }
  }

  if (outcome.kind === 'denied') {
    return {
      ok: false,
      reason: 'kernel_denied',
      runId,
      humanReason: outcome.humanReason,
    }
  }

  if (outcome.kind === 'dead_letter') {
    return {
      ok: false,
      reason: 'kernel_dead_letter',
      runId,
      humanReason: outcome.humanReason,
    }
  }

  // succeeded / idempotent_hit / in_progress —— 对本 caller 目标 action 都不该出现。
  // 出现 = 上游状态与预期不符（mapper 指向了内部动作 / 政策改成 auto_approve /
  // 有并发在跑 / 之前已跑过）。如实标出，不粉饰。
  return {
    ok: false,
    reason: 'kernel_unexpected_outcome',
    runId,
    outcomeKind: outcome.kind,
  }
}
