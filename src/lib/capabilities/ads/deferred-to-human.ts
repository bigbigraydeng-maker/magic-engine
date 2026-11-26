/**
 * 三个「暂时先转人工」的广告动作的 stub capability。
 *
 * 涉及的动作（都已在注册表里、都声明成 bounded 自治）：
 *   · ads.budget_move_plan       —— 挪预算（先减后加、总额不变、多腿事务）
 *   · ads.add_retargeting_adset  —— 新建再营销广告组（要建广告组、绑受众、绑素材）
 *   · ads.swap_creative          —— 给广告换一个已批准的素材（要建 creative、切换 ad）
 *
 * 🔴 为什么先做 stub 而不是真实执行：
 *    这三个都要跨多个 Meta 对象、跨多次 API、涉及 audience/creative 域的封装
 *    （单独一个 PR 都装不下）。而注册表的封闭性测试要求「注册表里有的键，
 *    capability 一定要有实现」——所以先给一份**永远抛「转人工」**的 stub，
 *    让架构测试绿，功能上等于「这三个动作暂时不给 AI 自动做，PM 手动办」。
 *
 * 🔴 抛的是**非可重试**错误：这不是环境问题，是刻意不上线。走可重试的话
 *    Kernel 会一直重试到死信，然后落到 PM 待办里，反而误导。
 *
 * 撤回处理函数返回 noop：apply 抛错前根本没碰 Meta，没什么可撤的。
 *
 * 恢复条件：等三个动作各自的真实实现落地（跟 signals 已经在 memory 里）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActionKey,
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { KernelError } from '@/lib/kernel/errors'
import { makeSnapshotPreStep } from './common'

const REASON: Readonly<Record<string, string>> = {
  'ads.budget_move_plan':
    '挪预算涉及先减后加两腿事务，本轮先不上线自动执行；PM 手动按建议在 Ads Manager 里改',
  'ads.add_retargeting_adset':
    '新建再营销广告组要跨 audience/adset/ad 三层，本轮先不上线自动执行；PM 手动在 Ads Manager 里建',
  'ads.swap_creative':
    '往已有广告组加一条新的暂停广告，走暂停草稿确认卡，不走这个动作。给已经在投的广告换掉素材仍然先不自动执行。',
}

function deferredStep(actionKey: ActionKey) {
  return async function (_step: CapabilityStepContext): Promise<CapabilityStepResult> {
    // fail-final：不可重试，直接落到「需要 PM 动手」的三件套里。
    // 用 CAPABILITY_NOT_IMPLEMENTED（现有错误码里最贴切的一个）：
    // 意思是这个动作**注册表在、但执行器还没到位**，跟真的 bug 分开。
    // 死信到 handoff 后 PM 会看到三件套。
    throw new KernelError('CAPABILITY_NOT_IMPLEMENTED', REASON[actionKey] ?? '这个动作本轮不支持自动执行')
  }
}

async function noopRollback(_step: CapabilityStepContext, _prior: Readonly<Record<string, Record<string, unknown>>>): Promise<OutwardRollbackResult> {
  return {
    ok: true,
    rollbackKind: 'noop',
    detail: { reason: 'apply 抛错前没写 Meta，不需撤' },
  }
}

function createDeferredCapability(
  actionKey: ActionKey,
  sb: SupabaseClient,
): CapabilityImplementation {
  return {
    actionKey,
    version: 1,
    steps: {
      // 保留 snapshot_pre：让「AI 提了但没做」这件事也留下真实的改前快照。
      // 这样以后真实实现上线时，历史 pending 的处方可以直接拿这份快照做撤回参考。
      snapshot_pre: makeSnapshotPreStep(sb),
      apply: deferredStep(actionKey),
    },
    rollback: noopRollback,
  }
}

// budget_move_plan 走「先减后加」两条腿，跟其他两个不一样，多一个 step key。
// 名字要跟 registry-ads.ts 里声明的一致，不然 Gateway 找不到。
export function createBudgetMovePlanCapability(sb: SupabaseClient): CapabilityImplementation {
  const base = createDeferredCapability('ads.budget_move_plan', sb)
  return {
    ...base,
    steps: {
      snapshot_pre: base.steps.snapshot_pre,
      apply_decrease: deferredStep('ads.budget_move_plan'),
      apply_increase: deferredStep('ads.budget_move_plan'),
      readback: deferredStep('ads.budget_move_plan'),
    },
  }
}

export function createAddRetargetingAdsetCapability(sb: SupabaseClient): CapabilityImplementation {
  const base = createDeferredCapability('ads.add_retargeting_adset', sb)
  return {
    ...base,
    steps: {
      snapshot_pre: base.steps.snapshot_pre,
      create_paused: deferredStep('ads.add_retargeting_adset'),
      readback: deferredStep('ads.add_retargeting_adset'),
      activate: deferredStep('ads.add_retargeting_adset'),
    },
  }
}

export function createSwapCreativeCapability(sb: SupabaseClient): CapabilityImplementation {
  return createDeferredCapability('ads.swap_creative', sb)
}
