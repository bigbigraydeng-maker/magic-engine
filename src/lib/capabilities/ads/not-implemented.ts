/**
 * 广告支柱 IMPACT 闭环 · 阶段 2 · 内核注册（P21.K）—— 骨架 capability。
 *
 * 设计文档：`~/.claude/plans/ads-impact-loop-capability.md` §4.1/§4.2/§14.1（K1-K14）。
 *
 * 🔴 这四个动作（`ads.budget_move_plan` / `ads.add_retargeting_adset` /
 *    `ads.create_audience` / `ads.pause`）目前**只有契约声明**
 *    （`kernel/registry.ts`），没有真实执行逻辑。挪预算 / 建广告组 / 建受众 /
 *    暂停的真实实现（K8-K12）、Inngest 事件链、AD-ADV-1 留给 PR-B/PR-C，
 *    等 §4.1 的硬前置（预算锁、G8/#1080 安全修复、G15 归属表、
 *    AD-ADV-1）全部完成之后再接。
 *
 * 🔴 为什么现在也要注册一个"实现"（而不是留空）：`architecture.test.ts`
 *    「注册表的封闭性」这道闸要求 `createCapabilities()` 的实现集合跟
 *    `ACTION_KEYS` 完全对齐——注册了动作却没有实现 = 提交了会死信、
 *    Gateway 会用一句"还没有实现，跑不了"的 dead_letter 兜底。骨架实现
 *    比留空更诚实：任何一步真被调用时，立刻抛出一条说明"为什么现在做不了、
 *    真实逻辑在哪个 PR"的人话错误，而不是死信里一句语焉不详的通用文案。
 *
 * 🔴 目前没有任何调用方会提交这四个动作 —— 没有 `client_automation_policies`
 *    行、没有 caller、没有 UI。骨架实现在生产里**不会被真的调用**。
 *
 * 🔴 rollback handler 同样是骨架，且**始终 fail-closed**（`ok:false`）——
 *    绝不假装撤成功。真撤回逻辑没写出来之前，谎报"已撤回"比"拒绝撤回、
 *    转人工核对 Meta 上的真实状态"危险得多。
 */

import type {
  ActionKey,
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { KernelError } from '@/lib/kernel/errors'

function notYetImplementedStep(actionKey: ActionKey, stepKey: string) {
  return async (_step: CapabilityStepContext): Promise<CapabilityStepResult> => {
    throw new KernelError(
      'CAPABILITY_NOT_IMPLEMENTED',
      `「${actionKey}」的「${stepKey}」这一步还没有真实实现 —— 内核已经注册了这个动作的` +
        `契约（kernel/registry.ts），但执行逻辑留给后续 PR（PR-B/PR-C，见 ` +
        `~/.claude/plans/ads-impact-loop-capability.md §4.1 硬前置）。这次执行没有碰任何外部服务。`,
    )
  }
}

async function notYetImplementedRollback(
  step: CapabilityStepContext,
): Promise<OutwardRollbackResult> {
  return {
    ok: false,
    rollbackKind: 'provider_native',
    detail: { actionKey: step.ctx.actionKey, reason: 'rollback_not_yet_implemented' },
    failure_reason:
      '撤回执行器还没有真实实现（骨架阶段）—— 拒绝声称撤成功，需要人工核对 Meta 上的真实状态。' +
      '真实撤回逻辑留给 PR-B/PR-C（见 ~/.claude/plans/ads-impact-loop-capability.md §4.1）。',
  }
}

/**
 * 给一个还没接执行器的广告动作造一个"骨架" capability：
 * 每一步都明确失败（说清为什么、真实实现在哪），rollback 始终 fail-closed。
 */
export function createNotYetImplementedAdsCapability(
  actionKey: ActionKey,
  version: number,
  stepKeys: readonly string[],
): CapabilityImplementation {
  return {
    actionKey,
    version,
    steps: Object.fromEntries(
      stepKeys.map((stepKey) => [stepKey, notYetImplementedStep(actionKey, stepKey)]),
    ),
    rollback: notYetImplementedRollback,
  }
}
