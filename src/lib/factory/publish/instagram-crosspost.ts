/**
 * Instagram 交叉发布扫描器 —— 把已发布的 Facebook Reel 通过 Publer 复制到
 * 客户的 Instagram 账号。
 *
 * 为什么单独一个模块：cron 路由每次只调用一次 runInstagramCrosspost，所有
 * 副作用（数据库、Publer、Inngest、三本书）都通过 CrosspostDeps 注入，方便
 * 单测覆盖而不依赖网络或数据库。
 *
 * 🔴 关键语义：
 *  - 失败关闭：没有 live 授权 => 只发 Publer 草稿，绝不公开。
 *  - 一次运行只处理一个工单（上传很慢），其余候选留给下一轮。
 *  - 认领（claim）先于一切检查：任何后续失败都能留下机器可读回执。
 *  - 乐观写：每次写 output 都带 updated_at 守卫，冲突即 lost_race。
 *  - 发布成功后绝不回滚回执：回滚会导致重复发布。
 *  - 排期(scheduled)只是「已提交」，不是「已发布」：这里不写完成账(execution_items completed /
 *    fde_work_logs「已发到」)。Publer 只暴露 draft/scheduled，没有读回 published 的路径，
 *    读回能力上线前三本账不记，避免排期失败时永久记一次不存在的成功发布。
 */

import {
  publerInstagramAdapter,
  isPublerAccountError,
  isPublerRejectedError,
} from './instagram-publer-adapter'
import type { PublishAdapter, PublishTarget, PublishedRef } from '../types'
import {
  scanPublishCaption,
  validateVideoUrl,
  PUBLIC_BASE,
  writeThreeBooks,
} from './publish-worker'
import { sanitizeFailReason } from './publish-display'
import {
  REEL_AUTO_CHECK_KEYS,
  humanKeysForStored,
  validateContentChecklist,
  checklistPasses,
} from '@/lib/social/content-review'
import {
  buildReelFirstComment,
  buildReelPostCaption,
} from '@/lib/social/reel-publishing'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { emitFor, emitMissingEvents } from './instagram-crosspost-events'
import { createSupabaseCrosspostStore } from './instagram-crosspost-store'
import {
  MAX_FB_AGE_MS,
  decideSweep,
  markCreating,
  markFailed,
  markSubmitted,
  newClaim,
  readReceipt,
  withReceipt,
  type FacebookVideoState,
  type InstagramFailureKind,
  type InstagramPublishReceipt,
} from './instagram-receipt'

/** 三本账里 Instagram 这一行的动作类型(≠ Facebook 的 factory_reel_publish) */
export const INSTAGRAM_BOOKS_ACTION_TYPE = 'factory_reel_instagram_crosspost'

/** 同一客户两次 Instagram 提交之间的最小间隔 */
export const MIN_GAP_PER_CLIENT_MS = 30 * 60 * 1000

/**
 * Instagram 是否真发:必须同时满足总开关 FACTORY_PUBLISH_LIVE 和独立开关 FACTORY_INSTAGRAM_LIVE。
 * 独立开关默认关:Instagram 这条线第一次真连 Publer 必须先走草稿验证(请求体没在真接口上验证过),
 * 不能因为 Facebook 那边早就开了真发就让 Instagram 第一轮直接公开。
 */
export function instagramLive(factoryLive: boolean, env: Record<string, string | undefined> = process.env): boolean {
  return factoryLive && env.FACTORY_INSTAGRAM_LIVE === 'true'
}

/**
 * 哪些客户允许 Instagram 真发:环境变量 FACTORY_INSTAGRAM_LIVE_CLIENTS(逗号分隔的客户 id)。
 * 为什么要按客户列名单:Publer 连接器里绑了 Instagram 账号,只代表「这个客户能用 Publer 发帖」,
 * 不代表客户同意工厂 Reel 自动跟发;只靠全局开关,一开就会让所有绑了账号的客户的 Reel 都真排期。
 * 没配 = 空名单 = 谁都不真发(全是草稿)。
 */
