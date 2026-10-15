/** Capability · pause one Meta campaign through the Kernel. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapabilityImplementation, CapabilityStepContext, CapabilityStepResult, OutwardRollbackResult } from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import { canonicalAccountDigits, findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignStatus } from '@/lib/meta/campaign-writes'
import { makeSnapshotPreStep, makeReadbackVerification, requireMetaToken } from './common'

function readInput(step: CapabilityStepContext) {
  const value = step.runInput as { campaign_id?: unknown; ad_account_id?: unknown }
  if (typeof value.campaign_id !== 'string' || !/^\d{1,32}$/.test(value.campaign_id)) throw new KernelError('INVALID_INPUT', 'campaign_id 必须是纯数字')
  if (typeof value.ad_account_id !== 'string' || !/^(?:act_)?[1-9]\d{9,24}$/.test(value.ad_account_id)) throw new KernelError('INVALID_INPUT', 'ad_account_id 格式不正确')
  return { campaignId: value.campaign_id, accountId: value.ad_account_id }
}

async function campaign(step: CapabilityStepContext, id: string, accountId: string) {
  const own = await getRegisteredAccountIds(step.ctx.clientId)
  if (own.error) throw new RetryableCapabilityError(own.error)
  const digits = canonicalAccountDigits(accountId)
  if (!own.ids.some(value => canonicalAccountDigits(value) === digits)) throw new KernelError('INVALID_INPUT', '广告账户没有登记在当前客户名下')
  const shared = await findOtherClientRegistrations(step.ctx.clientId, accountId)
  if (shared.length) throw new KernelError('INVALID_INPUT', '该 Meta 广告账户登记给多个客户，暂不允许暂停系列')
  const token = await requireMetaToken(step.ctx.clientId)
  const row = await getCampaignDetails(id, token)
  if (!row) throw new RetryableCapabilityError(`读不到广告系列 ${id}`)
  if (!row.account_id || canonicalAccountDigits(row.account_id) !== digits) throw new KernelError('INVALID_INPUT', 'Meta 返回的广告账户与登记账户不一致')
  return { token, row }
}

export function createPauseCampaignCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.pause_campaign', version: 1,
    steps: {
      snapshot_pre: makeSnapshotPreStep(sb),
      async apply(step): Promise<CapabilityStepResult> {
        const { campaignId, accountId } = readInput(step)
        const { token, row } = await campaign(step, campaignId, accountId)
        const applied = row.status === 'PAUSED' || await setCampaignStatus(campaignId, token, 'PAUSED')
        if (!applied) throw new RetryableCapabilityError(`暂停广告系列 ${campaignId} 失败：Meta 未确认写入`)
        return { output: { campaign_id: campaignId, applied: row.status !== 'PAUSED', prior_status: row.status } }
      },
      async readback(step): Promise<CapabilityStepResult> {
        const { campaignId, accountId } = readInput(step)
        const { row } = await campaign(step, campaignId, accountId)
        return { output: { applied: true, campaign_id: campaignId, status: row.status }, verification: makeReadbackVerification({ status: 'PAUSED' }, { status: row.status }) }
      },
    },
    async rollback(step, outputs): Promise<OutwardRollbackResult> {
      const { campaignId, accountId } = readInput(step)
      const prior = outputs.apply?.prior_status
      if (prior !== 'ACTIVE') return { ok: true, rollbackKind: 'noop', detail: { reason: '改前系列不是 ACTIVE，无需恢复' } }
      const { row } = await campaign(step, campaignId, accountId)
      if (row.status !== 'PAUSED') return { ok: false, rollbackKind: 'provider_native', detail: { campaign_id: campaignId, actual_status: row.status }, failure_reason: '系列状态已被其他操作修改，未自动覆盖' }
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { campaign_id: campaignId, actual_status: row.status },
        failure_reason: '无法确认当前暂停是否由本次操作造成；为避免覆盖后续决定，未自动重新开启，请人工检查',
      }
    },
  }
}
