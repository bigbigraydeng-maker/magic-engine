/**
 * 「开启暂停广告」执行体的预检（preflight）。
 *
 * 🔴 为什么要有这一串检查：
 *   开启一条已建好的暂停私信广告会真花钱。执行体在动手之前必须确认：
 *   是授权人批的、没被紧急开关挡住、对象归属对、状态还是暂停、Meta 上没被
 *   偷偷改过、文案没踩红线、预算没超上限。任何一项读不到都按失败处理
 *   （fail-closed）—— 读不到 ≠ 安全。
 *
 * 🔴 为什么第一个失败就停：
 *   后面的检查会调用后面的 deps（读 Meta、读预算）。前面已经确定不能开，
 *   再去读就是白花配额、白留痕迹。所以每一步失败立刻返回，不往下走。
 *
 * 🔴 为什么每一步单独一个函数：
 *   每个检查的「为什么」不一样，混在一起读不出防的是哪起事故。拆开之后
 *   每个函数只讲一件事，失败信息也能精确到「哪一层、什么状态」。
 */

import { checkActivationBudget } from '@/lib/ads-strategy/activation-budget'
import { computeMetaFingerprint, diffMetaFingerprint } from '@/lib/ads-strategy/meta-fingerprint'
import { adaptMetaAdSet } from '@/lib/ads-strategy/meta-readback-adapter'
import { checkLaunch } from '@/lib/ads-strategy/launch-readback'
import { findRedlineHits } from '@/lib/ads-strategy/draft-redlines'
import {
  normalizeAccountId,
  type ActivateDeps,
  type ActivateInput,
  type LiveDraftState,
} from './deps'

export type PreflightCode =
  | 'approver_mismatch'
  | 'kill_switch_engaged'
  | 'circuit_tripped'
  | 'ownership_mismatch'
  | 'meta_unreadable'
  | 'not_in_paused_state'
  | 'draft_not_activating'
  | 'unexpected_siblings'
  | 'meta_side_changed'
  | 'readback_blocked'
  | 'schedule_expired'
  | 'redlines_unavailable'
  | 'brand_redline_hit'
  | 'budget_unavailable'
  | 'budget_cap_exceeded'

export type PreflightResult =
  | { ok: true; live: LiveDraftState; budget: { totalCents: number; capCents: number } }
  | { ok: false; code: PreflightCode; message: string }

export const MIN_REMAINING_MS = 24 * 60 * 60 * 1000

/** 失败结果的简写。 */
function fail(code: PreflightCode, message: string): PreflightResult {
  return { ok: false, code, message }
}

/** 状态转大写比较；null/空白一律当「不是 PAUSED」。 */
function isPaused(status: string | null): boolean {
  return typeof status === 'string' && status.trim().toUpperCase() === 'PAUSED'
}

/** 现场对象归属是否等于目标账户（null 视为不等）。 */
function ownsAccount(accountId: string | null, target: string): boolean {
  if (accountId === null) return false
  return normalizeAccountId(accountId) === target
}

/** 1. 签批人：必须是授权人本人批的，否则谁都能拿别人的授权去开广告。 */
async function checkApprover(
  decisionId: string,
  deps: ActivateDeps,
): Promise<PreflightResult | null> {
  const res = await deps.readDecisionApprover(decisionId)
  if (!res.ok) {
    return fail('approver_mismatch', '读不到这次授权的签批人，不能确认是授权人批的')
  }
  const email = res.value.email
  if (typeof email !== 'string' || email.trim() === '') {
    return fail('approver_mismatch', '这次授权没有签批人邮箱，不能确认是授权人批的')
  }
  if (!deps.isApprover(email)) {
    return fail('approver_mismatch', `签批人 ${email} 不是这个客户的授权人，不能开广告`)
  }
  return null
}

/** 2. 紧急开关/熔断：客户任一账户熔断中就不许开，防止在事故期间继续花钱。 */
async function checkKill(clientId: string, deps: ActivateDeps): Promise<PreflightResult | null> {
  const state = await deps.readKillState(clientId)
  if (!state.engaged) return null
  const code: PreflightCode =
    state.code === 'kill_switch_engaged' ? 'kill_switch_engaged' : 'circuit_tripped'
  return fail(code, state.message)
}

