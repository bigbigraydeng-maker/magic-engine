/**
 * Kernel 审批应用层 —— 类型契约（K-WP01A · Issue #881）。
 *
 * 🔴 这一层是**审批**，不是**执行**。
 *
 *    它能做的只有两件事：把「在等人点头」的动作如实读出来，以及把人的决定
 *    （同意 / 不做）交给 Kernel 的授权段落库。批准之后这条动作停在
 *    `authorized`，**没有任何 capability 被调用、没有任何步骤开始、
 *    没有任何对客户之外的写入**。真正把它跑掉是 WP07 的事。
 *
 *    依赖方向由此固定：本模块只 import Kernel 的**授权段**
 *    （`kernel/authorize` · `kernel/registry` · `kernel/store` · `kernel/deps`），
 *    **不 import** `kernel/runner`、`kernel/gateway`、`@/lib/capabilities`，
 *    也不 import `@/lib/kernel` 那个门面（它会把 capability 层整个拉进来）。
 *    有一条架构测试盯着这条边界。
 */

import type { AccessTier } from '@/lib/auth/access-types'
import type { ActionPurpose, RunStatus, SideEffectClass, RiskLevel } from '@/lib/kernel/types'

/**
 * 一条等人点头的动作，摘要形态（列表用）。
 *
 * 🔴 `expectedDecisionId` 是这份数据的**版本号**：审批人提交决定时必须原样带回来。
 *    带回来的跟服务端此刻看到的对不上 = 他看的是旧的一版，一律拒绝（见 service.ts）。
 */
export interface PendingApprovalSummary {
  readonly runId: string
  readonly clientId: string
  /** 提交决定时必须原样回传。它就是 `action_runs.authorization_decision_id`。 */
  readonly expectedDecisionId: string
  readonly actionKey: string
  readonly actionVersion: number
  readonly purpose: ActionPurpose
  readonly goalId: string | null
  /**
   * 动作词汇表字段 —— 全部从 `ACTION_REGISTRY` 派生（K-WP02 冻结的那套词汇）。
   * 注册表认不出这个 action_key 时全部为 null，**不编**。
   */
  readonly title: string | null
  readonly risk: RiskLevel | null
  readonly sideEffect: SideEffectClass | null
  readonly requiredCapabilityTier: AccessTier | null
  readonly costEstimateUsd: number | null
  readonly costCapUsd: number | null
  readonly rationale: string | null
  readonly requestedAt: string
}

/** 详情：摘要 + 提交的入参 + 当初那份审批请求本身。 */
export interface PendingApprovalDetail extends PendingApprovalSummary {
  readonly input: Record<string, unknown>
  readonly evidence: Record<string, unknown>
  readonly status: RunStatus
  readonly decision: {
    readonly id: string
    readonly reason: string
    readonly policyId: string | null
    readonly policyVersion: number | null
    readonly createdAt: string
  }
}

/** 人的决定。**只有这三个字段能来自请求体。** */
export interface ApprovalDecisionInput {
  readonly resolution: 'approve' | 'reject'
  readonly expectedDecisionId: string
  /** 拒绝时必填；批准时可选。 */
  readonly reason?: string
}

/**
 * 决定的结果。
 *
 * 🔴 `finalStatus` 只可能是这两个值之一 —— 批准的终点是 `authorized`
 *    （**不是** `running`，更不是 `succeeded`），拒绝的终点是 `denied`。
 *    类型在这里就把「批准顺手跑掉了」表达不出来。
 */
export interface ApprovalDecisionResult {
  readonly runId: string
  readonly finalStatus: 'authorized' | 'denied'
  /** 这次新签的那条 append-only 决策。 */
  readonly decisionId: string
  readonly decidedBy: string
  readonly reason: string
}
