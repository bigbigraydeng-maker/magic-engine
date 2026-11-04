/**
 * 「ME 发广告」的中枢：起草 → 建成暂停 → 回读过闸门 → 落账等人点头。
 *
 * ── 三条不许绕的规矩 ──────────────────────────────────────────────────────
 * 1. **建出来的一律是暂停的。** 从这里建出来的广告，只有 `approveDraft`（人点头）能开，
 *    且它只认白名单里的类型，点头的人必须是 PM（全局管理员，见 `@/lib/ads/spend-activation`），
 *    开之前先把授权回执写进账本，写不进去就不开。`meta-ads/execute` 的
 *    `ads.reactivate_campaign` 同样只有 PM 能用、同样先写回执。
 * 2. **闸门拦下的不进审批队列。** 拦下就是 ME 自己的活没干完，不该拿去问人
 *    「这个有问题你还开吗」—— 那是把技术判断塞回给人。
 * 3. **一步都不许静默。** 建失败、回读失败、闸门拦下，都会留一行账，且各自是
 *    不同的状态。「查不出来」永远不等于「没问题」。
 *
 * ── 账本用 flywheel_actions，没有新表 ────────────────────────────────────
 * 这张表本来就是广告动作的流水（`meta-ads/execute` 一直在写）。状态放 payload
 * 里而不是新开一列：一条广告的一生就三个状态，为它加表加列不值得，而且
 * migration 要 PM 显式点头。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdDraft } from './ad-draft'
import { validateDraft, describeDraft, DRAFT_PLAY, metaTripletFor, isApprovableKind } from './ad-draft'
import { draftNotYetBuildable } from './ad-draft-expansion'
import { publishDraftPaused, activatePublished, pausePublished, type PublishedDraft } from '@/lib/meta/ad-publisher'
import { attachReadbackFindings } from './attach-readback'
import { waitForVideoReady } from '@/lib/meta/asset-upload'
import { fetchAdSetReadback, fetchAdCreativesReadback, fetchCampaignStatus, fetchAccountMinDailyBudget } from '@/lib/meta/readback'
import { checkAudiences, renderAudienceSummary, type AudienceFact, type AudiencesChecked } from './draft-audiences'
import { adaptMetaAdSet } from './meta-readback-adapter'
import { checkLaunch, renderReadback, type LaunchFinding, type LaunchReadbackReport } from './launch-readback'
import { checkDraftRedlines, unusableRedlinePhrases } from './draft-redlines'
import { checkCreatedAsExpected } from './created-as-expected'
import {
  buildSpendActivationReceipt,
  type SpendActivationAuthority,
  type SpendActivationEntry,
  type SpendActivationReceipt,
} from '@/lib/ads/spend-activation'

/**
 * 一条广告动作在账本里的状态。
 *
 * 🔴 最初只为「起草新广告」（`ads.create_ad`）这条流水设计；`ads.auto_pause_on_d3`
 *    （src/lib/inngest/functions/ads-d3-auto-pause.ts）复用同一份词表，而不是
 *    自造一套平行状态——两条流水都是「flywheel_actions 记一件事的一生」，
 *    只是这一件事具体是什么不同。
 */
export type DraftStatus =
  /** 建出来了、闸门过了、等人点头。**只有这个状态会出现在审批页。** */
  | 'awaiting_approval'
  /**
   * 人点了头、正在 Meta 那边开。由 approveDraft 用「只有等待批准的才占得到」的条件写入占位，
   * 防止同一条被并发批准两次、或批准进行中被否决后又被覆盖。
   * 正常几秒内变成 active，或开失败后退回 awaiting_approval；若进程中途被杀会停在这里，
   * 不在审批队列里出现，需要人去 Meta 核对（宁可卡住也不重复开）。
   */
  | 'activating'
  /** 闸门拦下了 —— ME 自己的活没干完，不拿去烦人。 */
  | 'blocked'
  /** 建到一半失败了。 */
  | 'failed'
  /** 人点头开了。 */
  | 'active'
  /** 人否了。 */
  | 'rejected'
  /**
   * `ads.auto_pause_on_d3` 专用：dry-run 模式下的记录——如果开启会做什么，
   * 但没有调用任何 Meta 写接口。纯展示，不进等人点头的队列。
   */
  | 'dry_run_logged'
  /** `ads.auto_pause_on_d3` 专用：人已批准并且 Kernel 执行成功，广告组已暂停。 */
  | 'paused'

