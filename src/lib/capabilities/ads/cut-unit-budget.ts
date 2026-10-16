/**
 * Capability · `ads.cut_unit_budget`
 *
 * 砍一个投放单位的日预算。信封分类 `budget_change`；authorize/gateway 两处
 * 按 AI 或人工规则检查。实际写入前再次确认只减不增，防止快照之后预算又被下调。
 * **这是收类动作**。
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
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
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

export function createCutUnitBudgetCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.cut_unit_budget',
    version: 1,
    steps: {
      snapshot_pre: makeSnapshotPreStep(sb),

      /** 读改前预算，写新预算。改前预算**必须留在 output 里**——撤回要用。 */
      async apply(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const id = adsetId(step)
        const newCents = afterCents(step)
        const token = await requireMetaToken(step.ctx.clientId)

        // 🔴 先读一次现状：**不是**为了信封 —— 信封已由 gateway.ts 在这一步之前调 `preProviderEnvelopeBlockReason` 用 kernel_pre 快照重算过了。
        //    这里读取实时值作撤回依据，并再次防止旧计划反向增加已被下调的预算。
        //    读失败 = 环境类，重试。
        const before = await getAdSetStatus(id, token)
        if (!before) throw new RetryableCapabilityError(`读不到广告组 ${id} 的当前状态`)

        const rawBudget = before.daily_budget?.trim() ?? ''
        const beforeCents = /^\d+$/.test(rawBudget) ? Number(rawBudget) : Number.NaN
        if (!Number.isSafeInteger(beforeCents) || beforeCents < 0) {
          throw new RetryableCapabilityError('Meta 没回有效的 daily_budget，无法确认减预算方向')
        }
        if (newCents > beforeCents) {
          throw new KernelError('INVALID_INPUT', '当前预算已低于计划金额，这次减预算会反向加钱，已停止执行')
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
          output: { applied: true, adset_id: id, daily_budget_now: currentCents },
          verification,
        }
      },
    },
    rollback: rollbackHandler,
  }
}
