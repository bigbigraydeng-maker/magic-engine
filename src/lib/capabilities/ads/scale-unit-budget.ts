/**
 * Capability · `ads.scale_unit_budget` (ABO adset or CBO campaign)
 *
 * 提高一个投放单位的日预算。信封在 authorize/gateway 复核日上限和变动比例；
 * capability 仍独立拒绝降预算或超过 20%，并核对 Meta 当前金额等于获批基线。
 *
 * 撤回只在有 apply 回执且 Meta 当前金额仍等于本次目标时恢复改前金额。
 * apply 回执丢失时无法证明写入归属，停止自动撤回并交由人工核查。
 *
 * Meta 没有 provider 幂等键；重试必须重新核对获批基线，不能盲目重复写。
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
import { canonicalAccountDigits, findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'
import { makeReadbackVerification, makeSnapshotPreStep, requireMetaToken } from './common'

function adsetId(step: CapabilityStepContext): string {
  const raw = (step.runInput as { adset_id?: unknown }).adset_id
  if (typeof raw !== 'string' || !raw) throw new RetryableCapabilityError('input 里没有 adset_id')
  return raw
}

function afterCents(step: CapabilityStepContext): number {
  const raw = (step.runInput as { after_cents?: unknown }).after_cents
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new RetryableCapabilityError('input 里没有有效的 after_cents')
  }
  return raw
}

function approvedBeforeCents(step: CapabilityStepContext): number {
  const raw = (step.runInput as { before_cents?: unknown }).before_cents
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new RetryableCapabilityError('input 里没有有效的获批前预算基线')
  }
  return raw
}

function assertScaleLimit(before: number, after: number): void {
  if (after <= before || (after - before) / before > 0.2) {
    throw new KernelError('INVALID_INPUT', '预算只能上调，且幅度不能超过 20%')
  }
}

function campaignId(step: CapabilityStepContext): string | null {
  const raw = (step.runInput as { campaign_id?: unknown }).campaign_id
  if (raw === undefined) return null
  if (typeof raw !== 'string' || !/^\d{1,32}$/.test(raw)) throw new KernelError('INVALID_INPUT', 'campaign_id 格式无效')
  return raw
}

async function assertExclusiveRegisteredAccount(clientId: string, accountId: string): Promise<void> {
  const digits = canonicalAccountDigits
  const own = await getRegisteredAccountIds(clientId)
  if (own.error) throw new RetryableCapabilityError(own.error)
  if (!own.ids.some(id => digits(id) === digits(accountId))) {
    throw new KernelError('INVALID_INPUT', '广告账户没有登记在当前客户名下，已停止')
  }
  let others: Awaited<ReturnType<typeof findOtherClientRegistrations>>
  try { others = await findOtherClientRegistrations(clientId, accountId) }
  catch (error) { throw new RetryableCapabilityError(`无法核实广告账户是否被其他客户共用：${error instanceof Error ? error.message : String(error)}`) }
  if (others.length) throw new KernelError('INVALID_INPUT', '该 Meta 广告账户登记给多个客户，暂不允许自动调整预算')
}

function rollbackBudgets(step: CapabilityStepContext, priorOutputs: Readonly<Record<string, Record<string, unknown>>>) {
  const output = priorOutputs.apply ?? {}
  // Input values authorize the intended change; they do not prove that this
  // particular run wrote it. Roll back only when apply's persisted receipt exists.
  const prior = output.prior_daily_budget_cents
  const target = output.new_daily_budget_cents
  if (typeof prior !== 'number' || !Number.isSafeInteger(prior) || prior <= 0
    || typeof target !== 'number' || !Number.isSafeInteger(target) || target <= prior) return null
  return { prior, target }
}

async function readCampaignBudget(id: string, accountId: string, token: string, requireActive = true) {
  const campaign = await getCampaignDetails(id, token)
  if (!campaign) throw new RetryableCapabilityError(`读不到广告系列 ${id} 的实时设置`)
  if (campaign.id !== id || !campaign.account_id || canonicalAccountDigits(campaign.account_id) !== canonicalAccountDigits(accountId)) {
    throw new KernelError('INVALID_INPUT', 'Meta 返回的广告系列或账户归属与本次请求不一致，已停止')
  }
  if (requireActive && campaign.status !== 'ACTIVE') throw new KernelError('INVALID_INPUT', '广告系列已不在投放中，已停止上调预算')
  const raw = campaign.daily_budget?.trim() ?? ''
  if (!/^\d+$/.test(raw)) throw new KernelError('INVALID_INPUT', '该广告系列没有有效的系列级日预算')
  const current = Number(raw)
  if (!Number.isSafeInteger(current) || current <= 0) throw new KernelError('INVALID_INPUT', 'Meta 返回的系列日预算无效')
  return current
}

/** 撤回处理：把广告组或广告系列日预算写回它改前的样子。 */
async function rollbackHandler(
  step: CapabilityStepContext,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const campaign = campaignId(step)
  if (campaign) {
    const budgets = rollbackBudgets(step, priorOutputs)
    if (!budgets) return { ok: false, rollbackKind: 'provider_native', detail: { campaign_id: campaign }, failure_reason: '缺少可信的系列预算基线，无法安全确认是否需要撤回' }
    const { prior, target } = budgets
    const accountId = (step.runInput as { ad_account_id?: string }).ad_account_id ?? ''
    await assertExclusiveRegisteredAccount(step.ctx.clientId, accountId)
    const token = await requireMetaToken(step.ctx.clientId)
    const current = await readCampaignBudget(campaign, accountId, token, false)
    if (current === prior) return { ok: true, rollbackKind: 'noop', detail: { campaign_id: campaign, reason: 'Meta 当前预算仍是改前金额' } }
    if (current !== target) return { ok: false, rollbackKind: 'provider_native', detail: { campaign_id: campaign, expected_current_cents: target, actual_current_cents: current, prior_cents: prior }, failure_reason: 'Meta 系列预算已被其他操作修改，未覆盖新值' }
    const ok = await setCampaignDailyBudget(campaign, token, prior)
    return ok
      ? { ok: true, rollbackKind: 'provider_native', detail: { campaign_id: campaign, restored_cents: prior } }
      : { ok: false, rollbackKind: 'provider_native', detail: { campaign_id: campaign, prior_cents: prior }, failure_reason: 'Meta 未确认恢复系列预算' }
  }
  const id = adsetId(step)
  const budgets = rollbackBudgets(step, priorOutputs)
  if (!budgets) {
    return { ok: false, rollbackKind: 'provider_native', detail: { adset_id: id }, failure_reason: '缺少可信的广告组预算变更记录，未尝试自动撤回' }
  }
  const { prior, target } = budgets

  const accountId = (step.runInput as { ad_account_id?: string }).ad_account_id ?? ''
  await assertExclusiveRegisteredAccount(step.ctx.clientId, accountId)
  const token = await requireMetaToken(step.ctx.clientId)
  const current = await getAdSetStatus(id, token)
  if (!current || current.id !== id || !current.account_id
    || canonicalAccountDigits(current.account_id) !== canonicalAccountDigits(accountId)) {
    return { ok: false, rollbackKind: 'provider_native', detail: { adset_id: id }, failure_reason: 'Meta 返回的广告组或账户归属无法确认，未撤回' }
  }
  const currentCents = typeof current?.daily_budget === 'string' && /^\d+$/.test(current.daily_budget)
    ? Number(current.daily_budget)
    : null
  if (currentCents === prior) return { ok: true, rollbackKind: 'noop', detail: { adset_id: id, reason: 'Meta 当前预算仍是改前金额' } }
  if (currentCents !== target) return {
    ok: false,
    rollbackKind: 'provider_native',
    detail: { adset_id: id, expected_current_cents: target, actual_current_cents: currentCents, prior_cents: prior },
    failure_reason: 'Meta 广告组预算已被其他操作修改，未覆盖新值',
  }
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
      // A budget increase changes the client's total planned spend, so its
      // pre-provider proof must refresh every registered account in one round.
      snapshot_pre: makeSnapshotPreStep(sb, { allClientAccounts: true }),

      /** 读改前预算，写新预算。改前预算**必须留在 output 里**——撤回要用。 */
      async apply(step: CapabilityStepContext): Promise<CapabilityStepResult> {
        const campaign = campaignId(step)
        if (campaign) {
          const run = step.runInput as { ad_account_id?: string }
          const accountId = run.ad_account_id ?? ''
          const expected = approvedBeforeCents(step)
          const target = afterCents(step)
          await assertExclusiveRegisteredAccount(step.ctx.clientId, accountId)
          const token = await requireMetaToken(step.ctx.clientId)
          const current = await readCampaignBudget(campaign, accountId, token)
          if (current !== expected) throw new RetryableCapabilityError('Meta 当前系列预算与审批时的金额不同；已停止修改，请重新提交并审批')
          assertScaleLimit(current, target)
          const ok = await setCampaignDailyBudget(campaign, token, target)
          if (!ok) throw new RetryableCapabilityError(`提高广告系列 ${campaign} 预算失败：Meta 未确认写入`)
          return { output: { campaign_id: campaign, applied: true, prior_daily_budget_cents: current, new_daily_budget_cents: target } }
        }
        const id = adsetId(step)
        const expectedBeforeCents = approvedBeforeCents(step)
        const newCents = afterCents(step)
        assertScaleLimit(expectedBeforeCents, newCents)
        const accountId = (step.runInput as { ad_account_id?: string }).ad_account_id ?? ''
        await assertExclusiveRegisteredAccount(step.ctx.clientId, accountId)
        const token = await requireMetaToken(step.ctx.clientId)

        // 🔴 先读一次现状：**不是**为了信封 —— 信封已由 gateway.ts 在这一步之前调 `preProviderEnvelopeBlockReason` 用 kernel_pre 快照重算过了。
        //    这里读现状**只**为撤回留证据（handler 里读的是 provider 当下的值，snapshot 里读的是几秒前的值，两者可能因人工改动短暂不一致）。
        //    读失败 = 环境类，重试。
        const before = await getAdSetStatus(id, token)
        if (!before) throw new RetryableCapabilityError(`读不到广告组 ${id} 的当前状态`)
        if (before.id !== id || !before.account_id
          || canonicalAccountDigits(before.account_id) !== canonicalAccountDigits(accountId)) {
          throw new KernelError('INVALID_INPUT', 'Meta 返回的广告组或账户归属与本次请求不一致，已停止')
        }

        const beforeCents = typeof before.daily_budget === 'string' && /^\d+$/.test(before.daily_budget)
          ? Number(before.daily_budget)
          : null
        if (beforeCents === null) {
          throw new RetryableCapabilityError(`Meta 没回 daily_budget，可能这个组是 CBO 系列下的`)
        }
        if (!Number.isSafeInteger(beforeCents) || beforeCents !== expectedBeforeCents) {
          throw new RetryableCapabilityError('Meta 当前预算与审批时看到的金额不同；已停止修改，请重新检查并提交')
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
        const campaign = campaignId(step)
        if (campaign) {
          const accountId = (step.runInput as { ad_account_id?: string }).ad_account_id ?? ''
          const target = afterCents(step)
          const token = await requireMetaToken(step.ctx.clientId)
          const current = await readCampaignBudget(campaign, accountId, token, false)
          return { output: { campaign_id: campaign, daily_budget_now: current }, verification: makeReadbackVerification({ daily_budget: target }, { daily_budget: current }) }
        }
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
