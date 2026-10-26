/**
 * Daily Plan publish — the shared, provider-facing publish flow.
 *
 * Extracted from the publish route (behaviour unchanged) so a second caller —
 * the auto-publish worker — runs the *same* gates in the *same* order instead
 * of re-implementing them: reviewed-plan checks, queue-receipt proof, the two
 * price gates (both before any token lookup or Graph call), page binding,
 * idempotency, publish, first comment, measurement hand-off, receipt write.
 *
 * The caller owns authentication (it MUST authenticate before calling) and passes
 * the authorising user id; this module never reads a session. Refusals are returned as `{ status, body }`;
 * unexpected failures throw and the caller maps them to a 500.
 */
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import {
  CAMPAIGN_DAILY_PLAN_KIND,
  CampaignDailyPostReviewMetaSchema,
  CampaignDailyPublishQueueMetaSchema,
  isReviewablePostDate,
  type CampaignDailyPlanData,
} from '@/lib/campaign/daily-plan'
import { postChecklistPasses } from '@/lib/social/content-review'
import { judgePriceClaimWithSource, priceGateMessage } from '@/lib/content/price-claim-gate'
import { judgePostPriceFacts, loadOfferPriceFacts } from '@/lib/content/price-fact-gate'
import {
  buildDailyPlanAutoChecks,
  buildDailyPlanFirstComment,
  buildDailyPlanPostMessage,
} from '@/lib/campaign/daily-plan-first-comment'
import {
  CampaignDailyPublishCommandSchema,
  CampaignDailyPublishMetaSchema,
  DAILY_PLAN_POST_PUBLISHED_EVENT,
  partitionByIdempotency,
  publishIdempotencyKey,
  resolvePublishStatus,
  type CampaignDailyPublishCommand,
  type CampaignDailyPublishMeta,
} from '@/lib/campaign/daily-plan-publish'
import {
  errorMessage,
  persistReceipt,
  publishPending,
  type PlanRow,
  type PublishCandidate,
} from '@/lib/campaign/daily-plan-publish-effects'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A refusal the caller should return as-is: HTTP status plus JSON body. */
export interface PublishRefusal {
  refusal: true
  status: number
  body: Record<string, unknown>
}

export function isRefusal(value: unknown): value is PublishRefusal {
  return typeof value === 'object' && value !== null && (value as { refusal?: unknown }).refusal === true
}

function conflict(error: string, extra: Record<string, unknown> = {}): PublishRefusal {
  return { refusal: true, status: 409, body: { success: false, error, ...extra } }
}

function hasUniqueDates(values: Array<{ date?: string }>): boolean {
  const dates = values.map(value => value?.date)
  return dates.every(date => typeof date === 'string') && new Set(dates).size === dates.length
}

/**
 * Load the newest plan snapshot and re-verify every precondition the reviewer
 * saw. Returns a refusal so the caller stays linear.
 */
async function loadReviewedPlan(
  clientId: string,
  command: CampaignDailyPublishCommand,
): Promise<PlanRow | PublishRefusal> {
  const { data: rows, error } = await supabaseAdmin
    .from('social_plans')
    .select('id, plan_data, created_at')
    .eq('client_id', clientId)
    .eq('campaign_id', command.campaign_id)
    .contains('plan_data', { plan_kind: CAMPAIGN_DAILY_PLAN_KIND })
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  const row = rows?.[0] ?? null
  if (!row) return { refusal: true, status: 404, body: { success: false, error: 'PLAN_NOT_FOUND' } }
  if (row.id !== command.plan_id) return conflict('PLAN_SUPERSEDED')

  const planData = row.plan_data as unknown as CampaignDailyPlanData
  if (
    !planData ||
    planData.plan_kind !== CAMPAIGN_DAILY_PLAN_KIND ||
    planData.campaign_id !== command.campaign_id ||
    !Array.isArray(planData.days) ||
    !Array.isArray(planData.bundles) ||
    !hasUniqueDates(planData.days) ||
    !hasUniqueDates(planData.bundles)
  ) {
    return conflict('PLAN_STATE_INVALID')
  }

  const planRevision = planData.command_meta?.received_at
  if (!planRevision || planRevision !== command.plan_revision) return conflict('PLAN_REVISION_MISMATCH')

  const review = CampaignDailyPostReviewMetaSchema.safeParse(planData.review_meta)
  if (
    !review.success ||
    review.data.plan_revision !== planRevision ||
    Object.keys(review.data.posts).some(date => !isReviewablePostDate(planData, date))
  ) {
    return conflict('REVIEW_STATE_INVALID')
  }
  const checklistReady = planData.bundles
    .filter(bundle => !!bundle.post)
    .every(bundle => {
      const decision = review.data.posts[bundle.date]
      return decision?.verdict === 'PASS' && decision.reviewer_role === 'admin' && postChecklistPasses(decision.checklist)
    })
  if (!checklistReady) return conflict('REVIEW_CHECKLIST_REQUIRED')
  if (review.data.revision !== command.review_revision) return conflict('REVIEW_REVISION_MISMATCH')

  // The no-publish queue receipt is the proof that these exact Posts passed
  // review and readiness. Publishing without it would bypass that gate.
  const queue = CampaignDailyPublishQueueMetaSchema.safeParse(planData.publish_queue_meta)
  if (!queue.success) return conflict('PUBLISH_QUEUE_RECEIPT_REQUIRED')
  if (queue.data.plan_revision !== planRevision || queue.data.review_revision !== review.data.revision) {
    return conflict('PUBLISH_QUEUE_RECEIPT_STALE')
  }

  return { id: row.id, planData, planRevision, reviewRevision: review.data.revision }
}