export const ADS_CREATE_ACTION = 'ads.create_ad'

// 受众核对拆在 draft-audiences.ts（本文件超 800 行上限）；这里转出口，外部 import 路径不变。
export { renderAudienceSummary }
export type { AudienceFact, AudiencesChecked }

export interface DraftRecord {
  status: DraftStatus
  draft: AdDraft
  summary: string
  campaignId?: string
  adSetId?: string
  adIds?: string[]
  findings?: LaunchFinding[]
  /** 买家会看到的每一句，原样存下来给人过目。 */
  buyerWillSee?: { adName: string; lines: string[] }[]
  /** 人能直接读的那段回读报告。 */
  readback?: string
  error?: string
  /** 建到一半没删干净的东西 —— 必须有人去 Meta 后台收拾。 */
  orphans?: string[]
  /**
   * 查了几条客户禁用词。`null` = 没读到 / 没查；`0` = 查过，客户没配。
   * 这两种必须分得出：「红线没生效」不能长得和「红线是空的」一样。
   */
  redlinesChecked?: number | null
  /** 建前读到的账户最低日预算（最小单位）；`null` = 没读到 / 没查（放行，Meta 兜底）。 */
  minBudgetChecked?: number | null
  /**
   * 建前核过的受众：包含 / 排除各读到的事实，以及过没过。
   * `null` **只**表示草案没有受众（没查）；查了但失败会记 `outcome: 'failed'`。
   */
  audiencesChecked?: AudiencesChecked | null
  /** 名单里因为太短没拿来比的条目（如果有）。 */
  redlinesSkipped?: string[]
  /** 回读发现有东西不是暂停的 → 我们补了一刀暂停，结果在这里。 */
  autoPause?: { ok: boolean; failed: string[] }
  /**
   * 谁、凭什么把这条开起来的回执。开之前先写 `authorized_pending`，
   * Meta 成功后 `executed`，失败 `meta_failed`（带 error）。
   */
  activation?: SpendActivationReceipt & {
    status: 'authorized_pending' | 'executed' | 'meta_failed'
    error?: string
  }
}

export interface CreateDraftDeps {
  supabase: SupabaseClient
  adAccountId: string
  accessToken: string
  /** 客户所在地区，用来对照投放地区。给不出就跳过那条检查。 */
  expectedGeo?: string | null
  /** 客户行业（`clients.industry`），闸门文案从广告剧本取叫法。给不出就用中性词。 */
  industry?: string | null
  /**
   * 客户禁用词。`undefined` = 没加载（私信类型会因此拒建）；`[]` = 查过、没配。
   * 不要把读库失败的结果顺手写成 `[]`。
   */
  brandRedlines?: readonly string[]
  /** 可注入的时钟，测试用。 */
  now?: () => number
}

/**
 * 私信类型整次请求的时间预算（从请求开始算，毫秒）。
 * `maxDuration = 120` 是 Vercel 的说法，本仓部署在 Render，真实代理上限没核实过，
 * 所以按常见的 100 秒再留余量。最坏一路：等转码 ≤25s → 写到 45s 为止 → 55s 前没写完就不读 →
 * 回读 ≤15s（并发）→ 补暂停 ≤15s（并发）→ 落账。设计稿 §7。
 */
const BUDGET = {
  waitForVideoMs: 25_000,
  stopWritingMs: 45_000,
  skipReadbackAfterMs: 55_000,
  giveUpRollbackMs: 80_000,
  /** 补暂停是在止损，比回滚更该做完，所以允许多用一点 —— 但也要有顶。 */
  giveUpPauseMs: 92_000,
} as const

