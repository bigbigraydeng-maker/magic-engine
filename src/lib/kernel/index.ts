/**
 * Magic Engine 2.0 · Execution Kernel —— 对外门面。
 *
 * 业务侧只需要这三样东西：
 *   · `createKernel(supabase)`  拿一套接好线的依赖
 *   · `runAction(...)`          提交一件事，走完 提交 → 授权 → 执行
 *   · `approveAndRun / rejectPendingRun`  人点头 / 人否决之后接着走
 *
 * 🔴 **不导出 capability 本身，也不导出造授权上下文的能力。**
 *    想让系统做事只有一条路：提交一个 action_run。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createCapabilities } from '@/lib/capabilities'
import { createKernelDeps, type KernelDeps, type KernelDepsInit } from './deps'
import { ACTION_REGISTRY } from './registry'

export function createKernel(
  supabase: SupabaseClient,
  overrides: Partial<Omit<KernelDepsInit, 'supabase'>> = {},
): KernelDeps {
  return createKernelDeps({
    supabase,
    registry: overrides.registry ?? ACTION_REGISTRY,
    capabilities: overrides.capabilities ?? createCapabilities(supabase),
    workerId: overrides.workerId,
    // 🔴 这两项以前接了不转发 —— 公开 API 上写着能配，实际永远是 300 秒 + 随机 owner。
    //    「参数类型收了它」和「行为真的变了」是两件事，有测试盯着后者。
    leaseSeconds: overrides.leaseSeconds,
    ownerId: overrides.ownerId,
    now: overrides.now,
    sleep: overrides.sleep,
  })
}

export { ACTION_REGISTRY, ACTION_KEYS } from './registry'
export { createKernelDeps } from './deps'
export type { KernelDeps, KernelDepsInit } from './deps'
export {
  runAction,
  submitActionRun,
  approveAndRun,
  rejectPendingRun,
  resumeDeadLetterRun,
  recoverDeniedRun,
  RECOVERABLE_DENY_CODES,
  type SubmitActionInput,
  type ActionRunOutcome,
  type ActionOutcomeKind,
} from './runner'
export { loadActionLineage, type ActionLineage } from './lineage'
export { fetchKernelHandoffTodos, type KernelHandoffTodo } from './handoff'
export { KernelError, type KernelErrorCode } from './errors'
export type {
  ActionDefinition,
  ActionKey,
  ActionPurpose,
  ActionRun,
  ActionRunStep,
  AuthorizationDecision,
  AuthorizedExecutionContext,
  ClientAutomationPolicy,
  PolicyMode,
  RunStatus,
  StepStatus,
  TriggeredBy,
  VerificationResult,
  Verdict,
} from './types'