/**
 * Build the publish list from the queue receipt, re-resolving copy from the
 * plan bundle and the image URL from the authoritative `client_assets` row.
 * Caller-supplied content is never trusted here.
 */
async function buildCandidates(
  clientId: string,
  row: PlanRow,
  command: CampaignDailyPublishCommand,
): Promise<PublishCandidate[] | PublishRefusal> {
  const queue = reviewedPostsFromQueueReceipt(row)
  const wanted = command.dates ? new Set(command.dates) : null
  const selected = queue.filter(post => !wanted || wanted.has(post.date))
  if (wanted && selected.length !== wanted.size) return conflict('DATE_NOT_IN_REVIEWED_SET')
  if (selected.length === 0) return { refusal: true, status: 422, body: { success: false, error: 'NO_POSTS_TO_PUBLISH' } }

  const assetIds = Array.from(new Set(selected.map(post => post.image_asset_id)))
  const { data: assets, error } = await supabaseAdmin
    .from('client_assets')
    .select('id, storage_url, mime_type, status, archived_at, source')
    .eq('client_id', clientId)
    .in('id', assetIds)
  if (error) throw error
  const assetById = new Map((assets ?? []).map(asset => [asset.id, asset]))

  const bundleByDate = new Map(row.planData.bundles.map(bundle => [bundle.date, bundle]))
  const candidates: PublishCandidate[] = []
  const notReady: string[] = []
  const firstCommentFailures: Array<{ date: string; failed_checks: string[] }> = []

  for (const entry of selected) {
    const post = bundleByDate.get(entry.date)?.post
    const asset = assetById.get(entry.image_asset_id)
    const usable =
      post &&
      asset &&
      asset.archived_at == null &&
      asset.status === 'analyzed' &&
      typeof asset.storage_url === 'string' &&
      asset.storage_url.trim().length > 0 &&
      typeof asset.mime_type === 'string' &&
      asset.mime_type.startsWith('image/')
    if (!usable) {
      notReady.push(entry.date)
      continue
    }

    // The CTA and its link belong in the first comment, never in the Post body.
    // Re-run the same auto-checks the reviewer saw; a Post that fails them (or
    // whose first comment cannot be built) must not reach a Page.
    const checks = buildDailyPlanAutoChecks({
      post: { hook: post.hook, body: post.body, cta: post.cta, cta_url: post.cta_url },
      planId: row.id,
      date: entry.date,
    })
    const firstComment = buildDailyPlanFirstComment({
      cta: post.cta,
      ctaUrl: post.cta_url,
      planId: row.id,
      date: entry.date,
    })
    const failedChecks = checks.filter(check => check.outcome !== 'PASS').map(check => check.key)
    if (firstComment === null || failedChecks.length > 0) {
      firstCommentFailures.push({ date: entry.date, failed_checks: failedChecks })
      continue
    }

    const message = buildDailyPlanPostMessage(post)
    candidates.push({
      date: entry.date,
      idempotency_key: publishIdempotencyKey({
        clientId,
        planId: row.id,
        planRevision: row.planRevision,
        reviewRevision: row.reviewRevision,
        date: entry.date,
      }),
      image_asset_id: entry.image_asset_id,
      cta_url: entry.cta_url,
      message,
      firstCommentText: firstComment.text,
      judgedText: [message, firstComment.text].join('\n\n'),
      imageUrl: asset.storage_url as string,
      imageSource: (asset.source as string | null) ?? null,
    })
  }

  if (firstCommentFailures.length > 0) {
    return conflict('FIRST_COMMENT_CHECK_FAILED', {
      blocked: firstCommentFailures,
      hint: '整批已暂停（不是只拦列出的日期）：这些日期的帖子正文里含有 CTA 或链接，或首评无法生成；把链接和 CTA 从正文去掉后重新审核。',
    })
  }
  if (notReady.length > 0) {
    return { refusal: true, status: 422, body: { success: false, error: 'POSTS_NOT_READY_FOR_PUBLISH', not_ready: notReady } }
  }
  return candidates
}