async function record(
  supabase: SupabaseClient,
  clientId: string,
  payload: DraftRecord,
): Promise<string | null> {
  const { data } = await supabase
    .from('flywheel_actions')
    .insert({
      client_id: clientId,
      flywheel: 'ads',
      action_type: ADS_CREATE_ACTION,
      execution_mode: 'third_party',
      vendor: 'meta',
      payload,
    })
    .select('id')
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

export interface CreateDraftOutcome {
  actionId: string | null
  status: DraftStatus
  summary: string
  findings: LaunchFinding[]
  readback?: string
  error?: string
}

/**
 * 起草一条广告并建成暂停状态，然后立刻过闸门。
 *
 * 返回的 `status` 就是它现在的处境：`awaiting_approval` 才轮到人看。
 */
export async function createDraftForApproval(
  draft: AdDraft,
  deps: CreateDraftDeps,
): Promise<CreateDraftOutcome> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const base: RecordBase = {
    summary: describeDraft(draft),
    redlinesChecked: deps.brandRedlines === undefined ? null : deps.brandRedlines.length,
    redlinesSkipped: skippedRedlines(deps.brandRedlines),
  }

  // 发布器今天只会建单个广告组、预算在组上。新字段对不上时，在任何 Meta 读取或写入之前停下。
  // 不删除、不修改已经存在的广告对象。
  const held = draftNotYetBuildable(draft)
  if (held) return failedOutcome(deps, draft, { ...base, error: held })

  // ── 0. ME 自己就能判的错，不要浪费一次真实创建 ────────────────────────
  const problems = [...validateDraft(draft), ...checkDraftRedlines(draft, deps.brandRedlines)]
  if (problems.length > 0) {
    const error = problems.map((p) => `${p.field}：${p.message}`).join('；')
    return failedOutcome(deps, draft, { ...base, error })
  }

  // ── 0.3 受众：属不属于这个账户、准备好没有（失败关闭）─────────────
  const audiences = await checkAudiences(draft, deps)
  base.audiencesChecked = audiences.checked
  if (audiences.error) return failedOutcome(deps, draft, { ...base, error: audiences.error })

  // ── 0.4 日预算低于账户最低日预算 → Meta 一定拒，别浪费一次真实创建 ──────
  const budget = await checkMinDailyBudget(draft, deps)
  base.minBudgetChecked = budget.checked
  if (budget.error) return failedOutcome(deps, draft, { ...base, error: budget.error })

  // ── 0.5 私信类型：视频上传完还要转码，转码没完就建会失败 ───────────────
  const waitError = await waitForTranscode(draft, deps, now)
  if (waitError) return failedOutcome(deps, draft, { ...base, error: waitError })

  // ── 1. 建（全程暂停）────────────────────────────────────────────────
  const published = await publishDraftPaused(
    draft, deps.adAccountId, deps.accessToken, publishBudgetFor(draft, startedAt, now),
  )
  if (!published.ok) {
    const error = `建到「${published.step}」这步失败：${published.error}`
    const orphans = published.orphans.length > 0 ? published.orphans : undefined
    return failedOutcome(deps, draft, { ...base, error, orphans })
  }

  // ── 2+3. 回读 → 闸门 ────────────────────────────────────────────────
  return gateReadback(draft, published, deps, {
    ...base, startedAt, now, tooLateToRead: now() > startedAt + BUDGET.skipReadbackAfterMs,
  })
}

interface RecordBase {
  summary: string
  redlinesChecked: number | null
  /**
   * 建前读到的账户最低日预算（账户币种最小单位）。`null` = 没读到 / 没查，**放行**（Meta 会兜底拒）；
   * 数字 = 查过。跟 `redlinesChecked` 同口径，账本看得出「查过够」还是「没查到放行」。
   */
  minBudgetChecked?: number | null
  audiencesChecked?: AudiencesChecked | null
  /** 名单里太短、没拿来比的条目 —— 不静默忽略，记下来让人知道有条目没生效。 */
  redlinesSkipped?: string[]
}

interface GateContext extends RecordBase {
  startedAt: number
  now: () => number
  tooLateToRead: boolean
}

function skippedRedlines(redlines: readonly string[] | undefined): string[] | undefined {
  const skipped = redlines ? unusableRedlinePhrases(redlines) : []
  return skipped.length > 0 ? skipped : undefined
}

/**
 * 读不到最低日预算就放行（Meta 自己会拒），`checked` 记 null；读到了而且草案低于它 → 人话报错。
 * 换算永远 ×100，与 `adSetBodyFor`（ad-publisher）同口径；本仓目前没有零小数币种（JPY 等）的账户。
 */
