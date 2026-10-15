/**
 * Capability · `ads.swap_creative`
 *
 * 把一条广告换挂到**账户里已经存在**的另一个素材上。三条硬边界：
 *
 * ① 目标视频必须在这个客户的素材池里、且状态是 `approved`。池子里没有、或者还是
 *    `candidate`，一律非可重试地拒绝 —— 不许退化成「账户里随便挑一个视频」。
 * ② 只换成**同一个主页**发布的素材。换主页等于换了「这条广告看起来是谁发的」。
 * ③ **不建新素材。** 建一个新 creative 等于由代码自己写对外文案，而对外每句话必须
 *    来自已核实、已批准的来源（CLAUDE.md 铁律 8）。所以账户里没有拿这条已批准视频
 *    做好的素材时，这个动作非可重试地失败、落进「需要你动手」——这是**设计如此**，
 *    不是缺口。
 *
 * 信封那几条（变动不超 20%、距上次改动 72 小时、学习期、正在跑的实验）由
 * `authorize.ts` 与 `gateway.ts` 在本文件执行之前各查一次，这里不重复实现。
 *
 * 撤回 = 把换前那个素材编号写回去；如果期间被别人改过（Meta 当前素材既不是换前的、
 * 也不是我们换上的那个），拒绝覆盖并如实报失败，不 fail-open。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import { getAdCreativeBinding, listAccountAdCreatives, setAdCreative } from '@/lib/meta/ad-creatives'
import { canonicalAccountDigits, findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { loadAdStrategyConfig } from '@/lib/ads-strategy/config'
import { makeReadbackVerification, makeSnapshotPreStep, requireMetaToken } from './common'

const ID_PATTERN = /^\d{1,32}$/

function numericInput(step: CapabilityStepContext, field: 'ad_id' | 'creative_ref'): string {
  const raw = (step.runInput as Record<string, unknown>)[field]
  // 格式不对重试一万次也不会变对 —— 非可重试。
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) {
    throw new KernelError('INVALID_INPUT', `${field} 格式无效，已停止`)
  }
  return raw
}

function accountInput(step: CapabilityStepContext): string {
  const raw = (step.runInput as { ad_account_id?: unknown }).ad_account_id
  if (typeof raw !== 'string' || raw === '') {
    throw new RetryableCapabilityError('input 里没有 ad_account_id')
  }
  return raw
}

/** 账户归属：必须登记在本客户名下，且没有被别的客户共用。照抄 scale-unit-budget。 */
async function assertExclusiveRegisteredAccount(clientId: string, accountId: string): Promise<void> {
  const digits = canonicalAccountDigits
  const own = await getRegisteredAccountIds(clientId)
  if (own.error) throw new RetryableCapabilityError(own.error)
  if (!own.ids.some(id => digits(id) === digits(accountId))) {
    throw new KernelError('INVALID_INPUT', '广告账户没有登记在当前客户名下，已停止')
  }
  let others: Awaited<ReturnType<typeof findOtherClientRegistrations>>
  try {
    others = await findOtherClientRegistrations(clientId, accountId)
  } catch (error) {
    throw new RetryableCapabilityError(
      `无法核实广告账户是否被其他客户共用：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (others.length) {
    throw new KernelError('INVALID_INPUT', '该 Meta 广告账户登记给多个客户，暂不允许自动换素材')
  }
}

/**
 * 素材池闸：目标视频必须在池子里且已批准。
 *
 * 🔴 读配置失败按可重试处理；读到了但没这一条 / 还是 candidate，是**判定结果**，
 *    非可重试 —— 重试不会让它变成已批准，只会刷死信。
 */
async function assertApprovedInPool(clientId: string, videoId: string): Promise<void> {
  let pool: Awaited<ReturnType<typeof loadAdStrategyConfig>>['creative_pool']
  try {
    pool = (await loadAdStrategyConfig(clientId)).creative_pool
  } catch (error) {
    throw new RetryableCapabilityError(
      `读不到客户 ${clientId} 的广告设置（素材池）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const entry = pool.find(e => e.ref === videoId)
  if (!entry) {
    throw new KernelError('INVALID_INPUT', `视频 ${videoId} 不在这个客户的素材池里，不换`)
  }
  if (entry.status !== 'approved') {
    throw new KernelError('INVALID_INPUT', `视频 ${videoId} 在素材池里还是待批准状态，不换`)
  }
}

/** 候选里挑一条：同一个视频 + 同一个主页。多条时取编号最大的那条（最新建的）。 */
function pickTarget(
  creatives: readonly { id: string; video_id: string | null; page_id: string | null }[],
  videoId: string,
  pageId: string,
): string | null {
  const matches = creatives
    .filter(c => c.video_id === videoId && c.page_id === pageId)
    .map(c => c.id)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? 1 : -1))
  return matches[0] ?? null
}

function readReceipt(
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): { prior: string; applied: string; noChange: boolean } | null {
  const output = priorOutputs.apply ?? {}
  const prior = output.prior_creative_id
  const applied = output.new_creative_id
  if (typeof prior !== 'string' || prior === '' || typeof applied !== 'string' || applied === '') return null
  return { prior, applied, noChange: output.no_change === true }
}

