/**
 * Capability · `ads.swap_creative`
 *
 * 把一条广告换挂到**账户里已经存在**的另一个素材上。一句话语义：**只换视频，不换一个字**。
 *
 * ① 目标视频必须在这个客户的素材池里、`approved`、**且带批准人与批准时间**（手册
 *    §11 A1 四道机制闸之一）。池里没有、还是 `candidate`、或批准没署名，一律非可重试
 *    拒绝 —— 不许退化成「账户里随便挑一个视频」。
 * ② 只换成**同一个主页**发布的素材。换主页等于换了「这条广告看起来是谁发的」。
 * ③ **买家可见文案与落地去向必须跟这条广告今天用的完全一致。** 素材池批准的是一条
 *    视频，不是一整条素材；只按视频编号挑，就可能把三个月前某人建的、带旧价格或带
 *    「还剩几周」话术的素材重新推上线 —— 那是铁律 8。钉成「文字一模一样」之后，这个
 *    动作就真的只换视频。
 * ④ 只动**单视频形态**的广告。动态素材、轮播、目录广告一律交人工：它们也有 page_id，
 *    光比主页挡不住，换过去会把多素材优选、轮播卖点、留资表单静默换掉。
 * ⑤ **不建新素材。** 建 creative 等于由代码自己写对外文案（铁律 8）。所以账户里没有
 *    这样一条现成素材时，非可重试地失败、落进「需要你动手」——这是**设计如此**，不是缺口。
 * ⑥ 换完必须看审核：`effective_status` 不是 ACTIVE、或有审核问题，一律判验证失败，
 *    由 Kernel 触发撤回（手册 RL-03；NAL 2026-09-24 连换 4 次零花费 23 小时）。
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
import {
  getAdCreativeBinding,
  listAccountAdCreatives,
  setAdCreative,
  videoIdOfCreative,
  type AccountAdCreative,
  type AdCreativeBinding,
} from '@/lib/meta/ad-creatives'
import { extractBuyerFacingText } from '@/lib/meta/readback'
import { canonicalAccountDigits, findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
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
  // 🔴 `loadAdStrategyConfig` 读库失败时不抛，而是回一份空池子的默认配置 ——
  //    那会让「数据库抖了一下」被报成「这个视频没批准」，人去查错地方
  //    （魏征 2026-10-15 复审建议 1）。所以这里必须看 source。
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') {
    throw new RetryableCapabilityError(`读不到客户 ${clientId} 的广告设置（素材池），这次不是「没批准」而是读失败`)
  }
  const entry = loaded.config.creative_pool.find(e => e.ref === videoId)
  if (!entry) {
    throw new KernelError('INVALID_INPUT', `视频 ${videoId} 不在这个客户的素材池里，不换`)
  }
  if (entry.kind !== 'meta_video') {
    throw new KernelError('INVALID_INPUT', `素材池里 ${videoId} 这条不是 Meta 视频（kind=${entry.kind}），不换`)
  }
  if (entry.status !== 'approved') {
    throw new KernelError('INVALID_INPUT', `视频 ${videoId} 在素材池里还是待批准状态，不换`)
  }
  // 手册 §11 A1 的四道机制闸之一：只用「approved 且带批准人与批准时间」的素材。
  // 手工写进库里的行、批准入口上线前的历史行都没有这两项，一律不认。
  if (!entry.approved_by || !entry.approved_at) {
    throw new KernelError(
      'INVALID_INPUT',
      `视频 ${videoId} 在素材池里标着已批准，但没有批准人或批准时间，不认这条批准`,
    )
  }
}

/** 买家可见文案的指纹：排序后拼起来，只用来判「两条素材的文字是不是同一套」。 */
function copyFingerprint(creative: Record<string, unknown> | null): string {
  return extractBuyerFacingText(creative).map(s => s.replace(/\s+/g, ' ').trim()).sort().join('\u0001')
}

/** 投放形态指纹：CTA 类型、落地链接、留资表单。换素材不许把这些换掉。 */
function deliveryFingerprint(creative: Record<string, unknown> | null): string {
  const spec = creative?.object_story_spec as Record<string, unknown> | undefined
  const videoData = spec?.video_data as Record<string, unknown> | undefined
  const cta = videoData?.call_to_action as Record<string, unknown> | undefined
  const value = cta?.value as Record<string, unknown> | undefined
  return JSON.stringify([
    typeof cta?.type === 'string' ? cta.type : null,
    typeof value?.link === 'string' ? value.link : null,
    typeof value?.app_destination === 'string' ? value.app_destination : null,
    typeof value?.lead_gen_form_id === 'string' ? value.lead_gen_form_id : null,
  ])
}

/**
 * 形态闸：当前素材必须本来就是「单视频」那一类。
 *
 * 🔴 动态素材（`asset_feed_spec`）、轮播（`link_data`）、目录广告也都有 `page_id`，
 *    光比对主页挡不住它们；换成单视频素材会把多素材优选、轮播卖点、挂在原素材上的
 *    留资表单一起静默换掉，客户看到的是「线索突然断了」而我们报一切正常
 *    （魏征 2026-10-15 复审 M4）。
 */
function assertSingleVideoShape(before: AdCreativeBinding): void {
  if (before.creative_raw?.asset_feed_spec !== undefined) {
    throw new KernelError('INVALID_INPUT', '这条广告挂的是动态素材（多素材优选），不自动换，交人工')
  }
  if (!before.video_id) {
    throw new KernelError('INVALID_INPUT', '这条广告挂的不是单视频素材（可能是轮播或图文），不自动换，交人工')
  }
}