async function checkMinDailyBudget(
  draft: AdDraft,
  deps: CreateDraftDeps,
): Promise<{ error: string | null; checked: number | null }> {
  const min = await fetchAccountMinDailyBudget(deps.adAccountId, deps.accessToken)
  if (!min) return { error: null, checked: null }
  const draftMinor = Math.round(draft.dailyBudget * 100)
  if (draftMinor >= min.minDailyBudgetMinor) return { error: null, checked: min.minDailyBudgetMinor }
  const shown = (min.minDailyBudgetMinor / 100).toFixed(2)
  return {
    checked: min.minDailyBudgetMinor,
    error: `每天预算 ${draft.dailyBudget} ${min.currency} 低于这个广告账户 Meta 要求的最低日预算 ${shown} ${min.currency}，Meta 一定会拒收；请把日预算调到不低于 ${shown}。`,
  }
}

/** 任一创意带视频就等转码（视频没转完建创意会报「视频还没准备好」）；返回错误文案，`null` = 可以继续。 */
async function waitForTranscode(
  draft: AdDraft,
  deps: CreateDraftDeps,
  now: () => number,
): Promise<string | null> {
  const videoIds = draft.creatives.map((c) => c.videoId).filter((v): v is string => !!v)
  if (videoIds.length === 0) return null
  const ready = await waitForVideoReady(
    videoIds,
    deps.accessToken,
    { timeoutMs: BUDGET.waitForVideoMs, now },
  )
  return ready.ok ? null : ready.error
}

/** 私信类型和任一创意带视频的草案有整次请求的时间预算（与 waitForTranscode 同口径）；其它沿用旧行为（不限）。 */
function publishBudgetFor(draft: AdDraft, startedAt: number, now: () => number) {
  const hasVideo = draft.creatives.some((c) => !!c.videoId)
  if (draft.kind !== 'messenger_conversation' && !hasVideo) return undefined
  return {
    stopWritingAt: startedAt + BUDGET.stopWritingMs,
    giveUpRollbackAt: startedAt + BUDGET.giveUpRollbackMs,
    now,
  }
}

async function failedOutcome(
  deps: CreateDraftDeps,
  draft: AdDraft,
  f: RecordBase & { error: string; orphans?: string[] },
): Promise<CreateDraftOutcome> {
  const id = await record(deps.supabase, draft.clientId, {
    status: 'failed', draft, summary: f.summary, error: f.error,
    redlinesChecked: f.redlinesChecked, redlinesSkipped: f.redlinesSkipped, orphans: f.orphans,
    minBudgetChecked: f.minBudgetChecked ?? null,
    audiencesChecked: f.audiencesChecked ?? null,
  })
  return { actionId: id, status: 'failed', summary: f.summary, findings: [], error: f.error }
}

/** 私信类型的「建成预期」检查；其它类型没有（`campaignStatus === undefined`），返回空。 */
function expectedFindings(
  draft: AdDraft,
  published: PublishedDraft,
  readback: {
    campaignStatus: string | null | undefined
    adSet: NonNullable<Awaited<ReturnType<typeof fetchAdSetReadback>>>
    ads: NonNullable<Awaited<ReturnType<typeof fetchAdCreativesReadback>>>
  },
  deps: CreateDraftDeps,
): LaunchFinding[] {
  if (draft.kind !== 'messenger_conversation' || readback.campaignStatus === undefined) return []
  const t = metaTripletFor(draft.kind)
  return checkCreatedAsExpected(
    {
      optimizationGoal: t.optimizationGoal,
      destinationType: t.destinationType,
      adCount: published.adIds.length,
      brandRedlines: deps.brandRedlines ?? [],
    },
    { campaignStatus: readback.campaignStatus, adSet: readback.adSet, ads: readback.ads },
    { campaign: !published.reusedCampaign, adSet: true },
  )
}

