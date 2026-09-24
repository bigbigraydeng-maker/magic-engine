/**
 * Capability · `ads.scale_unit_budget`
 *
 * 放一个投放单位的日预算。信封分类 `budget_change`；**这是放类动作**，
 * 信封要过「改完不超日上限」和「变动比例 ≤ 20%」两条判据（authorize/gateway
 * 两处已判过），capability 层不再重判，直接照 input.after_cents 写。
 *
 * 撤回路径 = 用改前快照里的 daily_budget 写回去。
 *
 * 🔴 幂等：Meta 的 `POST /:adset_id { daily_budget }` 反复调无害
 *    （providerIdempotency: 'unsupported'，但业务上写同一个预算是幂等的）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { RetryableCapabilityError } from '@/lib/kernel/errors'
import { getAdSetStatus, setAdSetDailyBudget } from '@/lib/meta/adsets'
import { makeReadbackVerification, makeSnapshotPreStep, requireMetaToken } from './common'

function adsetId(step: CapabilityStepContext): string {
  const raw = (step.runInput as { adset_id?: unknown }).adset_id
  if (typeof raw !== 'string' || !raw) throw new RetryableCapabilityError('input 里没有 adset_id')
  return raw
}

function afterCents(step: CapabilityStepContext): number {
  const raw = (step.runInput as { after_cents?: unknown }).after_cents
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new RetryableCapabilityError('input 里没有有效的 after_cents')
  }
  return Math.round(raw)
}

/** 撤回处理：把广告组日预算写回它改前的样子。 */
async function rollbackHandler(
  step: CapabilityStepContext,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const id = adsetId(step)
  const prior = priorOutputs.apply?.prior_daily_budget_cents
  if (typeof prior !== 'number') {
    // handler 一次都没跑到 provider 调用之前 —— 没什么可撤的。
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: 'apply 没落到 prior_daily_budget_cents，没写 Meta，不需撤' },
    }
  }

  const token = await requireMetaToken(step.ctx.clientId)
  const ok = await setAdSetDailyBudget(id, token, prior)
  if (!ok) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { adset_id: id, restored_cents: prior },
      failure_reason: 'Meta 返回 success=false，可能受平台节流',
    }
  }
  return {
    ok: true,
    rollbackKind: 'provider_native',
    detail: { adset_id: id, restored_cents: prior },
  }
}

export function createScaleUnitBudgetCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.scale_unit_budget',
    version: 1,
    steps: {
      snapshot_pre: makeSnapshotPreStep(sb),

      /** 读改前预算，写新预算。改前预算**必须留在 output 里**——撤回要用。 */
      async apply(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const id = adsetId(step)
        const newCents = afterCents(step)
        const token = await requireMetaToken(step.ctx.clientId)

        // 🔴 先读一次现状：**不是**为了信封 —— 信封已由 gateway.ts 在这一步之前调 `preProviderEnvelopeBlockReason` 用 kernel_pre 快照重算过了。
        //    这里读现状**只**为撤回留证据（handler 里读的是 provider 当下的值，snapshot 里读的是几秒前的值，两者可能因人工改动短暂不一致）。
        //    读失败 = 环境类，重试。
        const before = await getAdSetStatus(id, token)
        if (!before) throw new RetryableCapabilityError(`读不到广告组 ${id} 的当前状态`)

        const beforeCents = before.daily_budget ? parseInt(before.daily_budget, 10) : null
        if (beforeCents === null) {
          throw new RetryableCapabilityError(`Meta 没回 daily_budget，可能这个组是 CBO 系列下的`)
        }

        const ok = await setAdSetDailyBudget(id, token, newCents)
        if (!ok) {
          // Meta 返回 success=false 通常是权限 / 令牌 / 短期节流。可重试。
          throw new RetryableCapabilityError(`改广告组 ${id} 日预算失败：Meta 返回 success=false`)
        }
        return {
          output: {
            adset_id: id,
            applied: true,
            prior_daily_budget_cents: beforeCents,
            new_daily_budget_cents: newCents,
          },
        }
      },

      /** 回读 Meta 真实预算，跟「新预算」比对。Meta 的静默强停就在这里被抓住。 */
      async readback(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const id = adsetId(step)
        const newCents = afterCents(step)
        const token = await requireMetaToken(step.ctx.clientId)
        const current = await getAdSetStatus(id, token)
        if (!current) throw new RetryableCapabilityError(`回读广告组 ${id} 失败`)

        const currentCents = current.daily_budget ? parseInt(current.daily_budget, 10) : null
        const verification = makeReadbackVerification({ daily_budget: newCents }, { daily_budget: currentCents })
        return {
          output: { adset_id: id, daily_budget_now: currentCents },
          verification,
        }
      },
    },
    rollback: rollbackHandler,
  }
}