export function instagramLiveClients(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  return new Set((env.FACTORY_INSTAGRAM_LIVE_CLIENTS ?? '').split(',').map((x) => x.trim()).filter(Boolean))
}

/**
 * 允许处理的「客户id:Publer 账号id」名单(FACTORY_INSTAGRAM_ENABLED_CLIENTS,逗号分隔)。
 * 只有被点名的「客户:账号」才会被处理(连接器绑定客户自己能改,不能当依据);
 * 没配 = 谁都不处理,连草稿也不建。
 */
export function instagramEnabledClients(env: Record<string, string | undefined> = process.env): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const entry of (env.FACTORY_INSTAGRAM_ENABLED_CLIENTS ?? '').split(',')) {
    const idx = entry.indexOf(':')
    if (idx < 0) continue
    const clientId = entry.slice(0, idx).trim()
    const accountId = entry.slice(idx + 1).trim()
    if (clientId.length === 0 || accountId.length === 0) continue
    out.set(clientId, accountId) // 重复客户保留最后一个
  }
  return out
}

/** 每次运行最多扫描的候选数。 */
const CANDIDATE_LIMIT = 50

/** 审批门失败时的统一原因。 */
const APPROVAL_FAIL =
  'approval checklist missing, incomplete, failed, or not measured'

export interface CrosspostCandidate {
  id: string
  client_id: string
  master_brief_id: string | null
  angle: string | null
  brief: Record<string, unknown>
  output: Record<string, unknown>
  review_ref: Record<string, unknown>
  published_ref: Record<string, unknown>
  updated_at: string
}

export interface CrosspostStore {
  /** published Facebook work orders, newest first */
  listCandidates(limit: number): Promise<CrosspostCandidate[]>
  /** client's Instagram target, or null when the client has none configured */
  loadInstagramTarget(clientId: string): Promise<PublishTarget | null>
  /** optimistic write: only succeeds when the row's updated_at still equals expectedUpdatedAt */
  writeOutput(
    id: string,
    expectedUpdatedAt: string,
    output: Record<string, unknown>,
  ): Promise<{ ok: true; updatedAt: string } | { ok: false }>
}

export interface CrosspostDeps {
  store: CrosspostStore
  adapter: PublishAdapter
  scanCaption: (
    clientId: string,
    masterBriefId: unknown,
    text: string,
  ) => Promise<string | null>
  validateVideoUrl: (url: string) => Promise<string | null>
  publicBase: () => string
  emit: (event: {
    id: string
    name: string
    data: Record<string, unknown>
  }) => Promise<{ event_ids: string[] }>
  recordBooks: (
    id: string,
    ref: PublishedRef,
    clientId: string,
    angle: string,
  ) => Promise<void>
  now: () => Date
  newRequestId: () => string
}

export interface InstagramCrosspostOutcome {
  order_id: string
  result:
    | 'no_candidate'
    | 'drafted'
    | 'scheduled'
    | 'recovered'
    | 'failed'
    | 'lost_race'
  detail?: string
  /** 本轮有几个客户的 Instagram 配置读失败(缺品牌名/查库抖动)—— 写进 cron 汇总,不让它只死在日志里 */
  config_errors?: number
}

/** 当前正在处理的工单的可变状态：回执 + 最新 updated_at + 最新 output。 */
export interface Current {
  candidate: CrosspostCandidate
  receipt: InstagramPublishReceipt
  updatedAt: string
  output: Record<string, unknown>
}

/** 把 unknown 收窄成普通对象（非数组、非 null）。 */
function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/** 从 published_ref 中安全读取 video_state。 */
function readFbVideoState(ref: Record<string, unknown>): FacebookVideoState {
  const v = ref.video_state
  if (v === 'DRAFT' || v === 'PUBLISHED') return v
  return undefined
}