/** 回读不出来 ≠ 没问题。建都建出来了，但没人能保证它是干净的 —— 不进审批队列。 */
async function blockedUnreadable(
  draft: AdDraft,
  published: PublishedDraft,
  deps: CreateDraftDeps,
  base: RecordBase,
  why: string,
): Promise<CreateDraftOutcome> {
  const error = `广告建出来了（暂停着），但${why} —— 这是「查不出来」，不是「没问题」。在查清楚之前不该开。`
  const id = await record(deps.supabase, draft.clientId, {
    status: 'blocked', draft, summary: base.summary, error,
    redlinesChecked: base.redlinesChecked, redlinesSkipped: base.redlinesSkipped,
    minBudgetChecked: base.minBudgetChecked ?? null,
    audiencesChecked: base.audiencesChecked ?? null,
    campaignId: published.campaignId, adSetId: published.adSetId, adIds: published.adIds,
  })
  return { actionId: id, status: 'blocked', summary: base.summary, findings: [], error }
}

/** 已有的闸门（多语言混放、重定向被放宽……）。 */
function launchReportFor(
  draft: AdDraft,
  deps: CreateDraftDeps,
  rawAdSet: NonNullable<Awaited<ReturnType<typeof fetchAdSetReadback>>>,
  ads: NonNullable<Awaited<ReturnType<typeof fetchAdCreativesReadback>>>,
): LaunchReadbackReport {
  return checkLaunch({
    ...adaptMetaAdSet(rawAdSet, ads, {
      expectedGeo: deps.expectedGeo ?? null,
      // 打法确实是重定向就直说；**不是的时候不能传 false**。
      // 传 false 会顶掉名字启发式那道保险 —— 一个叫「暖池重定向」的组
      // 就此不再受重定向那几条检查约束，而它恰好是最需要被查的那种。
      // 2026-08-05 自测抓到：这行原来无条件传 false，等于把闸门关了一半。
      // 声明了包含受众也等于声明了重定向；仍然绝不传 false。
      isRetargeting: DRAFT_PLAY[draft.kind] === 'warm_pool_retarget' || (draft.audienceIds?.length ?? 0) > 0 ? true : undefined,
    }),
    industry: deps.industry ?? null,
    expectedOptimizationGoal: metaTripletFor(draft.kind).optimizationGoal,
    ...(draft.audienceIds && draft.audienceIds.length > 0 ? { expectedAudienceIds: draft.audienceIds } : {}),
    ...(draft.excludedAudienceIds && draft.excludedAudienceIds.length > 0 ? { expectedExcludedAudienceIds: draft.excludedAudienceIds } : {}),
  })
}

/** 回读 → 过闸门 → 落账。 */
async function gateReadback(
  draft: AdDraft,
  published: PublishedDraft,
  deps: CreateDraftDeps,
  ctx: GateContext,
): Promise<CreateDraftOutcome> {
  if (ctx.tooLateToRead) {
    return blockedUnreadable(draft, published, deps, ctx, '这次请求已经用掉太多时间，没来得及回读它的真实设置')
  }
  const wantsExpected = draft.kind === 'messenger_conversation'
  const [rawAdSet, ads, campaignStatus] = await Promise.all([
    fetchAdSetReadback(published.adSetId, deps.accessToken),
    fetchAdCreativesReadback(published.adSetId, deps.accessToken),
    wantsExpected ? fetchCampaignStatus(published.campaignId, deps.accessToken) : undefined,
  ])
  if (!rawAdSet || !ads) {
    return blockedUnreadable(draft, published, deps, ctx, '回读不到它的真实设置')
  }

  const report = launchReportFor(draft, deps, rawAdSet, ads)
  const extra = [
    ...expectedFindings(draft, published, { campaignStatus, adSet: rawAdSet, ads }, deps),
    ...attachReadbackFindings(draft, rawAdSet),
  ]
  const autoPause = extra.some((f) => f.code === 'not_paused')
    ? await pausePublished(published, deps.accessToken, {
        deadlineAt: ctx.startedAt + BUDGET.giveUpPauseMs, now: ctx.now,
      })
    : undefined

  const merged: LaunchReadbackReport = {
    ...report,
    findings: [...report.findings, ...extra],
    safeToActivate: report.safeToActivate && !extra.some((f) => f.severity === 'blocker'),
  }
  return recordGate(draft, published, deps, ctx, merged, autoPause)
}

