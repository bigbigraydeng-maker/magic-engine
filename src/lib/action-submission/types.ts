/**
 * PageOptimizationRequest → 受治理的 Kernel submission —— 类型契约。
 *
 * 🔴 这一层的定位是**平台级 submission adapter**，不是 orchestrator：
 *    · 拿一份 request + 一个 candidate identity
 *    · 走 bridge 拿 ActionKey（禁止 hardcode）
 *    · 走 Kernel 的 runAction 做 submit + authorize progression
 *    · 只在 `pending_approval` 时返回 success；其余 outcome 一律结构化 non-success
 *
 * 🔴 这里**不 import** 任何域模块，也不 hardcode `{domain:'geo', ...}` ——
 *    触发端负责传对应的 `CandidateIdentity`（见 spec §5）。
 *
 * 🔴 依赖注入是刻意的：`mapCandidate` 与 `runAction` 都从 deps 里进来。
 *    生产默认接线到真实的 `mapCandidateIdentity` / `runAction`；
 *    tests 注入合成 mapper + 相同真实 `runAction`（对着 fake supabase + 合成
 *    outward registry 跑），这样 caller 的行为不依赖 mapping table 有没有真实
 *    映射条目 —— 未 merge 的 #1097 mapping 不能被拉进 caller PR。
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionPurpose, TriggeredBy } from '@/lib/kernel/types'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'
import type {
  CandidateIdentity,
  CandidateMappingRejectionCode,
  CandidateMappingResult,
} from '@/lib/action-bridge'
import type { PageOptimizationRequest } from '@/lib/page-optimization'


// Re-export the identity type so consumers of this module don't need to reach
// into action-bridge directly for a plain shape type.
export type { CandidateIdentity }

/**
 * Caller 的依赖包。
 *
 * 🔴 全部注入 —— caller 内部**不 import** `mapCandidateIdentity` / `runAction` 的
 *    默认导出并直接调用。默认接线在 `createDefaultDeps()` 里（见 `index.ts`），
 *    独立的一层。测试用自己的 deps。
 */
export interface PageOptimizationRequestCallerDeps {
  readonly kernelDeps: KernelDeps
  readonly mapCandidate: (identity: unknown) => CandidateMappingResult
  readonly runAction: (kd: KernelDeps, input: SubmitActionInput) => Promise<ActionRunOutcome>
}

/**
 * Caller 的输入。
 *
 * 🔴 `candidateIdentity` 由触发端显式传 —— shared caller 不 hardcode 语义。
 * 🔴 `clientId` 在 `kernelMeta` 与 `request` 里都出现，caller 会 assert 一致。
 *    不一致 = fail closed，不擅自二选一。
 * 🔴 `precomputed.validatedDiffHash` 由触发端算好传入 —— caller 不重跑 pipeline、
 *    不复制 hash 算法。权威 producer 在 #1097 branch，未 merge 前不引进来。
 */
export interface SubmitPageOptimizationRequestInput {
  readonly candidateIdentity: CandidateIdentity
  readonly request: PageOptimizationRequest
  readonly kernelMeta: {
    readonly clientId: string
    readonly purpose: ActionPurpose
    readonly goalId?: string | null
    readonly executionItemId?: string | null
    readonly triggeredBy: TriggeredBy
    readonly triggeredByRef?: string | null
    readonly rationale?: string | null
    readonly evidence?: Record<string, unknown>
    readonly correlationId?: string
  }
  readonly precomputed: {
    readonly validatedDiffHash: string
  }
}

/**
 * Caller 的返回。
 *
 * 🔴 **只有 `pending_approval` 是 success**（spec §3 / §8）。
 *    对 outward + require_approval 的 action，`runAction` 结构上就应该停在
 *    `pending_approval`。任何其它 outcome（`denied` / `dead_letter` /
 *    `succeeded` / `idempotent_hit` / `in_progress`）都是意料之外，caller
 *    不粉饰成成功。
 *
 * 🔴 fail-closed 的三种前置拒绝（`client_id_mismatch` / `basedOnVersion_unknown`
 *    / `bridge_rejected`）跟 Kernel 分派的三种非 pending outcome
 *    （`kernel_denied` / `kernel_dead_letter` / `kernel_unexpected_outcome`）
 *    是**六种独立**的失败 —— 合并成一个 `error` 会让触发端没法分开处置。
 */
export type SubmitPageOptimizationRequestResult =
  | {
      readonly ok: true
      readonly outcome: 'pending_approval'
      readonly runId: string
      /**
       * 🔴 **必须非空**。Approval Queue 的读路径要拿这一份 decision id 做归属核对
       *    （`decisionBelongsToRun` 里 7 条判据的锚点）。库里 `authorization_decision_id`
       *    为空的 pending_approval run 会被 Queue **静默跳过**（记进 `skippedRunIds`
       *    但不进 `items`）—— 那时 caller 报 `ok:true` = 承诺"能被人点头"，但触发端
       *    去看队列时根本看不到。这是隐形失败，比直接 fail closed 危险得多。
       *    所以这里的类型不接受 null；`interpretOutcome` 见到 null 会走
       *    `kernel_inconsistent_pending_approval` 分支。
       */
      readonly authorizationDecisionId: string
    }
  | {
      readonly ok: false
      readonly reason: 'client_id_mismatch'
      readonly requestClientId: string
      readonly kernelMetaClientId: string
    }
  | { readonly ok: false; readonly reason: 'basedOnVersion_unknown' }
  | { readonly ok: false; readonly reason: 'submission_boundary_mismatch' }
  | {
      readonly ok: false
      readonly reason: 'bridge_rejected'
      readonly bridgeCode: CandidateMappingRejectionCode
      readonly bridgeReason: string
    }
  | {
      readonly ok: false
      readonly reason: 'kernel_denied'
      readonly runId: string
      readonly humanReason: string | null
    }
  | {
      readonly ok: false
      readonly reason: 'kernel_dead_letter'
      readonly runId: string
      readonly humanReason: string | null
    }
  | {
      readonly ok: false
      readonly reason: 'kernel_unexpected_outcome'
      readonly runId: string
      readonly outcomeKind: ActionRunOutcome['kind']
    }
  | {
      /**
       * 🔴 Kernel 报 pending_approval，但 run 上没有 authorization_decision_id ——
       *    库里状态不一致。Approval Queue 会静默跳过它，触发端应视作**未真正进入
       *    审批队列**，需要人工排查后重新排一次，而不是当作 pending 等人点。
       */
      readonly ok: false
      readonly reason: 'kernel_inconsistent_pending_approval'
      readonly runId: string
    }