/** 撤回：把换前的素材编号写回去；被别人改过就不覆盖。 */
async function rollbackHandler(
  step: CapabilityStepContext,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const adId = numericInput(step, 'ad_id')
  const receipt = readReceipt(priorOutputs)
  if (!receipt) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { ad_id: adId, reason: 'apply 没落下换前后的素材编号 → 没写 Meta，不需撤' },
    }
  }
  if (receipt.noChange) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { ad_id: adId, reason: '这次本来就没换（广告已经挂着目标素材），不需撤' },
    }
  }

  const token = await requireMetaToken(step.ctx.clientId)
  const current = await getAdCreativeBinding(adId, token)
  if (!current) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { ad_id: adId },
      failure_reason: '读不到广告当前素材，未尝试撤回',
    }
  }
  if (current.creative_id === receipt.prior) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { ad_id: adId, reason: 'Meta 当前素材仍是换前那个' },
    }
  }
  if (current.creative_id !== receipt.applied) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { ad_id: adId, expected_current: receipt.applied, actual_current: current.creative_id },
      failure_reason: '广告素材已被其他操作改过，未覆盖',
    }
  }
  const ok = await setAdCreative(adId, token, receipt.prior)
  return ok
    ? { ok: true, rollbackKind: 'provider_native', detail: { ad_id: adId, restored_creative_id: receipt.prior } }
    : {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { ad_id: adId, prior_creative_id: receipt.prior },
      failure_reason: 'Meta 未确认恢复原素材',
    }
}

async function applyStep(step: CapabilityStepContext): Promise<CapabilityStepResult> {
  const adId = numericInput(step, 'ad_id')
  const videoId = numericInput(step, 'creative_ref')
  const accountId = accountInput(step)

  await assertExclusiveRegisteredAccount(step.ctx.clientId, accountId)
  await assertApprovedInPool(step.ctx.clientId, videoId)

  const token = await requireMetaToken(step.ctx.clientId)
  const before = await getAdCreativeBinding(adId, token)
  if (!before) throw new RetryableCapabilityError(`读不到广告 ${adId} 的当前素材`)
  if (!before.account_id || canonicalAccountDigits(before.account_id) !== canonicalAccountDigits(accountId)) {
    throw new KernelError('INVALID_INPUT', 'Meta 返回的广告账户归属与本次请求不一致，已停止')
  }
  // 证不出「今天挂的是哪个素材、以哪个主页发」就不动它：撤不回的东西不碰。
  if (!before.creative_id || !before.page_id) {
    throw new KernelError('INVALID_INPUT', '读不出这条广告当前的素材或发布主页，无法保证能撤回，已停止')
  }

  const creatives = await listAccountAdCreatives(accountId, token)
  if (creatives === null) throw new RetryableCapabilityError(`读不到广告账户 ${accountId} 的素材清单`)

  const targetId = pickTarget(creatives, videoId, before.page_id)
  if (!targetId) {
    throw new KernelError(
      'INVALID_INPUT',
      `账户里还没有用已批准视频 ${videoId}、且以主页 ${before.page_id} 发布的现成素材；` +
      '换素材不自己建素材（会变成代码自己写对外文案），请先让人建一条',
    )
  }
  if (targetId === before.creative_id) {
    return {
      output: {
        ad_id: adId,
        applied: true,
        prior_creative_id: before.creative_id,
        new_creative_id: before.creative_id,
        video_id: videoId,
        no_change: true,
      },
    }
  }

  const ok = await setAdCreative(adId, token, targetId)
  if (!ok) throw new RetryableCapabilityError(`给广告 ${adId} 换素材失败：Meta 没确认 success`)
  return {
    output: {
      ad_id: adId,
      applied: true,
      prior_creative_id: before.creative_id,
      new_creative_id: targetId,
      video_id: videoId,
      no_change: false,
    },
  }
}

async function readbackStep(step: CapabilityStepContext): Promise<CapabilityStepResult> {
  const adId = numericInput(step, 'ad_id')
  const receipt = readReceipt(step.priorOutputs)
  if (!receipt) throw new RetryableCapabilityError('apply 没落下素材编号，无法回读比对')

  const token = await requireMetaToken(step.ctx.clientId)
  const current = await getAdCreativeBinding(adId, token)
  if (!current) throw new RetryableCapabilityError(`回读广告 ${adId} 失败`)

  const verification = makeReadbackVerification(
    { creative_id: receipt.applied },
    { creative_id: current.creative_id },
  )
  return {
    output: { ad_id: adId, creative_id_now: current.creative_id },
    verification,
  }
}

export function createSwapCreativeCapability(sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: 'ads.swap_creative',
    version: 1,
    steps: {
      snapshot_pre: makeSnapshotPreStep(sb),
      apply: applyStep,
      readback: readbackStep,
    },
    rollback: rollbackHandler,
  }
}