/** 从 output 中安全读取 video_path。 */
function readVideoPath(output: Record<string, unknown>): string | null {
  const v = output.video_path
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 从 brief 中安全读取 copy 对象。 */
function readCopy(brief: Record<string, unknown>): Record<string, unknown> {
  return asPlainObject(brief.copy) ?? {}
}

/** 从 copy 中安全读取 endcard 对象。 */
function readEndcard(copy: Record<string, unknown>): Record<string, unknown> {
  return asPlainObject(copy.endcard) ?? {}
}

/** 生产依赖：未注入的部分用真实实现。 */
function resolveDeps(deps?: Partial<CrosspostDeps>): CrosspostDeps {
  return {
    store: deps?.store ?? createSupabaseCrosspostStore(),
    adapter: deps?.adapter ?? publerInstagramAdapter,
    scanCaption: deps?.scanCaption ?? scanPublishCaption,
    validateVideoUrl: deps?.validateVideoUrl ?? validateVideoUrl,
    publicBase: deps?.publicBase ?? PUBLIC_BASE,
    emit: deps?.emit ?? sendInngestEvent,
    // 三本账用独立的 action_type:同一工单的 Facebook 回执行(factory_reel_publish)必须保持唯一,
    // 测量那边按 (action_type, work_order_id) 回读,两行同键会让 Facebook 的测量登记报错。
    recordBooks: deps?.recordBooks ?? ((id, ref, clientId, angle) =>
      writeThreeBooks(id, ref, clientId, angle, { actionType: INSTAGRAM_BOOKS_ACTION_TYPE, channelLabel: 'Instagram(Publishing Hub)' })),
    now: deps?.now ?? (() => new Date()),
    newRequestId: deps?.newRequestId ?? (() => crypto.randomUUID()),
  }
}

/**
 * 扫描入口：每次运行最多处理一个工单。
 * 没有可处理候选时，顺带补发漏掉的 Inngest 事件（幂等）。
 */
export async function runInstagramCrosspost(
  // liveClientIds:允许真发的客户名单;不传 = 空名单 = 全部只存草稿(失败关闭)
  // enabledClients:允许处理的「客户:账号」名单;不传 = 空 = 谁都不处理(连草稿也不建)
  opts: { live: boolean; liveClientIds?: ReadonlySet<string>; enabledClients?: ReadonlyMap<string, string> },
  deps?: Partial<CrosspostDeps>,
): Promise<InstagramCrosspostOutcome> {
  const d = resolveDeps(deps)
  const candidates = await d.store.listCandidates(CANDIDATE_LIMIT)
  const now = d.now()
  const targets = new Map<string, TargetLookup>() // 同一客户一轮只查一次
  const stats = { configErrors: 0 }
  const finish = (o: InstagramCrosspostOutcome): InstagramCrosspostOutcome =>
    stats.configErrors > 0 ? { ...o, config_errors: stats.configErrors } : o

  const enabled = opts.enabledClients ?? new Map<string, string>()
  // 防重复发布的对账可能失效时,不许真发,只许草稿。
  const unverifiedPresent = candidates.some((c) => readReceipt(c.output)?.idempotency_unverified === true)
  const recentlySubmitted = clientsWithRecentSubmission(candidates, now)

  for (const c of candidates) {
    if (!isFreshFacebookPost(c, now)) continue
    // 同一客户两次提交之间隔开一段时间:开关刚打开时窗口里可能攒着好几条,不许一小时内连发一串 Reel
    if (recentlySubmitted.has(c.client_id)) continue
    // 只有被点名的「客户:账号」才处理;没点名 = 连草稿也不建
    if (!enabled.has(c.client_id)) continue
    const live = opts.live && !unverifiedPresent && (opts.liveClientIds?.has(c.client_id) ?? false) // 全局开关 + 该客户在真发名单里,缺一不可
    const lookup = await loadTargetOnce(targets, c.client_id, d, stats)
    if (lookup.target === null && lookup.error === undefined) continue // 没配 Instagram:静默跳过
    // 绑定账号必须与启用名单完全一致:连接器绑定客户自己能改,不能当依据
    if (lookup.target !== null && enabled.get(c.client_id) !== lookup.target.publer_account_id) {
      stats.configErrors += 1
      console.error('[instagram-crosspost] 绑定账号与启用名单不符 client=' + c.client_id)
      continue
    }

    const receipt0 = readReceipt(c.output)
    const decision = decideSweep({
      receipt: receipt0,
      fbVideoState: readFbVideoState(c.published_ref),
      live,
      now,
    })
    if (decision.action === 'skip') continue

    // 配置读不出(缺品牌名/查库抖动):留下失败回执,重试用尽后进今日待办,不静默丢掉
    if (lookup.target === null) {
      return finish(await failConfigRead(c, receipt0, lookup.error ?? '', live, d))
    }
    return finish(await processOne(c, lookup.target, receipt0, decision.action, live, d))
  }

  await emitMissingEvents(candidates, d)
  return finish({ order_id: '', result: 'no_candidate' })
}

/** 最近 MIN_GAP_PER_CLIENT_MS 内已经提交过 Instagram 的客户(草稿或排期都算)。 */
function clientsWithRecentSubmission(candidates: CrosspostCandidate[], now: Date): Set<string> {
  const out = new Set<string>()
  for (const c of candidates) {
    const r = readReceipt(c.output)
    if (r === null || (r.status !== 'draft' && r.status !== 'scheduled')) continue
    const at = Date.parse(r.updated_at)
    if (Number.isFinite(at) && now.getTime() - at < MIN_GAP_PER_CLIENT_MS) out.add(c.client_id)
  }
  return out
}

/** Facebook 回执的发布时间在 48 小时内才算「刚发出的」;读不出时间 = 来路不明,不跟发。 */
function isFreshFacebookPost(c: CrosspostCandidate, now: Date): boolean {
  const at = typeof c.published_ref.published_at === 'string' ? Date.parse(c.published_ref.published_at) : NaN
  // 未来时间(脏数据/时钟错)同样当来路不明,允许 5 分钟的时钟误差
  return Number.isFinite(at) && now.getTime() - at <= MAX_FB_AGE_MS && at - now.getTime() <= 5 * 60 * 1000
}

interface TargetLookup {
  target: PublishTarget | null
  /** 读配置失败时的原因(target 此时为 null) */
  error?: string
}

/** 读客户的 Instagram 目标并缓存。一个客户读失败只影响他自己,不拖垮整轮扫描。 */
async function loadTargetOnce(
  cache: Map<string, TargetLookup>,
  clientId: string,
  d: CrosspostDeps,
  stats: { configErrors: number },
): Promise<TargetLookup> {
  const hit = cache.get(clientId)
  if (hit !== undefined) return hit
  let lookup: TargetLookup
  try {
    lookup = { target: await d.store.loadInstagramTarget(clientId) }
  } catch (e: unknown) {
    stats.configErrors += 1
    console.error(`[instagram-crosspost] 读客户 Instagram 配置失败 client=${clientId}`, e)
    lookup = { target: null, error: e instanceof Error ? e.message : '读客户 Instagram 配置失败' }
  }
  cache.set(clientId, lookup)
  return lookup
}

/** 配置读取失败:认领后写一条非终态失败回执(失败次数用尽后由今日待办接手)。 */
async function failConfigRead(
  c: CrosspostCandidate,
  receipt0: InstagramPublishReceipt | null,
  error: string,
  live: boolean,
  d: CrosspostDeps,
): Promise<InstagramCrosspostOutcome> {
  const claimed = await claimOrder(c, '', receipt0, live, d)
  if ('outcome' in claimed) return claimed.outcome
  return await failWith(claimed.current, 'other', `客户 Instagram 配置读取失败:${error}`, false, d)
}

/**
 * 处理单个工单。顺序：claim -> 审批门 -> 文案/红线 -> 对账 -> 视频 -> 发布
 * -> 记录 -> 发事件。任何一步失败都留下回执。
 */
async function processOne(
  candidate: CrosspostCandidate,
  target: PublishTarget,
  receipt0: InstagramPublishReceipt | null,
  action: 'run' | 'reconcile',
  live: boolean,
  d: CrosspostDeps,
): Promise<InstagramCrosspostOutcome> {
  const claimed = await claimOrder(candidate, target.publer_account_id ?? '', receipt0, live, d)
  if ('outcome' in claimed) return claimed.outcome
  const current = claimed.current

  const content = await prepareContent(current, d)
  if ('outcome' in content) return content.outcome

  // 4. 对账：先问 Publer 是否已经存在，绝不盲目重建。
  const reconcile = await reconcileExisting(current, target, candidate.id, action, d)
  if (reconcile !== null) return reconcile

  // 5. 视频 URL 校验。
  const videoPath = readVideoPath(candidate.output)
  if (videoPath === null) {
    return await failWith(current, 'other', '工单无 output.video_path', true, d)
  }
  const videoUrl = `${d.publicBase()}/${videoPath}`
  const videoErr = await d.validateVideoUrl(videoUrl)
  if (videoErr !== null) {
    return await failWith(current, 'other', videoErr, false, d)
  }

  // 6. 发布。
  const publishResult = await doPublish(
    current, target, candidate.id, videoUrl, content.caption, content.firstComment, live, d,
  )
  if (publishResult.ref === undefined) return publishResult.outcome
  const ref = publishResult.ref

  // 7. 记录成功 + 8. 发事件（失败只记日志，绝不改状态）。
  const providerState = await recordSubmitted(current, ref, live, d)
  await emitFor(current, ref, d)
  return {
    order_id: candidate.id,
    result: providerState === 'scheduled' ? 'scheduled' : 'drafted',
    detail: current.receipt.post_id ?? ref.post_id,
  }
}

/** 1. 认领：先写回执，后续任何失败都能留下机器可读状态。 */
async function claimOrder(
  candidate: CrosspostCandidate,
  publerAccountId: string,
  receipt0: InstagramPublishReceipt | null,
  live: boolean,
  d: CrosspostDeps,
): Promise<{ current: Current } | { outcome: InstagramCrosspostOutcome }> {
  const r1 = newClaim({
    workOrderId: candidate.id,
    clientId: candidate.client_id,
    publerAccountId,
    requestId: d.newRequestId(),
    live,
    firstCommentRequested: true,
    now: d.now(),
    prev: receipt0,
  })
  const claimedOutput = withReceipt(candidate.output, r1)
  const claimWrite = await d.store.writeOutput(candidate.id, candidate.updated_at, claimedOutput)
  if (!claimWrite.ok) return { outcome: { order_id: candidate.id, result: 'lost_race' } }
  return { current: { candidate, receipt: r1, updatedAt: claimWrite.updatedAt, output: claimedOutput } }
}

/** 2-3. 审批门 + 文案 + 首评 + 红线。通过返回文案，否则返回已写好回执的 outcome。 */
async function prepareContent(
  current: Current,
  d: CrosspostDeps,
): Promise<{ caption: string; firstComment: string } | { outcome: InstagramCrosspostOutcome }> {
  const candidate = current.candidate
  const gate = checkApproval(candidate)
  if (gate !== null) return { outcome: await failWith(current, 'other', gate, true, d) }

  const copy = readCopy(candidate.brief)
  const firstComment = buildReelFirstComment(readEndcard(copy), candidate.id, 'instagram')
  if (firstComment === null) {
    return { outcome: await failWith(current, 'other', '首评 CTA 或 HTTPS 追踪链接无效', true, d) }
  }
  const caption = buildReelPostCaption(copy)
  const redline = await runRedline(candidate, caption, firstComment.text, d)
  if (redline !== null) return { outcome: await failWith(current, 'other', redline, true, d) }
  return { caption, firstComment: firstComment.text }
}

/** 7. 写成功回执（写冲突只记日志，帖子已存在，后续扫描会对账，绝不回滚）。返回 provider 状态。 */
async function recordSubmitted(
  current: Current,
  ref: PublishedRef,
  live: boolean,
  d: CrosspostDeps,
): Promise<'draft' | 'scheduled'> {
  const r = markSubmitted(
    current.receipt,
    {
      postId: ref.post_id,
      providerState: ref.provider_state ?? (live ? 'scheduled' : 'draft'),
      scheduledAt: ref.scheduled_at,
      permalink: ref.permalink,
      idempotencyUnverified: ref.idempotency_unverified,
    },
    d.now(),
  )
  const w = await d.store.writeOutput(current.candidate.id, current.updatedAt, withReceipt(current.output, r))
  if (!w.ok) {
    console.error(`[instagram-crosspost] 成功回执写入冲突 order=${current.candidate.id} post=${r.post_id}`)
  } else {
    current.receipt = r
    current.updatedAt = w.updatedAt
    current.output = withReceipt(current.output, r)
  }
  return r.provider_state ?? (live ? 'scheduled' : 'draft')
}

/** 审批门：human + auto 清单都必须存在、完整、通过。返回 null 表示通过。 */
function checkApproval(candidate: CrosspostCandidate): string | null {
  const human = validateContentChecklist(
    candidate.review_ref.checklist_human,
    humanKeysForStored(candidate.review_ref.checklist_human),
    'HUMAN',
  )
  const auto = validateContentChecklist(
    candidate.output.quality_checklist_auto,
    REEL_AUTO_CHECK_KEYS,
    'AUTO',
  )
  if (!human.ok || !auto.ok) return APPROVAL_FAIL
  if (!checklistPasses(human.items) || !checklistPasses(auto.items)) {
    return APPROVAL_FAIL
  }
  return null
}

/** 红线扫描：返回 null 表示通过，否则返回阻断原因。 */
async function runRedline(
  candidate: CrosspostCandidate,
  caption: string,
  firstCommentText: string,
  d: CrosspostDeps,
): Promise<string | null> {
  try {
    return await d.scanCaption(
      candidate.client_id,
      candidate.master_brief_id,
      `${caption}\n${firstCommentText}`,
    )
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 红线查询失败', e)
    return '红线查询失败,保守不发'
  }
}

/**
 * 对账：先问 Publer 是否已有这条帖子。
 * 返回非 null 表示已经处理完（recovered 或 failed），调用方直接返回。
 */
async function reconcileExisting(
  current: Current,
  target: PublishTarget,
  tag: string,
  action: 'run' | 'reconcile',
  d: CrosspostDeps,
): Promise<InstagramCrosspostOutcome | null> {
  let existing: PublishedRef | null
  try {
    existing = await d.adapter.findExisting({ target, idempotencyTag: tag })
  } catch (e: unknown) {
    const kind: InstagramFailureKind = isPublerAccountError(e)
      ? 'account'
      : 'other'
    const msg = e instanceof Error ? e.message : 'findExisting 失败'
    // 本地锚已写(media_id 存在)= 建帖请求可能已发出,后续只许对账。
    return await failWith(current, kind, msg, false, d, current.receipt.media_id !== undefined)
  }

  if (existing !== null) {
    const r = markSubmitted(
      current.receipt,
      {
        postId: existing.post_id,
        providerState: existing.provider_state ?? 'draft',
        scheduledAt: existing.scheduled_at,
        permalink: existing.permalink,
      },
      d.now(),
    )
    const w = await d.store.writeOutput(
      current.candidate.id,
      current.updatedAt,
      withReceipt(current.output, r),
    )
    if (w.ok) {
      current.receipt = r
      current.updatedAt = w.updatedAt
      current.output = withReceipt(current.output, r)
    } else {
      console.error(
        `[instagram-crosspost] 对账回执写入冲突 order=${current.candidate.id}`,
      )
    }
    await emitFor(current, existing, d)
    return {
      order_id: current.candidate.id,
      result: 'recovered',
      detail: r.post_id,
    }
  }

  if (action === 'reconcile') {
    return await failWith(
      current,
      'other',
      '上次发布中途中断,Publishing Hub 侧未确认是否已发出,请人工核对 Instagram',
      true,
      d,
    )
  }
  return null
}

/** 发布结果：要么是 ref，要么是已经处理完的 outcome。 */
type PublishResult =
  | { ref: PublishedRef; outcome?: undefined }
  | { ref?: undefined; outcome: InstagramCrosspostOutcome }

/** 调用 adapter.publish，处理 onStarted 回执写入与异常分类。 */
async function doPublish(
  current: Current,
  target: PublishTarget,
  tag: string,
  videoUrl: string,
  caption: string,
  firstCommentText: string,
  live: boolean,
  d: CrosspostDeps,
): Promise<PublishResult> {
  const onStarted = async (mediaId: string): Promise<void> => {
    const r = markCreating(current.receipt, mediaId, d.now())
    const w = await d.store.writeOutput(
      current.candidate.id,
      current.updatedAt,
      withReceipt(current.output, r),
    )
    if (!w.ok) {
      // 帖子还没创建，本地锚点写不进去 => 保守不继续。
      throw new Error('回执写入冲突,保守不继续')
    }
    current.receipt = r
    current.updatedAt = w.updatedAt
    current.output = withReceipt(current.output, r)
  }

  try {
    const ref = await d.adapter.publish({
      videoUrl,
      caption,
      firstComment: firstCommentText,
      target,
      idempotencyTag: tag,
      draft: !live,
      onStarted,
    })
    return { ref }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '发布失败'
    if (isPublerAccountError(e)) {
      // 账号类失败也可能发生在建帖之后:本地锚已写就标记 post_may_exist。
      return { ref: undefined, outcome: await failWith(current, 'account', msg, false, d, current.receipt.status === 'creating') }
    }
    // 不知道帖子建没建出来(超时/网络断/5xx,且本地锚已写)→ 不写 failed。
    // 写了 failed,10 分钟后会被当成「新片」重新上传重新建帖 = Instagram 上两条一样的片。
    // 保持 creating:15 分钟后走对账,对得上就记回执,对不上转人工核对。
    if (current.receipt.status === 'creating' && !isPublerRejectedError(e)) {
      return { ref: undefined, outcome: await holdUncertain(current, msg, d) }
    }
    return { ref: undefined, outcome: await failWith(current, 'other', msg, false, d) }
  }
}

/** 结果不确定:回执保持 creating(只补一条错误说明),交给下一轮对账。 */
async function holdUncertain(
  current: Current,
  message: string,
  d: CrosspostDeps,
): Promise<InstagramCrosspostOutcome> {
  const held: InstagramPublishReceipt = {
    ...current.receipt,
    error: sanitizeFailReason(message),
    // 建帖请求已发出、结果不确定:粘住 post_may_exist,后续只许对账。
    post_may_exist: true,
    updated_at: d.now().toISOString(),
  }
  const w = await d.store.writeOutput(current.candidate.id, current.updatedAt, withReceipt(current.output, held))
  if (w.ok) {
    current.receipt = held
    current.updatedAt = w.updatedAt
    current.output = withReceipt(current.output, held)
  } else {
    console.error(`[instagram-crosspost] 不确定状态回执写入冲突 order=${current.candidate.id}`)
  }
  return { order_id: current.candidate.id, result: 'failed', detail: 'uncertain' }
}

/**
 * 失败助手：写失败回执。terminal 为 true 时把 next_retry_at 置 null
 * （需要人工），但不动 attempts。
 */
async function failWith(
  current: Current,
  kind: InstagramFailureKind,
  message: string,
  terminal: boolean,
  d: CrosspostDeps,
  mayHavePosted = false,
): Promise<InstagramCrosspostOutcome> {
  const failed = markFailed(
    current.receipt,
    { error: sanitizeFailReason(message), kind, mayHavePosted },
    d.now(),
  )
  const r: InstagramPublishReceipt = terminal
    ? { ...failed, next_retry_at: null }
    : failed
  const w = await d.store.writeOutput(
    current.candidate.id,
    current.updatedAt,
    withReceipt(current.output, r),
  )
  if (!w.ok) {
    console.error(
      `[instagram-crosspost] 失败回执写入冲突 order=${current.candidate.id}`,
    )
  } else {
    current.receipt = r
    current.updatedAt = w.updatedAt
    current.output = withReceipt(current.output, r)
  }
  return {
    order_id: current.candidate.id,
    result: 'failed',
    detail: kind === 'account' ? 'account' : 'other',
  }
}
