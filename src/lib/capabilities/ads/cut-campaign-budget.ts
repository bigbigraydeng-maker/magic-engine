/** Capability · lower a CBO campaign's daily budget with a guarded rollback. */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import { canonicalAccountDigits, findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'
import { makeReadbackVerification, makeSnapshotPreStep, requireMetaToken } from './common'

function input(step: CapabilityStepContext) {
  const value = step.runInput as { campaign_id?: unknown; ad_account_id?: unknown; after_cents?: unknown }
  if (typeof value.campaign_id !== 'string' || !/^\d{1,32}$/.test(value.campaign_id)) {
    throw new KernelError('INVALID_INPUT', 'campaign_id 必须是纯数字')
  }
  if (typeof value.ad_account_id !== 'string' || !/^(?:act_)?[1-9]\d{9,24}$/.test(value.ad_account_id)) {
    throw new KernelError('INVALID_INPUT', 'ad_account_id 格式不正确')
  }
  if (typeof value.after_cents !== 'number' || !Number.isSafeInteger(value.after_cents) || value.after_cents < 0) {
    throw new KernelError('INVALID_INPUT', 'after_cents 必须是有效的非负整数')
  }
  return { campaignId: value.campaign_id, adAccountId: value.ad_account_id, after: value.after_cents }
}

const accountDigits = canonicalAccountDigits
// Keep aligned with the shared ADS_ENVELOPE.maxBudgetDeltaRatio.
const MAX_BUDGET_DELTA_RATIO = 0.2

async function readCurrent(step: CapabilityStepContext, id: string, accountId: string) {
  const token = await requireMetaToken(step.ctx.clientId)
  const campaign = await getCampaignDetails(id, token)
  if (!campaign) throw new RetryableCapabilityError(`读不到广告系列 ${id} 的实时设置`)
  if (campaign.id !== id) throw new KernelError('INVALID_INPUT', 'Meta 返回的广告系列 ID 与本次请求不一致，已停止')
  if (!campaign.account_id || accountDigits(campaign.account_id) !== accountDigits(accountId)) {
    throw new KernelError('INVALID_INPUT', 'Meta 返回的广告账户与本次登记账户不一致，已停止')
  }
  const raw = campaign.daily_budget?.trim() ?? ''
  if (!/^\d+$/.test(raw)) {
    throw new KernelError('INVALID_INPUT', '这个广告系列没有有效的系列级日预算；只支持 CBO 系列预算')
  }
  const current = Number(raw)
  if (!Number.isSafeInteger(current) || current <= 0) {
    throw new KernelError('INVALID_INPUT', 'Meta 返回的系列日预算无效，已停止')
  }
  return { token, current, status: campaign.status }
}

async function assertExclusiveRegisteredAccount(
  clientId: string,
  accountId: string,
): Promise<void> {
  const own = await getRegisteredAccountIds(clientId)
  if (own.error) throw new RetryableCapabilityError(own.error)
  if (!own.ids.some((id) => accountDigits(id) === accountDigits(accountId))) {
    throw new KernelError('INVALID_INPUT', '广告账户没有登记在当前客户名下，已停止')
  }
  let others: Awaited<ReturnType<typeof findOtherClientRegistrations>>
  try {
    others = await findOtherClientRegistrations(clientId, accountId)
  } catch (error) {
    throw new RetryableCapabilityError(`无法核实广告账户是否被其他客户共用：${error instanceof Error ? error.message : String(error)}`)
  }
  if (others.length) {
    throw new KernelError('INVALID_INPUT', '该 Meta 广告账户登记给多个客户，暂不允许自动改系列预算')
  }
}

export function createCutCampaignBudgetCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.cut_campaign_budget',
    version: 1,
    steps: {
      snapshot_pre: makeSnapshotPreStep(sb),
      async apply(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const { campaignId, adAccountId, after } = input(step)
        await assertExclusiveRegisteredAccount(step.ctx.clientId, adAccountId)
        const { token, current, status } = await readCurrent(step, campaignId, adAccountId)
        if (after > current) {
          throw new KernelError('INVALID_INPUT', '目标预算高于 Meta 当前系列预算，不能以减预算动作加钱')
        }
        if ((current - after) / current > MAX_BUDGET_DELTA_RATIO) {
          throw new KernelError('INVALID_INPUT', '实时系列预算与本次目标相差超过自治信封允许的 20%，已停止')
        }
        if (after === current) {
          return { output: { campaign_id: campaignId, applied: false, prior_daily_budget_cents: current, new_daily_budget_cents: current } }
        }
        const ok = await setCampaignDailyBudget(campaignId, token, after)
        if (!ok) throw new RetryableCapabilityError(`降低广告系列 ${campaignId} 预算失败：Meta 未确认写入`)
        let campaignStatus: string | null = null
        let statusWarning: string | null = null
        const afterBudget = await getCampaignDetails(campaignId, token)
        if (!afterBudget) {
          statusWarning = '预算已修改，但无法核实广告系列是否仍在投放；请检查 Meta 广告后台。'
        } else {
          campaignStatus = afterBudget.status
          if (status === 'ACTIVE' && afterBudget.status !== 'ACTIVE') {
            statusWarning = '预算已修改，但广告系列状态已变化；为避免覆盖新的状态决定，未自动重新开启，请检查 Meta 广告后台。'
          }
        }
        return {
          output: {
            campaign_id: campaignId,
            applied: true,
            prior_daily_budget_cents: current,
            new_daily_budget_cents: after,
            campaign_status_after: campaignStatus,
            ...(statusWarning ? { status_warning: statusWarning } : {}),
          },
        }
      },
      async readback(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const { campaignId, adAccountId, after } = input(step)
        const { current } = await readCurrent(step, campaignId, adAccountId)
        return {
          output: { applied: true, campaign_id: campaignId, daily_budget_now: current },
          verification: makeReadbackVerification({ daily_budget: after }, { daily_budget: current }),
        }
      },
    },
    async rollback(step: CapabilityStepContext, outputs: Readonly<Record<string, Record<string, unknown>>>): Promise<OutwardRollbackResult> {
      const { campaignId, adAccountId } = input(step)
      const applied = outputs.apply
      const prior = applied?.prior_daily_budget_cents
      const target = applied?.new_daily_budget_cents
      if (applied?.applied !== true || typeof prior !== 'number' || typeof target !== 'number') {
        return { ok: true, rollbackKind: 'noop', detail: { reason: '本次未写入 Meta，无需撤回' } }
      }
      await assertExclusiveRegisteredAccount(step.ctx.clientId, adAccountId)
      const { token, current } = await readCurrent(step, campaignId, adAccountId)
      if (current !== target) {
        return {
          ok: false,
          rollbackKind: 'provider_native',
          detail: { campaign_id: campaignId, expected_current_cents: target, actual_current_cents: current, prior_cents: prior },
          failure_reason: 'Meta 当前预算已被其他操作修改；为避免覆盖新决定，未自动恢复原值',
        }
      }
      const ok = await setCampaignDailyBudget(campaignId, token, prior)
      if (!ok) {
        return { ok: false, rollbackKind: 'provider_native', detail: { campaign_id: campaignId, prior_cents: prior }, failure_reason: 'Meta 未确认恢复原系列预算' }
      }
      return { ok: true, rollbackKind: 'provider_native', detail: { campaign_id: campaignId, restored_cents: prior } }
    },
  }
}