/** 3. 归属：账户必须在注册表里，现场三层对象也必须属于这个账户。 */
async function checkOwnership(
  args: { clientId: string; input: ActivateInput },
  deps: ActivateDeps,
): Promise<{ fail: PreflightResult } | { live: LiveDraftState; registered: string[] }> {
  const listed = await deps.listRegisteredAccounts(args.clientId)
  if (typeof listed.error === 'string' && listed.error !== '') {
    return { fail: fail('ownership_mismatch', `读不到客户登记的广告账户：${listed.error}`) }
  }
  const registered = (listed.ids ?? []).map(normalizeAccountId).filter((id) => id !== '')
  if (registered.length === 0) {
    return { fail: fail('ownership_mismatch', '客户没有登记任何广告账户，不能开广告') }
  }
  if (!registered.includes(args.input.adAccountId)) {
    return {
      fail: fail(
        'ownership_mismatch',
        `这条广告所属账户（${args.input.adAccountId}）不在客户登记的账户里`,
      ),
    }
  }

  const liveRes = await deps.readLiveState(args.clientId, args.input)
  if (!liveRes.ok) {
    return { fail: fail('meta_unreadable', `读不到 Meta 上的现场状态：${liveRes.error}`) }
  }
  const live = liveRes.value

  const identity = checkLiveIdentity({ input: args.input }, live)
  if (identity) return { fail: identity }

  if (!ownsAccount(live.campaign.accountId, args.input.adAccountId)) {
    return { fail: fail('ownership_mismatch', '系列不属于这个广告账户') }
  }
  if (!ownsAccount(live.adSet.accountId, args.input.adAccountId)) {
    return { fail: fail('ownership_mismatch', '广告组不属于这个广告账户') }
  }
  for (const ad of live.ads) {
    if (!ownsAccount(ad.accountId, args.input.adAccountId)) {
      return { fail: fail('ownership_mismatch', `广告 ${ad.id} 不属于这个广告账户`) }
    }
  }
  return { live, registered }
}

/**
 * 3b. 现场身份：读回的现场对象必须就是我们要开的那几个。
 *   防读取层读错对象、或漏读某条广告时，后面的「是否暂停」「是否归属」检查
 *   被悄悄跳过 —— 那等于在检查别人的东西，或漏掉一条广告没查。
 */
function checkLiveIdentity(args: { input: ActivateInput }, live: LiveDraftState): PreflightResult | null {
  if (live.campaign.id !== args.input.campaignId) {
    return fail(
      'ownership_mismatch',
      `现场读回的系列不是我们要开的那个（应为 ${args.input.campaignId}，读到 ${live.campaign.id}）`,
    )
  }
  if (live.adSet.id !== args.input.adSetId) {
    return fail(
      'ownership_mismatch',
      `现场读回的广告组不是我们要开的那个（应为 ${args.input.adSetId}，读到 ${live.adSet.id}）`,
    )
  }

  const expectedAds = new Set(args.input.adIds)
  const liveAdIds = live.ads.map((a) => a.id)
  const liveAdIdSet = new Set(liveAdIds)
  const missingAds = args.input.adIds.filter((id) => !liveAdIdSet.has(id))
  const extraAds = liveAdIds.filter((id) => !expectedAds.has(id))
  if (missingAds.length > 0 || extraAds.length > 0) {
    const parts: string[] = []
    if (missingAds.length > 0) parts.push(`现场没读到的广告：${missingAds.join('、')}`)
    if (extraAds.length > 0) parts.push(`多读到的广告：${extraAds.join('、')}`)
    return fail(
      'ownership_mismatch',
      `现场读回的广告和我们要开的对不上（${parts.join('；')}）`,
    )
  }

  // 文案回读必须覆盖全部要开的广告：少了的那条广告文案不会被闸门和红线扫描检查到。
  const readbackAdIds = live.adsReadback.map((a) => a.adId)
  const readbackAdIdSet = new Set(readbackAdIds)
  const missingReadback = args.input.adIds.filter((id) => !readbackAdIdSet.has(id))
  const extraReadback = readbackAdIds.filter((id) => !expectedAds.has(id))
  if (missingReadback.length > 0 || extraReadback.length > 0) {
    const parts: string[] = []
    if (missingReadback.length > 0) parts.push(`少：${missingReadback.join('、')}`)
    if (extraReadback.length > 0) parts.push(`多：${extraReadback.join('、')}`)
    return fail(
      'ownership_mismatch',
      `买家文案回读没覆盖全部要开的广告（${parts.join('；')}）——少了的那条广告文案不会被闸门和红线扫描检查到`,
    )
  }
  return null
}