async function recordGate(
  draft: AdDraft,
  published: PublishedDraft,
  deps: CreateDraftDeps,
  ctx: RecordBase,
  merged: LaunchReadbackReport,
  autoPause: { ok: boolean; failed: string[] } | undefined,
): Promise<CreateDraftOutcome> {
  const status: DraftStatus = merged.safeToActivate ? 'awaiting_approval' : 'blocked'
  const audienceSummary = renderAudienceSummary(ctx.audiencesChecked)
  const readback =
    renderReadback(merged) +
    renderAutoPause(autoPause) +
    (audienceSummary ? `\n\n${audienceSummary}` : '')
  const id = await record(deps.supabase, draft.clientId, {
    status, draft, summary: ctx.summary, readback,
    campaignId: published.campaignId, adSetId: published.adSetId, adIds: published.adIds,
    findings: merged.findings,
    buyerWillSee: merged.buyerWillSee,
    redlinesChecked: ctx.redlinesChecked,
    redlinesSkipped: ctx.redlinesSkipped,
    minBudgetChecked: ctx.minBudgetChecked ?? null,
    audiencesChecked: ctx.audiencesChecked ?? null,
    autoPause,
  })
  return { actionId: id, status, summary: ctx.summary, findings: merged.findings, readback }
}

function renderAutoPause(r: { ok: boolean; failed: string[] } | undefined): string {
  if (!r) return ''
  return r.ok
    ? '\n\n【补暂停】回读发现有东西不是暂停的，已经补了一刀暂停。'
    : `\n\n【补暂停】🔴 回读发现有东西不是暂停的，补暂停时这些没成功，要有人立刻去 Meta 后台处理：${r.failed.join('；')}`
}

/**
 * 人点头 → 真的开。
 *
 * 开之前**再查一次状态**：草案可能是几小时前建的，中间 Meta 可能改过东西，
 * 也可能同一条被点了两次。只有 `awaiting_approval` 能开。
 * 先用条件写入「占位」成 activating（只有 awaiting_approval 占得到），占不到就不开；开成功写 active。
 * 审批页开失败会马上退回 awaiting_approval。确认卡不能这么做：回读和补暂停还没完，
 * 退回之后另一次确认会占走，这次再去暂停就会把对方正在开的广告关掉。确认卡占到失败结束。
 */