/** The reviewed Post list, taken from the queue receipt (already validated). */
function reviewedPostsFromQueueReceipt(row: PlanRow) {
  const queue = CampaignDailyPublishQueueMetaSchema.parse(row.planData.publish_queue_meta)
  return queue.posts
}

/**
 * Resolve the Page token and confirm the caller's `page_id` is the Page this
 * client is actually registered against — a mistyped or borrowed Page id must
 * never publish a client's content to someone else's Page.
 */
async function resolvePageToken(
  clientId: string,
  pageId: string,
): Promise<{ token: string; tokenSource: 'stored_connection' | 'env_user_token' } | PublishRefusal> {
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) throw error
  const registered = (client as { facebook_page_id?: string | null } | null)?.facebook_page_id
  if (!registered) return conflict('CLIENT_HAS_NO_FACEBOOK_PAGE')
  if (registered !== pageId) return conflict('PAGE_ID_MISMATCH', { registered_page_id: registered })

  // Prefer the Page token stored by the "连接 Meta" button, exactly as
  // leads-sync and page-metrics-sync do. The env-var path below derives a Page
  // token from a *user* token someone pasted in by hand; for a client with no
  // Business Manager (CTS) that is a 60-day User Access Token, so it expires on
  // a clock and takes every dependent feature down with it. Reaching for it
  // first — as this route originally did — meant a stored, still-valid
  // connection was ignored in favour of the one guaranteed to rot.
  let token = await getStoredPageToken(clientId, pageId)
  let tokenSource: 'stored_connection' | 'env_user_token' = 'stored_connection'
  let userToken: string | null = null
  if (!token) {
    tokenSource = 'env_user_token'
    userToken = await getMetaTokenForClient(clientId)
    token = userToken ? await getPageAccessToken(userToken, pageId) : null
  }
  if (!token) {
    // 424, not 502. A CDN in front of the app (Cloudflare here) treats an
    // origin 502 as "origin is broken" and replaces our body with its own
    // branded error page — so this refusal reached the browser as
    // "Bad gateway" HTML and the real reason was invisible. 424 Failed
    // Dependency says the same thing (an upstream we depend on did not
    // cooperate) and is passed through untouched.
    return {
      refusal: true,
      status: 424,
      body: {
        success: false,
        error: 'PAGE_TOKEN_UNAVAILABLE',
        detail: userToken
          ? '没有存下来的主页授权，退回到手工配置的 Meta 令牌，但它换不出这个主页的 Page token —— 通常是那个令牌过期了（手工令牌 60 天到期），或它的账号没有这个主页的角色。请在客户设置 →「平台连接」点一次「连接 Meta」重新授权。'
          : '这个客户既没有存下来的主页授权，也没有配置 Meta 令牌。请在客户设置 →「平台连接」点一次「连接 Meta」。',
      },
    }
  }
  return { token, tokenSource }
}

/**
 * 「真实价格只能配真实画面」—— 服务端那道闸，跟 `lib/content/price-claim-gate` 同源。
 *
 * 界面上的闸挡的是手滑；这里挡的是绕过界面的路。这条 bridge 一旦跑起来东西就真
 * 出去了，人不在场，所以每条待发 Post 的文案都要过一遍：文案报了价、配图却背不了
 * 真价，就拦下整批，让审核者在授权前先看到。判定与界面共用同一段代码，不会出现
 * 「界面拦了后端放行」这种最难查的不一致。
 */
