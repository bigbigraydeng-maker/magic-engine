/**
 * 加钱类动作的 PM 本人闸（第 3 刀 3a，`docs/specs/2026-11-03-ads-knife3-spend-gate-and-budget-buttons-design.md` §2）。
 *
 * 「加钱类」= 动作定义里 `spendIncrease === true`（加预算、挪预算的加的一侧、新建会花钱的东西）。
 * 不管客户策略表写的是不是自动，这类动作只有 PM 本人（`KernelDeps.isSpendApprover`）签的放行才能执行。
 *
 * 五道闸各自独立（删任一道都有测试红）：
 *   1. 策略同步写 `require_approval`（`ads-strategy/autonomy/sync-policy.ts`）
 *   2. 授权预检：自动策略直接拒（`authorize.ts` preflight）
 *   3. 签批准：批准人不在名单 → 抛错、不签（`human-approval.ts` approveRun）
 *   4. 复用旧授权：签字人不在名单 → 不复用（`authorize.ts` reuseLiveAuthorization）
 *   5. 执行前复核：签字人不在名单 → 停手（`gateway.ts` assertDecisionMatches）
 *
 * 🔴 缺判定（`deps.isSpendApprover` 为空）一律当「不是批准人」——fail closed。
 */

import type { KernelDeps } from './deps'
import type { ActionDefinition, ActionRun, AuthorizationDecision } from './types'
import { selectEnvelopeVerdict } from './autonomy-envelope'
import { KernelError } from './errors'

export const SPEND_APPROVER_ONLY_REASON = '加钱类动作（加预算 / 挪预算 / 新增花费）只有 PM 本人能批'

export function isSpendIncreaseAction(
  definition: Pick<ActionDefinition, 'spendIncrease'> | null | undefined,
): boolean {
  return definition?.spendIncrease === true
}

/** 这个邮箱能不能批加钱类动作。缺判定 / 空邮箱 → false。 */
export function isSpendApproverUser(deps: Pick<KernelDeps, 'isSpendApprover'>, email: string | null): boolean {
  if (!deps.isSpendApprover) return false
  if (typeof email !== 'string' || email.trim() === '') return false
  return deps.isSpendApprover(email)
}

/** 这份放行是不是 PM 本人点头签的。机器签的（`decided_by: 'policy'`）一律不算。 */
export function signedBySpendApprover(
  deps: Pick<KernelDeps, 'isSpendApprover'>,
  decision: Pick<AuthorizationDecision, 'decided_by' | 'decided_by_user'>,
): boolean {
  return decision.decided_by === 'human' && isSpendApproverUser(deps, decision.decided_by_user)
}

/**
 * 执行前复核（第 5 道，Gateway `assertDecisionMatches` 调用）：加钱类动作的放行必须是 PM 本人签的。
 * 机器签的、别人签的、绕过 approveRun 直接写进决策表的，一律抛错停手。
 */
export function assertSpendApproverSigned(
  definition: Pick<ActionDefinition, 'spendIncrease'>,
  decision: Pick<AuthorizationDecision, 'decided_by' | 'decided_by_user' | 'action_key'>,
  spendApproverSigned: boolean,
): void {
  if (!isSpendIncreaseAction(definition) || spendApproverSigned) return
  throw new KernelError(
    'NOT_AUTHORIZED',
    `${SPEND_APPROVER_ONLY_REASON}，这条的放行签字人是「${decision.decided_by_user ?? decision.decided_by}」—— 已停手`,
    { detail: { decidedBy: decision.decided_by, actionKey: decision.action_key, reason: 'spend_approver_only' } },
  )
}

/**
 * PM 批加钱类动作时，先按执行前会用的同一套「PM 放量信封」判一次（第 3 刀 3a §2.2-3）。
 *
 * 为什么批准时就要判：Gateway 碰 Meta 之前一定会再判；那时判不过，run 停成死信，
 * PM 以为批了、实际没动。先判、判不过就当场告诉 PM 是哪一条没过。
 * 非 bounded 动作 → null（不判）；缺解析器 / 读不到事实 → 返回原因（等同越界，fail closed）。
 */
export async function pmSpendEnvelopeBlockReason(
  deps: Pick<KernelDeps, 'resolveEnvelopeFacts'>,
  definition: ActionDefinition,
  run: Pick<ActionRun, 'id' | 'client_id' | 'action_key' | 'input' | 'triggered_by'>,
): Promise<string | null> {
  const approval = definition.outwardAuthorization?.approval
  if (definition.sideEffect !== 'outward' || approval?.mode !== 'bounded') return null
  if (!deps.resolveEnvelopeFacts) return '这个 Kernel 实例没装信封事实解析器，读不到真实预算'

  const resolved = await deps.resolveEnvelopeFacts({
    clientId: run.client_id,
    actionKey: run.action_key,
    input: (run.input ?? {}) as Record<string, unknown>,
    at: 'authorize',
    runId: run.id,
  })
  if ('unavailable' in resolved) return `读不到信封要的事实：${resolved.unavailable}`

  const verdict = selectEnvelopeVerdict({
    triggeredBy: run.triggered_by,
    actionKey: run.action_key,
    request: resolved.request,
    facts: resolved.facts,
    envelope: approval.envelope,
    pmApprovedSpendIncrease: true,
  })
  return verdict.within ? null : verdict.reasons.join('；')
}
