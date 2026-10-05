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
  REEL_HUMAN_CHECK_KEYS,
  validateContentChecklist,
  checklistPasses,
} from '@/lib/social/content-review'
import {
  buildReelFirstComment,
  buildReelPostCaption,
} from '@/lib/social/reel-publishing'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { buildInstagramReelSubmittedEvent } from './instagram-publish-event'
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

/** 每次运行最多扫描的候选数。 */
const CANDIDATE_LIMIT = 50

/** emitMissingEvents 最多补发的候选数。 */
const MISSING_EVENTS_LIMIT = 5

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
interface Current {
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

/** 计算发布标签：brief.angle || candidate.angle || expect_brand || 'Reel'。 */
function computeLabel(
  candidate: CrosspostCandidate,
  target: PublishTarget,
): string {
  const briefAngle = candidate.brief.angle
  if (typeof briefAngle === 'string' && briefAngle.length > 0) return briefAngle
  if (candidate.angle !== null && candidate.angle.length > 0) {
    return candidate.angle
  }
  if (target.expect_brand !== undefined && target.expect_brand.length > 0) {
    return target.expect_brand
  }
  return 'Reel'
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
      writeThreeBooks(id, ref, clientId, angle, { actionType: INSTAGRAM_BOOKS_ACTION_TYPE, channelLabel: 'Instagram(Publer)' })),
    now: deps?.now ?? (() => new Date()),
    newRequestId: deps?.newRequestId ?? (() => crypto.randomUUID()),
  }
}

/**
 * 扫描入口：每次运行最多处理一个工单。
 * 没有可处理候选时，顺带补发漏掉的 Inngest 事件（幂等）。
 */