function findPriceGateBlocks(
  posts: PublishCandidate[],
): Array<{ date: string; message: string }> {
  const blocks: Array<{ date: string; message: string }> = []
  for (const post of posts) {
    const verdict = judgePriceClaimWithSource({ caption: post.judgedText, source: post.imageSource })
    if (verdict.blocked) blocks.push({ date: post.date, message: priceGateMessage(verdict.source) })
  }
  return blocks
}

/**
 * 价格数字核对 —— 价格闸的第二步：文案里写的每个价格数字，必须跟客户资料里该团的
 * 价格对得上。对不上、核对不了（没资料 / 认不出是哪个团 / 读不懂写法）一律拦下。
 *
 * 取资料失败会直接抛出（走外层 500）：读失败不等于「没有资料要核对」，不许放行。
 * 只检查 pending —— 已经发出去的不重复拦。
 */
async function findPriceFactBlocks(
  clientId: string,
  posts: PublishCandidate[],
): Promise<Array<{ date: string; reason: string; message: string }>> {
  const offers = await loadOfferPriceFacts(supabaseAdmin, clientId)
  const blocks: Array<{ date: string; reason: string; message: string }> = []
  for (const post of posts) {
    const result = judgePostPriceFacts({ text: post.judgedText, ctaUrl: post.cta_url, offers })
    if (result.verdict.status === 'blocked') {
      blocks.push({ date: post.date, reason: result.verdict.reason, message: result.message })
    }
  }
  return blocks
}

export interface RunDailyPlanPublishInput {
  clientId: string
  command: CampaignDailyPublishCommand
  /** The human who authorised this publish; written to the receipt. Caller-supplied, never read from a session here. */
  approvedByUserId: string
  /** The instant schedule decisions are made against (default: now). */
  now?: Date
  /** false = a slot that already passed is a MISSED_WINDOW failure instead of an immediate publish. Default true (manual path). */
  allowImmediate?: boolean
  /** Request timeout for the Facebook call (default none, as the manual route). */
  requestTimeoutMs?: number
  /** Last-moment check before the Facebook call; false = do not send that date. */
  beforeSend?: (date: string) => Promise<boolean>
}

export interface RunDailyPlanPublishResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Run the whole publish flow for one validated command. Throws on unexpected
 * failures (the caller maps them to a 500); refusals come back as a result.
 */