/** 4. 状态：草案账本必须是 activating，Meta 上三层必须都还是 PAUSED。 */
async function checkState(
  args: { clientId: string; input: ActivateInput; live: LiveDraftState },
  deps: ActivateDeps,
): Promise<PreflightResult | null> {
  const draft = await deps.readDraftStatus(args.clientId, args.input.draftActionId)
  if (!draft.ok) {
    return fail('draft_not_activating', `读不到草案账本状态：${draft.error}`)
  }
  if (draft.value.status !== 'activating') {
    return fail(
      'draft_not_activating',
      `草案当前状态是「${draft.value.status ?? '读不到'}」，不是「开启中」，不能开`,
    )
  }

  const { live } = args
  if (!isPaused(live.campaign.status)) {
    return fail('not_in_paused_state', `系列当前状态是「${live.campaign.status ?? '读不到'}」，不是暂停`)
  }
  if (!isPaused(live.adSet.status)) {
    return fail('not_in_paused_state', `广告组当前状态是「${live.adSet.status ?? '读不到'}」，不是暂停`)
  }
  for (const ad of live.ads) {
    if (!isPaused(ad.status)) {
      return fail(
        'not_in_paused_state',
        `广告 ${ad.id} 当前状态是「${ad.status ?? '读不到'}」，不是暂停`,
      )
    }
  }
  return null
}

/** 5. 兄弟对象：系列/广告组下不能有不是我们建的对象，否则开系列会一起投出去。 */
function checkSiblings(input: ActivateInput, live: LiveDraftState): PreflightResult | null {
  const expectedAdSets = new Set([input.adSetId])
  const extraAdSets = live.siblingAdSetIds.filter((id) => !expectedAdSets.has(id))
  const missingAdSets = [...expectedAdSets].filter((id) => !live.siblingAdSetIds.includes(id))
  if (extraAdSets.length > 0 || missingAdSets.length > 0) {
    const parts: string[] = []
    if (extraAdSets.length > 0) parts.push(`多出的广告组：${extraAdSets.join('、')}`)
    if (missingAdSets.length > 0) parts.push(`找不到的广告组：${missingAdSets.join('、')}`)
    return fail(
      'unexpected_siblings',
      `系列/广告组下多出了不是我们建的对象，开系列会把它们一起投出去（${parts.join('；')}）`,
    )
  }

  const expectedAds = new Set(input.adIds)
  const extraAds = live.siblingAdIds.filter((id) => !expectedAds.has(id))
  const missingAds = [...expectedAds].filter((id) => !live.siblingAdIds.includes(id))
  if (extraAds.length > 0 || missingAds.length > 0) {
    const parts: string[] = []
    if (extraAds.length > 0) parts.push(`多出的广告：${extraAds.join('、')}`)
    if (missingAds.length > 0) parts.push(`找不到的广告：${missingAds.join('、')}`)
    return fail(
      'unexpected_siblings',
      `系列/广告组下多出了不是我们建的对象，开系列会把它们一起投出去（${parts.join('；')}）`,
    )
  }
  return null
}

/** 6. 指纹 + 回读闸门：Meta 上被改过、或回读发现 blocker，都不许开。 */
function checkFingerprintAndReadback(
  input: ActivateInput,
  live: LiveDraftState,
): PreflightResult | null {
  let current
  try {
    current = computeMetaFingerprint(live.fingerprintRaw)
  } catch {
    return fail('meta_side_changed', '现场数据读不全，算不出指纹，不能确认 Meta 上的设置没被改过')
  }
  const diffs = diffMetaFingerprint(current, input.metaFingerprint)
  if (diffs.length > 0) {
    return fail('meta_side_changed', `Meta 上的设置被改过：${diffs.join('、')}`)
  }
  if (live.adSet.dailyBudgetCents !== input.dailyBudgetCents) {
    return fail('meta_side_changed', '广告组每日预算在 Meta 上被改过')
  }

  const readback = checkLaunch({
    ...adaptMetaAdSet(live.adSetReadback, live.adsReadback, { expectedGeo: null }),
    industry: null,
  })
  const blockers = readback.findings.filter((f) => f.severity === 'blocker')
  if (blockers.length > 0) {
    return fail('readback_blocked', `回读闸门拦下：${blockers.map((b) => b.message).join('；')}`)
  }
  return null
}