/**
 * 候选里挑一条。四条都必须相同，差一条就不是候选：
 *   ① 视频 = 这次要换上的那条已批准视频
 *   ② 发布主页 = 广告今天用的那个主页
 *   ③ **买家可见文案跟今天这条一模一样**
 *   ④ **CTA / 落地链接 / 留资表单跟今天这条一模一样**
 *
 * 🔴 ③④ 是这一刀最要紧的两道闸（魏征 2026-10-15 复审 M3）：素材池批准的是**一条视频**，
 *    不是一整条素材。如果只按视频编号挑，就可能挑到三个月前某人建的、带旧价格或带
 *    「还剩几周」话术的素材，把一段**没人审过的对外文案**重新推上线 —— 那是铁律 8。
 *    把文案与投放形态钉成「跟今天完全一致」，这个动作的语义就收成了真正的「只换视频」。
 *
 * 多条仍相同的候选里取编号最大的那条（最新建的）。
 */
function pickTarget(
  creatives: readonly AccountAdCreative[],
  videoId: string,
  before: AdCreativeBinding,
): string | null {
  const copy = copyFingerprint(before.creative_raw)
  const delivery = deliveryFingerprint(before.creative_raw)
  const matches = creatives
    .filter(c =>
      c.video_id === videoId
      && c.page_id === before.page_id
      && c.status !== 'DELETED'
      && c.status !== 'ARCHIVED'
      && c.raw.asset_feed_spec === undefined
      && copyFingerprint(c.raw) === copy
      && deliveryFingerprint(c.raw) === delivery)
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
    // 🔴 不许从「没有回执」推出「没写入 Meta」（魏征复审 M2）：POST 发出之后断网、
    //    或 Meta 回 200 但 body 不是 success，apply 都会抛错而不落 output，可是线上
    //    可能**已经换了**。所以去 Meta 问一句：这条广告现在挂的视频是不是这次要换的那条。
    //    是 → 写入其实发生了，但换前是哪条已经无人知道，如实报撤不了、要人核对。
    const wantedVideoId = numericInput(step, 'creative_ref')
    const token = await requireMetaToken(step.ctx.clientId)
    const now = await getAdCreativeBinding(adId, token)
    if (!now) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { ad_id: adId },
        failure_reason: 'apply 没落回执，又读不到这条广告现在挂什么，判不了是否已写入，请人工核对',
      }
    }
    if (videoIdOfCreative(now.creative_raw) === wantedVideoId) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { ad_id: adId, current_creative_id: now.creative_id, wanted_video_id: wantedVideoId },
        failure_reason: '这条广告已经挂上了本次要换的视频，但 apply 没落下换前的素材编号，撤不回去，请人工核对并手动换回',
      }
    }
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { ad_id: adId, reason: '广告现在挂的不是本次要换的视频 → 这次没写进 Meta，不需撤' },
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
  // 撤回也复核账户归属，跟 scale-unit-budget 保持一致（子牙复审 S1）。
  await assertExclusiveRegisteredAccount(step.ctx.clientId, accountInput(step))
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
  assertSingleVideoShape(before)
  if (before.video_id === videoId) {
    return {
      output: {
        ad_id: adId, applied: true, prior_creative_id: before.creative_id,
        new_creative_id: before.creative_id, video_id: videoId, no_change: true,
      },
    }
  }

  const listed = await listAccountAdCreatives(accountId, token)
  if (listed === null) throw new RetryableCapabilityError(`读不到广告账户 ${accountId} 的素材清单`)

  const targetId = pickTarget(listed.creatives, videoId, before)
  if (!targetId) {
    // 🔴 「清单取不全」和「确实没有」必须分开：取不全时说「没有、请人去建」是把
    //    判不了渲染成了结论，人会去建一条可能已经存在的素材（子牙复审 B2）。
    if (!listed.complete) {
      throw new RetryableCapabilityError(
        `账户 ${accountId} 的素材清单没取全（${listed.truncated_reason ?? '原因未知'}，` +
        `只取到 ${listed.creatives.length} 条），这次判不了有没有现成素材`,
      )
    }
    throw new KernelError(
      'INVALID_INPUT',
      `账户里没有这样一条现成素材：用已批准视频 ${videoId}、同主页 ${before.page_id}、` +
      '且文案与落地去向跟这条广告今天用的完全一致。换素材只换视频不换文案，' +
      '也不自己建素材（会变成代码自己写对外文案），请先让人建一条',
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

  // 🔴 换素材会让广告重新过审。被打回时 `effective_status` 不是 ACTIVE，广告静静地
  //    零花费（NAL 2026-09-24 事故：连换 4 次、约 23 小时零花费），而只比素材编号
  //    的回读会「验证通过」。手册 RL-03 第 ③ 步要求：不是 ACTIVE 视为失败、当场改回
  //    原素材 —— 所以把它纳入验证判据，验证失败由 Kernel 触发撤回（魏征复审 M1）。
  const issueCount = current.issues_info === null ? -1 : current.issues_info.length
  const verification = makeReadbackVerification(
    { creative_id: receipt.applied, effective_status: 'ACTIVE', issue_count: 0 },
    { creative_id: current.creative_id, effective_status: current.effective_status, issue_count: issueCount },
  )
  return {
    // 🔴 `applied` 必须在**最后一个步骤**的 output 里：产物口径 = 最后一个成功步骤的
    //    output，而注册表声明 `required: ['applied']`。少了它，每次换成功都会被判
    //    INVALID_OUTPUT → failRun → 自动撤回，并谎报失败（子牙复审 B1）。
    output: {
      applied: true,
      ad_id: adId,
      creative_id_now: current.creative_id,
      prior_creative_id: receipt.prior,
      new_creative_id: receipt.applied,
      effective_status_now: current.effective_status,
      issue_count: issueCount,
    },
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