export async function runInstagramCrosspost(
  opts: { live: boolean },
  deps?: Partial<CrosspostDeps>,
): Promise<InstagramCrosspostOutcome> {
  const d = resolveDeps(deps)
  const candidates = await d.store.listCandidates(CANDIDATE_LIMIT)
  const now = d.now()
  const targets = new Map<string, PublishTarget | null>() // 同一客户一轮只查一次
  const stats = { configErrors: 0 }
  const finish = (o: InstagramCrosspostOutcome): InstagramCrosspostOutcome =>
    stats.configErrors > 0 ? { ...o, config_errors: stats.configErrors } : o

  const recentlySubmitted = clientsWithRecentSubmission(candidates, now)

  for (const c of candidates) {
    if (!isFreshFacebookPost(c, now)) continue
    // 同一客户两次提交之间隔开一段时间:开关刚打开时窗口里可能攒着好几条,不许一小时内连发一串 Reel
    if (recentlySubmitted.has(c.client_id)) continue
    const target = await loadTargetOnce(targets, c.client_id, d, stats)
    if (target === null) continue // 没配 Instagram(或这个客户的配置读不出来):静默跳过

    const receipt0 = readReceipt(c.output)
    const decision = decideSweep({
      receipt: receipt0,
      fbVideoState: readFbVideoState(c.published_ref),
      live: opts.live,
      now,
    })
    if (decision.action === 'skip') continue

    return finish(await processOne(c, target, receipt0, decision.action, opts.live, d))
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

/** 读客户的 Instagram 目标并缓存。一个客户读失败只影响他自己,不拖垮整轮扫描。 */
async function loadTargetOnce(
  cache: Map<string, PublishTarget | null>,
  clientId: string,
  d: CrosspostDeps,
  stats: { configErrors: number },
): Promise<PublishTarget | null> {
  if (cache.has(clientId)) return cache.get(clientId) ?? null
  let target: PublishTarget | null = null
  try {
    target = await d.store.loadInstagramTarget(clientId)
  } catch (e: unknown) {
    stats.configErrors += 1
    console.error(`[instagram-crosspost] 读客户 Instagram 配置失败 client=${clientId}`, e)
  }
  cache.set(clientId, target)
  return target
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
  const now = d.now()
  const tag = candidate.id
  const label = computeLabel(candidate, target)

  // 1. 认领：先写回执，后续任何失败都能留下机器可读状态。
  const r1 = newClaim({
    workOrderId: candidate.id,
    clientId: candidate.client_id,
    publerAccountId: target.publer_account_id ?? '',
    requestId: d.newRequestId(),
    live,
    firstCommentRequested: true,
    now,
    prev: receipt0,
  })
  const claimedOutput = withReceipt(candidate.output, r1)
  const claimWrite = await d.store.writeOutput(
    candidate.id,
    candidate.updated_at,
    claimedOutput,
  )
  if (!claimWrite.ok) {
    return { order_id: candidate.id, result: 'lost_race' }
  }
  const current: Current = {
    candidate,
    receipt: r1,
    updatedAt: claimWrite.updatedAt,
    output: claimedOutput,
  }

  // 2. 审批门：最后一道边界复查，与 Facebook worker 一致。
  const gate = checkApproval(candidate)
  if (gate !== null) {
    return await failWith(current, 'other', gate, true, d)
  }

  // 3. 文案 + 首评 + 红线。
  const copy = readCopy(candidate.brief)
  const endcard = readEndcard(copy)
  const firstComment = buildReelFirstComment(endcard, candidate.id, 'instagram')
  if (firstComment === null) {
    return await failWith(
      current,
      'other',
      '首评 CTA 或 HTTPS 追踪链接无效',
      true,
      d,
    )
  }
  const caption = buildReelPostCaption(copy)
  const redline = await runRedline(candidate, caption, firstComment.text, d)
  if (redline !== null) {
    return await failWith(current, 'other', redline, true, d)
  }

  // 4. 对账：先问 Publer 是否已经存在，绝不盲目重建。
  const reconcile = await reconcileExisting(current, target, tag, action, d)
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
    current,
    target,
    tag,
    videoUrl,
    caption,
    firstComment.text,
    live,
    d,
  )
  if (publishResult.ref === undefined) return publishResult.outcome
  const ref = publishResult.ref

  // 7. 记录成功。
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
  const successWrite = await d.store.writeOutput(
    candidate.id,
    current.updatedAt,
    withReceipt(current.output, r),
  )
  if (!successWrite.ok) {
    // 帖子已存在；后续扫描会对账。绝不回滚。
    console.error(
      `[instagram-crosspost] 成功回执写入冲突 order=${candidate.id} post=${r.post_id}`,
    )
  } else {
    current.receipt = r
    current.updatedAt = successWrite.updatedAt
    current.output = withReceipt(current.output, r)
  }

  if (r.status === 'scheduled') {
    await d
      .recordBooks(candidate.id, ref, candidate.client_id, label)
      .catch((e: unknown) => {
        console.error('[instagram-crosspost] 三本书写入失败', e)
      })
  }

  // 8. 发事件（失败只记日志，绝不改状态）。
  await emitFor(current, ref, d)

  const providerState = r.provider_state ?? (live ? 'scheduled' : 'draft')
  return {
    order_id: candidate.id,
    result: providerState === 'scheduled' ? 'scheduled' : 'drafted',
    detail: r.post_id,
  }
}

/** 审批门：human + auto 清单都必须存在、完整、通过。返回 null 表示通过。 */
function checkApproval(candidate: CrosspostCandidate): string | null {
  const human = validateContentChecklist(
    candidate.review_ref.checklist_human,
    REEL_HUMAN_CHECK_KEYS,
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
    return await failWith(current, kind, msg, false, d)
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
    // 「发出去了但本地没记上」的那条也要补三本账(否则这条永远缺账);草稿不算
    if (r.status === 'scheduled') {
      await d
        .recordBooks(current.candidate.id, existing, current.candidate.client_id, computeLabel(current.candidate, target))
        .catch((e: unknown) => console.error('[instagram-crosspost] 三本书写入失败(对账补记)', e))
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
      '上次发布中途中断,Publer 侧未确认是否已发出,请人工核对 Instagram',
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
      return { ref: undefined, outcome: await failWith(current, 'account', msg, false, d) }
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
): Promise<InstagramCrosspostOutcome> {
  const failed = markFailed(
    current.receipt,
    { error: sanitizeFailReason(message), kind },
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

/**
 * 发 Inngest 事件并把 event_ids 写回回执。任何失败只记日志，绝不改状态
 * （帖子已存在，回滚会导致重复发布）。
 */
async function emitFor(
  current: Current,
  ref: PublishedRef,
  d: CrosspostDeps,
): Promise<void> {
  const r = current.receipt
  const mediaId = r.media_id ?? ref.video_id
  // 草稿还是排期以「刚拿到的回执 ref」为准:成功回执写库冲突时 current.receipt 可能还停在 creating,
  // 那时拿它兜底成 draft 会把真排期的帖子报成「草稿/未发布」,而事件 id 固定,之后再补发也会被去重 —— 下游永远以为没公开。
  const providerState = ref.provider_state ?? r.provider_state
  if (mediaId === undefined || providerState === undefined) {
    console.error(
      `[instagram-crosspost] 缺 media_id 或发布状态,跳过事件 order=${current.candidate.id}`,
    )
    return
  }
  let ev: { id: string; name: string; data: Record<string, unknown> }
  try {
    ev = buildInstagramReelSubmittedEvent({
      workOrderId: current.candidate.id,
      clientId: current.candidate.client_id,
      publerAccountId: r.publer_account_id,
      mediaId,
      postId: ref.post_id ?? r.post_id,
      providerState,
      scheduledAt: ref.scheduled_at ?? r.scheduled_at,
      firstCommentRequested: r.first_comment_requested,
      requestId: r.request_id,
      createdAt: d.now().toISOString(),
    })
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 事件构造失败', e)
    return
  }

  let sent: { event_ids: string[] }
  try {
    sent = await d.emit(ev)
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 事件发送失败', e)
    return
  }

  const withEvents: InstagramPublishReceipt = {
    ...r,
    event_ids: sent.event_ids,
    updated_at: d.now().toISOString(),
  }
  const w = await d.store.writeOutput(
    current.candidate.id,
    current.updatedAt,
    withReceipt(current.output, withEvents),
  )
  if (!w.ok) {
    console.error(
      `[instagram-crosspost] event_ids 写入冲突 order=${current.candidate.id}`,
    )
    return
  }
  current.receipt = withEvents
  current.updatedAt = w.updatedAt
  current.output = withReceipt(current.output, withEvents)
}

/**
 * 补发漏掉的事件：只处理 draft/scheduled 且缺 event_ids 的候选，最多 5 个。
 * 事件 id 是确定性的，重发无害。
 */
async function emitMissingEvents(
  candidates: CrosspostCandidate[],
  d: CrosspostDeps,
): Promise<void> {
  let count = 0
  for (const c of candidates) {
    if (count >= MISSING_EVENTS_LIMIT) return
    const receipt = readReceipt(c.output)
    if (receipt === null) continue
    if (receipt.status !== 'draft' && receipt.status !== 'scheduled') continue
    if (receipt.post_id === undefined) continue
    if (receipt.media_id === undefined) continue
    if (receipt.event_ids !== undefined && receipt.event_ids.length > 0) continue
    count += 1
    await emitMissingOne(c, receipt, d)
  }
}

/** 补发单个候选的事件。 */
async function emitMissingOne(
  c: CrosspostCandidate,
  receipt: InstagramPublishReceipt,
  d: CrosspostDeps,
): Promise<void> {
  const mediaId = receipt.media_id
  if (mediaId === undefined) return
  const providerState = receipt.provider_state ?? (receipt.status === 'scheduled' ? 'scheduled' : 'draft')
  let ev: { id: string; name: string; data: Record<string, unknown> }
  try {
    ev = buildInstagramReelSubmittedEvent({
      workOrderId: c.id,
      clientId: c.client_id,
      publerAccountId: receipt.publer_account_id,
      mediaId,
      postId: receipt.post_id,
      providerState,
      scheduledAt: receipt.scheduled_at,
      firstCommentRequested: receipt.first_comment_requested,
      requestId: receipt.request_id,
      createdAt: d.now().toISOString(),
    })
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 补发事件构造失败', e)
    return
  }
  let sent: { event_ids: string[] }
  try {
    sent = await d.emit(ev)
  } catch (e: unknown) {
    console.error('[instagram-crosspost] 补发事件发送失败', e)
    return
  }
  const withEvents: InstagramPublishReceipt = {
    ...receipt,
    event_ids: sent.event_ids,
    updated_at: d.now().toISOString(),
  }
  const w = await d.store.writeOutput(
    c.id,
    c.updated_at,
    withReceipt(c.output, withEvents),
  )
  if (!w.ok) {
    console.error(`[instagram-crosspost] 补发 event_ids 写入冲突 order=${c.id}`)
  }
}