/** 7. 起止时间：结束时间已过或不到 24 小时，Meta 会拒绝开启。 */
function checkSchedule(live: LiveDraftState, nowMs: number): PreflightResult | null {
  if (live.adSet.endTimeMs === null || live.adSet.endTimeMs < nowMs + MIN_REMAINING_MS) {
    return fail(
      'schedule_expired',
      '广告组的结束时间已过或不到 24 小时，Meta 会拒绝开启，请重新建草案',
    )
  }
  return null
}

/** 8. 红线重扫：文案里不能出现品牌红线词。 */
async function checkRedlines(
  clientId: string,
  live: LiveDraftState,
  deps: ActivateDeps,
): Promise<PreflightResult | null> {
  const redlines = await deps.loadRedlines(clientId)
  if (redlines === null) {
    return fail('redlines_unavailable', '读不到品牌红线词表，不能确认文案没踩红线')
  }
  const texts = live.adsReadback.flatMap((a) => a.texts)
  const hits = findRedlineHits(texts, redlines)
  if (hits.length > 0) {
    return fail('brand_redline_hit', `文案里出现了品牌红线词：${hits.join('、')}`)
  }
  return null
}

/** 9. 每日总预算：所有账户在投合计 + 本条不能超过客户每日总上限。 */
async function checkBudget(
  args: { clientId: string; input: ActivateInput; registered: string[] },
  deps: ActivateDeps,
): Promise<{ fail: PreflightResult } | { budget: { totalCents: number; capCents: number } }> {
  const factsRes = await deps.loadBudgetFacts(args.clientId, args.registered)
  if (!factsRes.ok) {
    return { fail: fail('budget_unavailable', `读不到预算数据：${factsRes.error}`) }
  }
  const result = checkActivationBudget({
    mode: 'pre',
    clientCapCents: factsRes.value.clientCapCents,
    capSnapshotCents: args.input.capCentsSnapshot,
    registeredAccountIds: args.registered,
    accounts: factsRes.value.accounts,
    draft: {
      accountId: args.input.adAccountId,
      campaignId: args.input.campaignId,
      adSetId: args.input.adSetId,
      dailyBudgetCents: args.input.dailyBudgetCents,
      currency: args.input.currency,
    },
  })
  if (!result.ok) {
    return { fail: fail(result.code, result.message) }
  }
  return { budget: { totalCents: result.totalCents, capCents: result.capCents } }
}

export async function runPreflight(
  args: { clientId: string; decisionId: string; input: ActivateInput },
  deps: ActivateDeps,
): Promise<PreflightResult> {
  const approver = await checkApprover(args.decisionId, deps)
  if (approver) return approver

  const kill = await checkKill(args.clientId, deps)
  if (kill) return kill

  const ownership = await checkOwnership({ clientId: args.clientId, input: args.input }, deps)
  if ('fail' in ownership) return ownership.fail

  const state = await checkState(
    { clientId: args.clientId, input: args.input, live: ownership.live },
    deps,
  )
  if (state) return state

  const siblings = checkSiblings(args.input, ownership.live)
  if (siblings) return siblings

  const fingerprint = checkFingerprintAndReadback(args.input, ownership.live)
  if (fingerprint) return fingerprint

  const schedule = checkSchedule(ownership.live, deps.now())
  if (schedule) return schedule

  const redlines = await checkRedlines(args.clientId, ownership.live, deps)
  if (redlines) return redlines

  const budget = await checkBudget(
    { clientId: args.clientId, input: args.input, registered: ownership.registered },
    deps,
  )
  if ('fail' in budget) return budget.fail

  return { ok: true, live: ownership.live, budget: budget.budget }
}