export async function approveDraft(
  actionId: string,
  supabase: SupabaseClient,
  accessToken: string,
  authority: SpendActivationAuthority,
  entry: SpendActivationEntry = 'ad-approval',
): Promise<{ ok: true; warning?: string } | { ok: false; error: string; holding?: boolean }> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('id', actionId)
    .eq('action_type', ADS_CREATE_ACTION)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: '找不到这条草案' }

  const p = (data as { payload: DraftRecord | null }).payload
  if (!p) return { ok: false, error: '这条草案没有内容' }
  // 白名单：不在名单里（私信广告、账本里 kind 缺失或写了陌生值的旧记录）一律不开，零 Meta 调用。
  if (!isApprovableKind(p.draft?.kind)) {
    return {
      ok: false,
      error:
        '这条草案的类型现在不能用「开」按钮打开：私信广告要等「PM 授权 + 每日总预算检查」上线之后才行，' +
        '在那之前它只能是暂停状态（账本里没写类型的旧草案同样不能开）。',
    }
  }
  if (p.status !== 'awaiting_approval') {
    return { ok: false, error: `这条现在是「${p.status}」，只有等待批准的才能开` }
  }
  if (!p.campaignId || !p.adSetId || !p.adIds) {
    return { ok: false, error: '这条草案没记下 Meta 那边的 id，开不了' }
  }

  const hasAudiences =
    (p.draft.audienceIds?.length ?? 0) > 0 || (p.draft.excludedAudienceIds?.length ?? 0) > 0
  if (hasAudiences) {
    const audienceError = await verifyAudiencesStillAttached(actionId, supabase, p, accessToken)
    if (audienceError) return { ok: false, error: audienceError }
  }

  const clientId = (data as { client_id: string }).client_id
  const receipt = buildSpendActivationReceipt({
    authority,
    entry,
    clientId,
    campaignId: p.campaignId,
    draftActionId: actionId,
  })

  // 占位：只有还在等待批准的才占得到。占不到说明别处已经动过它（并发批准 / 否决），不开。
  const claimPayload: DraftRecord = {
    ...p,
    status: 'activating',
    activation: { ...receipt, status: 'authorized_pending' },
  }
  const claim = await supabase
    .from('flywheel_actions')
    .update({ payload: claimPayload })
    .eq('id', actionId)
    .eq('payload->>status', 'awaiting_approval')
    .select('id')
  if (claim.error) {
    return { ok: false, error: `授权回执写不进去，没有开：${claim.error.message}` }
  }
  if (!claim.data || claim.data.length !== 1) {
    return { ok: false, error: '这条刚被别处处理过（可能已经被开启或否决），这次没有再开。' }
  }

  const skipIds = p.draft.existingCampaignId ? [p.campaignId] : []
  const r = await activatePublished(
    { campaignId: p.campaignId, adSetId: p.adSetId, adIds: p.adIds },
    accessToken,
    skipIds.length > 0 ? { skipIds } : undefined,
  )
  if (!r.ok && entry === 'go-live-card') return noteHeldActivation(actionId, supabase, p, receipt, r.error)
  if (!r.ok) {
    const failedPayload: DraftRecord = {
      ...p,
      status: 'awaiting_approval',
      activation: { ...receipt, status: 'meta_failed', error: r.error },
    }
    const failed = await supabase
      .from('flywheel_actions')
      .update({ payload: failedPayload })
      .eq('id', actionId)
      .eq('payload->>status', 'activating')
      .select('id')
    if (failed.error || !failed.data || failed.data.length !== 1) {
      console.error(
        '[draft-and-gate] meta_failed receipt write-back failed:',
        actionId,
        failed.error?.message ?? 'no row matched',
      )
      return {
        ok: false,
        error: `${r.error}（另：失败记录没写成功，这条会停在「开启中」，请到 Meta 后台核对）`,
      }
    }
    return r
  }

  const donePayload: DraftRecord = {
    ...p,
    status: 'active',
    activation: { ...receipt, status: 'executed' },
  }
  const done = await supabase
    .from('flywheel_actions')
    .update({ payload: donePayload })
    .eq('id', actionId)
    .eq('payload->>status', 'activating')
    .select('id')
  if (done.error || !done.data || done.data.length !== 1) {
    const msg = done.error?.message ?? '状态已被改动'
    return { ok: true, warning: `广告已开，但账本状态没写成功：${msg}` }
  }
  return { ok: true }
}

/**
 * 确认卡开失败：记一笔失败，但状态留在 activating。
 * 占位要留到回读和补暂停结束，调用方再把它放回等待批准。
 */
async function noteHeldActivation(
  actionId: string,
  supabase: SupabaseClient,
  p: DraftRecord,
  receipt: SpendActivationReceipt,
  error: string,
): Promise<{ ok: false; error: string; holding: true }> {
  const failed = await supabase
    .from('flywheel_actions')
    .update({
      payload: {
        ...p,
        status: 'activating' satisfies DraftStatus,
        activation: { ...receipt, status: 'meta_failed', error },
      },
    })
    .eq('id', actionId)
    .eq('payload->>status', 'activating')
    .select('id')
  if (failed.error || !failed.data || failed.data.length !== 1) {
    return {
      ok: false,
      holding: true,
      error: `${error}（另：失败记录没写成功，这条会停在「开启中」，请到 Meta 后台核对）`,
    }
  }
  return { ok: false, error, holding: true }
}

/**
 * 开之前再核一次：草案挂了受众，广告组上现在是不是还挂着它们。
 * 中间可能被删除、收回共享或过期 —— 那样开出去就是投给错的人。
 * 返回错误文案（已写回账本）或 null（都还在）。
 */