export async function runDailyPlanPublish(input: RunDailyPlanPublishInput): Promise<RunDailyPlanPublishResult> {
  const { clientId, approvedByUserId } = input
  // Defence in depth: the fail-closed authorisation fields (`approved`,
  // `publish_authorization` literal true) and the uuid-shaped authoriser must hold
  // here too, not only in whichever caller parsed the request. Re-parse, never trust a type.
  const reparsed = CampaignDailyPublishCommandSchema.safeParse(input.command)
  if (!reparsed.success) throw new Error('INVALID_PUBLISH_COMMAND')
  if (!UUID_LIKE.test(approvedByUserId)) throw new Error('INVALID_APPROVER')
  const command = reparsed.data
  const refuse = (r: PublishRefusal): RunDailyPlanPublishResult => ({ status: r.status, body: r.body })

  const row = await loadReviewedPlan(clientId, command)
  if (isRefusal(row)) return refuse(row)

  const candidates = await buildCandidates(clientId, row, command)
  if (isRefusal(candidates)) return refuse(candidates)

  const previousParsed = row.planData.publish_meta
    ? CampaignDailyPublishMetaSchema.safeParse(row.planData.publish_meta)
    : null
  if (previousParsed && !previousParsed.success) return refuse(conflict('PUBLISH_STATE_INVALID'))
  const previous = previousParsed?.data ?? null
  const alreadyPublished = previous?.published ?? []

  const { pending, skipped } = partitionByIdempotency(candidates, alreadyPublished)

  // 真价只配真画面 —— 东西出去前的最后一道闸，且必须在任何 token 查询 / provider
  // 调用之前。dry run 也要过：审核者得在授权前就看到哪几条被拦了，而不是授权后
  // 才发现发不出去。
  const priceBlocks = findPriceGateBlocks(pending)
  if (priceBlocks.length > 0) return refuse(conflict('PRICE_CLAIM_UNBACKED', {
    blocked: priceBlocks,
    hint: '整批已暂停（不是只拦列出的日期）：把列出日期的价格去掉或换成客户确认过的图，再重新演练。',
  }))

  // 价格数字核对：图过关了还要看数字——价格对不上客户资料的，整批同样暂停。
  const factBlocks = await findPriceFactBlocks(clientId, pending)
  if (factBlocks.length > 0) return refuse(conflict('PRICE_FACT_UNVERIFIED', {
    blocked: factBlocks,
    hint: '整批已暂停（不是只拦列出的日期）：把列出日期文案里的价格改成客户资料里的数字，或者先去客户设置补全该团的价格资料，再重新演练。',
  }))

  if (command.no_publish) {
    return {
      status: 200,
      body: {
        success: true,
        mode: 'DRY_RUN',
        status: 'DRY_RUN',
        provider_impact: 'NONE',
        page_id: command.page_id,
        would_publish: pending.map(post => ({
          date: post.date,
          idempotency_key: post.idempotency_key,
          image_asset_id: post.image_asset_id,
          cta_url: post.cta_url,
          message_preview: post.message.slice(0, 200),
          first_comment_preview: post.firstCommentText,
        })),
        already_published: skipped.map(post => ({ date: post.date, idempotency_key: post.idempotency_key })),
      },
    }
  }

  const page = await resolvePageToken(clientId, command.page_id)
  if (isRefusal(page)) return refuse(page)

  const outcome = pending.length === 0
    ? { published: [], failed: [], eventIds: [] }
    : await publishPending(pending, {
        clientId,
        pageId: command.page_id,
        pageToken: page.token,
        row,
        command,
        now: input.now,
        allowImmediate: input.allowImmediate,
        requestTimeoutMs: input.requestTimeoutMs,
        beforeSend: input.beforeSend,
      })

  const merged = [...alreadyPublished, ...outcome.published]
  const receipt: CampaignDailyPublishMeta = {
    schema_version: 1,
    event_name: DAILY_PLAN_POST_PUBLISHED_EVENT,
    status: resolvePublishStatus(merged.length, outcome.failed.length),
    request_id: randomUUID(),
    client_id: clientId,
    campaign_id: command.campaign_id,
    plan_id: row.id,
    plan_revision: row.planRevision,
    review_revision: row.reviewRevision,
    page_id: command.page_id,
    publishing_authorization: 'AUTHORIZED',
    approved_by_user_id: approvedByUserId,
    created_at: new Date().toISOString(),
    published: merged,
    failed: outcome.failed,
    event_ids: [...(previous?.event_ids ?? []), ...outcome.eventIds],
    // Persist only when non-default. Absent means "labels match delivery" —
    // future audits shouldn't see date_offset_days:0 on every legacy receipt.
    ...(command.date_offset_days !== 0 ? { date_offset_days: command.date_offset_days } : {}),
    // Preserve prior recalls so a re-publish doesn't lose the audit trail
    // (the recall entries live on the receipt, not on separate rows).
    ...(previous?.recalled ? { recalled: previous.recalled } : {}),
  }

  // Posts are already live at this point. If the receipt cannot be stored we
  // must still hand back the real ids rather than lose them silently.
  let persisted = false
  let persistError: string | null = null
  try {
    persisted = await persistReceipt(clientId, row, command, previous, receipt)
  } catch (error: unknown) {
    persistError = errorMessage(error)
  }
  if (!persisted) {
    console.error('[daily-plan publish] receipt not persisted', { clientId, planId: row.id, persistError })
    return {
      status: 500,
      body: {
        success: false,
        error: 'PUBLISH_RECEIPT_NOT_PERSISTED',
        persist_error: persistError,
        receipt,
      },
    }
  }

  return {
    status: 200,
    body: {
      success: outcome.failed.length === 0,
      mode: 'LIVE',
      status: receipt.status,
      receipt,
      skipped_as_duplicate: skipped.map(post => ({ date: post.date, idempotency_key: post.idempotency_key })),
      // Posts that are on Facebook but will not be measured — surfaced here so
      // the caller sees it without digging through the receipt or server logs.
      measurement_skipped: outcome.published
        .filter(post => post.measurement_skipped_reason)
        .map(post => ({ date: post.date, post_id: post.post_id, reason: post.measurement_skipped_reason })),
    },
  }
}
