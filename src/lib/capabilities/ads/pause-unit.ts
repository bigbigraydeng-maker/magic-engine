/**
 * Capability · `ads.pause_unit`
 *
 * 把一个投放单位（广告组）暂停。**只会让花费变少**，所以信封分类是 `pause`：
 * 不走「变动不超过 20%」、不走「改完不超日上限」两条判据。
 *
 * 语义边界：这是**收类**动作，PM 2026-09-24 授权可自动做。
 * 撤回路径 = 用改前快照里的状态调 Meta 写回去（如果改前是 ACTIVE 就重新激活）。
 *
 * 🔴 幂等：Meta 的 `POST /:adset_id { status: PAUSED }` 反复调无害
 *    （providerIdempotency: 'unsupported'，但业务上暂停本身是幂等的）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { RetryableCapabilityError } from '@/lib/kernel/errors'
import { getAdSetStatus, setAdSetStatus } from '@/lib/meta/adsets'
import { makeReadbackVerification, makeSnapshotPreStep, requireMetaToken } from './common'

function adsetId(step: CapabilityStepContext): string {
  const raw = (step.runInput as { adset_id?: unknown }).adset_id
  if (typeof raw !== 'string' || !raw) throw new RetryableCapabilityError('input 里没有 adset_id')
  return raw
}

/** 撤回处理：把广告组状态写回它改前的样子（改前是 ACTIVE 就重新激活）。 */
async function rollbackHandler(
  step: CapabilityStepContext,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const id = adsetId(step)
  const priorStatus = priorOutputs.apply?.prior_effective_status
  if (typeof priorStatus !== 'string') {
    // handler 一次都没跑到 provider 调用之前 —— 没什么可撤的。
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: 'apply 步没落到 prior_effective_status → 没写 Meta，不需撤' },
    }
  }
  // 🔴 只在改前**在投**的情况下重新激活；改前就是 PAUSED 或其他非 delivering
  //    状态的话，撤回等于不做（否则会「撤回」出一个从来不在投的东西）。
  const restore = priorStatus === 'ACTIVE' ? 'ACTIVE' : null
  if (!restore) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: `改前状态是 ${priorStatus}，不是 ACTIVE，撤回等于不做` },
    }
  }

  const token = await requireMetaToken(step.ctx.clientId)
  const ok = await setAdSetStatus(id, token, 'ACTIVE')
  if (!ok) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { adset_id: id, tried_status: 'ACTIVE' },
      failure_reason: `重新激活广告组 ${id} 失败：Meta 返回 success=false（可能被平台强停）`,
    }
  }
  return {
    ok: true,
    rollbackKind: 'provider_native',
    detail: { adset_id: id, restored_status: 'ACTIVE' },
  }
}

export function createPauseUnitCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.pause_unit',
    version: 1,
    steps: {
      snapshot_pre: makeSnapshotPreStep(sb),

      /** 读改前状态，写 PAUSED。改前状态**必须留在 output 里**——撤回要用。 */
      async apply(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const id = adsetId(step)
        const token = await requireMetaToken(step.ctx.clientId)

        // 🔴 先读一次现状：**不是**为了信封 —— 信封已由 gateway.ts 在这一步之前调 `preProviderEnvelopeBlockReason` 用 kernel_pre 快照重算过了。
        //    这里读现状**只**为撤回留证据（handler 里读的是 provider 当下的值，snapshot 里读的是几秒前的值，两者可能因人工改动短暂不一致）。
        //    读失败 = 环境类，重试。
        const before = await getAdSetStatus(id, token)
        if (!before) throw new RetryableCapabilityError(`读不到广告组 ${id} 的当前状态`)

        const ok = await setAdSetStatus(id, token, 'PAUSED')
        if (!ok) {
          // Meta 返回 success=false 通常是权限 / 令牌 / 短期节流。可重试。
          throw new RetryableCapabilityError(`暂停广告组 ${id} 失败：Meta 返回 success=false`)
        }
        return {
          output: {
            adset_id: id,
            applied: true,
            prior_effective_status: before.status,
          },
        }
      },

      /** 回读 Meta 真实状态，跟「PAUSED」比对。Meta 的静默强停就在这里被抓住。 */
      async readback(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const id = adsetId(step)
        const token = await requireMetaToken(step.ctx.clientId)
        const current = await getAdSetStatus(id, token)
        if (!current) throw new RetryableCapabilityError(`回读广告组 ${id} 失败`)

        const verification = makeReadbackVerification({ status: 'PAUSED' }, { status: current.status })
        return {
          output: { applied: true, adset_id: id, status_now: current.status },
          verification,
        }
      },
    },
    rollback: rollbackHandler,
  }
}