async function verifyAudiencesStillAttached(
  actionId: string,
  supabase: SupabaseClient,
  p: DraftRecord,
  accessToken: string,
): Promise<string | null> {
  const raw = await fetchAdSetReadback(p.adSetId as string, accessToken)
  if (!raw) {
    const error = '读不到广告组现在的受众设置，没法确认受众还挂着，所以没开'
    await writeBackAudienceError(actionId, supabase, { ...p, error })
    return error
  }
  // 复用建后同一道闸（checkLaunch）的受众 blocker：名单缺失、放宽、优势受众开着都拒开。
  // 只取受众相关的 blocker —— 创意 / 版位等别的检查建后已过，这里不重复判。
  const hasIncluded = (p.draft.audienceIds?.length ?? 0) > 0
  // 只给排除名单的草稿也要过「放宽 / 优势受众」两条：排除名单本身扩量时仍有效（Meta 文档：扩展不改排除），
  // 但我们建的时候明确要求关掉优势受众，开前读到它被打开 = 设置在中途漂移，年龄等定向建议会被放宽，按保守口径拦下。
  const hasExcluded = (p.draft.excludedAudienceIds?.length ?? 0) > 0
  const report = checkLaunch({
    ...adaptMetaAdSet(raw, [], { expectedGeo: null, isRetargeting: hasIncluded || hasExcluded ? true : undefined }),
    ...(hasIncluded ? { expectedAudienceIds: p.draft.audienceIds } : {}),
    ...(hasExcluded ? { expectedExcludedAudienceIds: p.draft.excludedAudienceIds } : {}),
  })
  // 读不到 ≠ 安全：缺字段时 checkLaunch 只给 warn（unknown），但开前「任何读不到一律拒开」——
  // 优势受众读不到：一律拦；「允许投给名单外」读不到：只在草稿带包含名单时拦（只给排除名单时 Meta 本来就可能不返回该字段）。
  const blockers = report.findings.filter(
    (f) =>
      (f.severity === 'blocker' && OPEN_TIME_AUDIENCE_CODES.has(f.code)) ||
      f.code === 'retargeting_advantage_unknown' ||
      (f.code === 'retargeting_relaxation_unknown' && hasIncluded),
  )
  if (blockers.length === 0) return null

  const error = `广告组上的受众设置现在不对：${blockers.map((f) => f.message).join('；')}（可能被删除、收回共享、过期，被打开了扩量，或这些设置读不到），所以没开`
  await writeBackAudienceError(actionId, supabase, { ...p, status: 'blocked', error })
  return error
}

const OPEN_TIME_AUDIENCE_CODES: ReadonlySet<string> = new Set([
  'audience_not_attached',
  'excluded_audience_not_attached',
  'retargeting_relaxed',
  'retargeting_advantage_audience',
])

/** 把受众核对失败写回账本；写不进去只记日志，不掩盖原始错误。 */
async function writeBackAudienceError(
  actionId: string,
  supabase: SupabaseClient,
  payload: DraftRecord,
): Promise<void> {
  const res = await supabase
    .from('flywheel_actions')
    .update({ payload })
    .eq('id', actionId)
    .eq('payload->>status', 'awaiting_approval')
    .select('id')
  if (res.error) {
    console.error('[draft-and-gate] audience check write-back failed:', actionId, res.error.message)
  }
}

/** 人否了 —— 只改账本状态，Meta 那边它本来就是暂停的。 */
export async function rejectDraft(
  actionId: string,
  supabase: SupabaseClient,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabase
    .from('flywheel_actions')
    .select('payload')
    .eq('id', actionId)
    .eq('action_type', ADS_CREATE_ACTION)
    .maybeSingle()

  const p = (data as { payload: DraftRecord | null } | null)?.payload
  if (!p) return { ok: false, error: '找不到这条草案' }
  if (p.status !== 'awaiting_approval') {
    return { ok: false, error: `这条现在是「${p.status}」，只有等待批准的才能否决` }
  }

  const rejected = await supabase
    .from('flywheel_actions')
    .update({
      payload: { ...p, status: 'rejected' satisfies DraftStatus, error: reason ?? p.error },
    })
    .eq('id', actionId)
    .eq('payload->>status', 'awaiting_approval')
    .select('id')
  if (rejected.error) {
    return { ok: false, error: rejected.error.message }
  }
  if (!rejected.data || rejected.data.length !== 1) {
    return { ok: false, error: '这条刚被别处处理过，这次没有否决。' }
  }
  return { ok: true }
}
