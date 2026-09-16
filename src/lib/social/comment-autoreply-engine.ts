/**
 * Comment auto-reply engine — per-client orchestration.
 *
 * For one client: resolve Page token, pull recent posts + comments, then for
 * each comment: CLAIM it atomically (insert a 'processing' row keyed on the
 * UNIQUE comment_id — a conflict means another run/pass already owns it, so we
 * skip), classify, take the guardrailed action, and UPDATE the claimed row with
 * the result. Claim-before-send is the idempotency lock: a comment can never be
 * replied to twice even if two cron runs overlap or a later step fails.
 *
 * DM-first: for questions/complaints the DM is sent before the public reply, so
 * the public "we've messaged you" wording is only used when the DM actually
 * landed (otherwise a no-DM public variant is used — never a false claim).
 *
 * A send that is attempted but fails is recorded as reply_status='failed' with
 * an error_message and retried on a later run (bounded by MAX_ATTEMPTS) — a
 * failed reply is never silently dropped.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken, listPageObjectIds } from '@/lib/meta/page-posts'
import { listGrantedScopes } from '@/lib/meta-oauth/client'
import { fetchAdStoryIdsResult } from '@/lib/meta/ads-posts'
import { fetchPostCommentsResult, replyToComment, sendPrivateReply, hideComment, PageComment } from '@/lib/meta/comments'
import {
  isPersistableFailure,
  isStillSkipped,
  loadPostSkips,
  mergeSkip,
  savePostSkips,
  type PostSkip,
} from './comment-post-skips'
import { classifyComment, CommentDecision, CommentCategory } from './comment-classifier'
import { ReplyContext } from './comment-guardrails'

export interface CommentConfig {
  client_id: string
  fb_page_id: string
  auto_reply_praise: boolean
  auto_reply_question: boolean
  auto_reply_complaint: boolean
  auto_hide_spam: boolean
  private_reply_enabled: boolean
  lookback_days: number
  max_replies_per_run: number
  pinned_post_ids?: string[] | null
}

export interface ClientRunResult {
  client_id: string
  ok: boolean
  posts_scanned?: number
  new_comments?: number
  public_replies?: number
  private_replies?: number
  hidden?: number
  needs_human?: number
  failed?: number
  error?: string
  /** Page these numbers belong to — the to-do lane needs it to name the Page. */
  page_id?: string
  /** Known-bad posts we did not call Meta for at all this run. */
  posts_skipped?: number
  /** Posts that failed this run in a way retrying cannot fix. */
  posts_unreadable?: number
  /**
   * How many OWN-Page posts Meta refused for lack of a comment-reading scope.
   * Own-Page only: a refused post on someone ELSE's Page is not our scope
   * problem, and sending a human to widen permissions would be a wild goose
   * chase.
   */
  permission_denied_count?: number
  /** A few of those post ids, so a human can spot-check. Not the whole list. */
  permission_denied_sample?: string[]
  /** Set when the token itself was rejected — the scan stops, nothing else works. */
  token_invalid?: string
  /**
   * Why this run did not see the whole Page (post / Reel list failed, or the
   * granted-permission check could not be read). Always paired with ok=false:
   * a partial scan must never read as a healthy run.
   */
  scan_error?: string
  /**
   * The token lacks pages_manage_engagement, so public replies and hiding
   * cannot work. Those actions were not attempted; the comments are recorded
   * as needs-human instead (DMs use pages_messaging and still go out).
   */
  engagement_scope_missing?: boolean
  /** Comments whose public reply / hide was held back for lack of that permission. */
  replies_blocked?: number
  /** Posts whose comment read failed transiently (rate limit / 5xx / network). */
  posts_comment_read_failed?: number
  /**
   * Optional sources (Reels list, boosted-post list) Meta refused for this
   * token/Page. Not a failure — some Pages simply do not allow them — but kept
   * visible in the run summary rather than dropped.
   */
  sources_skipped?: string[]
}

/** Newest posts / Reels scanned per run, per edge. */
const MAX_OBJECTS_PER_EDGE = 100
/** Meta permission required to reply publicly to, or hide, a Page comment. */
export const ENGAGEMENT_SCOPE = 'pages_manage_engagement'
const ENGAGEMENT_BLOCKED_ERROR = `not sent: token lacks ${ENGAGEMENT_SCOPE}`

/** Max send attempts before a 'failed' row stops being retried. */
export const MAX_ATTEMPTS = 3
/** Non-terminal statuses that should never be reprocessed (claimed or done). */
const TERMINAL_OR_INFLIGHT = ['processing', 'replied', 'dm_sent', 'hidden', 'skipped', 'reverted']

/** Global kill switch — set SOCIAL_COMMENT_AUTOREPLY_KILL=1 in env to stop all runs. */
export function isKilled(): boolean {
  return process.env.SOCIAL_COMMENT_AUTOREPLY_KILL === '1'
}

/**
 * Run-level error text for cron_run_logs, or undefined when every client ran
 * clean. Setting it is what makes the run `failed` for cron health — per-client
 * `ok:false` buried in the summary is invisible there.
 */
export function describeFailedClients(results: ClientRunResult[]): string | undefined {
  const failed = results.filter(r => !r.ok)
  if (failed.length === 0) return undefined
  const detail = failed.map(r => `${r.client_id}: ${r.error ?? 'unknown'}`).join(' ; ')
  return `${failed.length}/${results.length} clients failed — ${detail}`.slice(0, 1000)
}

/** Process one client's recent comments end-to-end. Never throws — returns a result. */
export async function processClientComments(config: CommentConfig): Promise<ClientRunResult> {
  const clientId = config.client_id
  try {
    if (isKilled()) return { client_id: clientId, ok: true, error: 'killed' }

    const userToken = await getMetaTokenForClient(clientId)
    if (!userToken) return { client_id: clientId, ok: false, error: 'no Meta token configured' }

    const pageToken = await getPageAccessToken(userToken, config.fb_page_id)
    if (!pageToken) return { client_id: clientId, ok: false, error: 'could not resolve Page access token' }

    const ctxBase = await loadClientContext(clientId)

    // lookback_days bounds COMMENT freshness, NOT post age — an evergreen post
    // from months ago that still gets fresh comments must be handled.
    const cutoff = Date.now() - config.lookback_days * 86_400_000
    const { postIds, listErrors, sourcesSkipped } = await collectPostIds(config, pageToken, userToken, ctxBase.adAccountId)

    const now = new Date()
    const skips = new Map<string, PostSkip>()
    for (const s of await loadPostSkips(supabaseAdmin, clientId)) skips.set(s.post_id, s)
    const scan = { skipped: 0, attempted: 0, unreadable: 0, transient: 0, permissionDenied: [] as string[] }
    let tokenInvalid: string | undefined
    // 名单没变就不写库 —— 每 30 分钟一次无意义的 UPDATE 没有任何收益
    let skipsChanged = false

    const comments: PageComment[] = []
    for (const postId of Array.from(postIds)) {
      if (isStillSkipped(skips.get(postId), now)) {
        scan.skipped++
        continue
      }
      scan.attempted++
      const r = await fetchPostCommentsResult(postId, config.fb_page_id, pageToken, 100)
      if (r.ok) {
        // 读通了就把旧标记撤掉 —— 权限补上 / 帖子恢复后不该还挂着
        if (skips.delete(postId)) skipsChanged = true
        comments.push(...r.comments.filter(c => !c.isFromPage && new Date(c.createdAt).getTime() >= cutoff))
        continue
      }
      if (r.failure.reason === 'token_invalid') {
        // 令牌本身被拒 —— 剩下的帖子问一遍也是同一个答案，这一轮到此为止
        tokenInvalid = r.failure.message
        break
      }
      if (!isPersistableFailure(r.failure)) {
        // transient（限流 / 5xx / 网络）—— 下一轮会重试，但**这一轮**确实漏看了
        scan.transient++
        continue
      }
      scan.unreadable++
      if (r.failure.reason === 'permission_denied' && belongsToPage(postId, config.fb_page_id)) {
        scan.permissionDenied.push(postId)
      }
      skips.set(postId, mergeSkip(skips.get(postId), postId, r.failure, now))
      skipsChanged = true
    }
    if (skipsChanged) await savePostSkips(supabaseAdmin, clientId, Array.from(skips.values()))
    if (scan.transient > 0) {
      listErrors.push(`comments unreadable on ${scan.transient}/${scan.attempted} posts (rate limit / 5xx / network)`)
    }

    const candidates = (await filterProcessable(comments)).slice(0, config.max_replies_per_run)

    // 🔴 Fail closed on the send permission. Without pages_manage_engagement
    //    every public reply / hide is refused by Meta (2026-09-15: no production
    //    token has it), and the old path still tried each one and marked it
    //    failed — so nobody saw the real cause. Now: don't attempt them, record
    //    the comment as needs-human (it stays in the human queue and is never
    //    auto-replied later, so a hand-written reply cannot be doubled), and
    //    raise a to-do.
    //    An UNREADABLE permission list (Meta 5xx / network blip) is different:
    //    don't send, but don't claim either — marking those comments needs-human
    //    would take them away from auto-reply for good over a transient error.
    //    They are retried next run; the run itself is reported as failed.
    const granted = await listGrantedScopes(userToken)
    const canEngage = granted?.includes(ENGAGEMENT_SCOPE) ?? false
    const scanErrors = granted === null ? [...listErrors, 'could not read granted permissions (/me/permissions)'] : listErrors

    const tally = { public_replies: 0, private_replies: 0, hidden: 0, needs_human: 0, failed: 0 }
    let blocked = 0
    for (const comment of granted === null ? [] : candidates) {
      const claim = await claimComment(comment, config)
      if (!claim) continue // another run/pass owns it, or not retryable
      const outcome = await processClaimedComment(comment, claim, config, ctxBase, pageToken, canEngage)
      blocked += outcome.blocked ? 1 : 0
      tally.public_replies += outcome.publicReplied ? 1 : 0
      tally.private_replies += outcome.dmSent ? 1 : 0
      tally.hidden += outcome.hidden ? 1 : 0
      tally.needs_human += outcome.needsHuman ? 1 : 0
      tally.failed += outcome.failed ? 1 : 0
    }

    const scanError = scanErrors.length > 0 ? scanErrors.join(' | ') : undefined
    return {
      client_id: clientId,
      // 令牌被拒 / 帖子列表没读全时这一轮并没有真的跑完 —— 记成 ok 就是那种
      // 「报告一切正常、其实什么都没读到」的静默失败
      ok: !tokenInvalid && !scanError,
      page_id: config.fb_page_id,
      posts_scanned: postIds.size,
      posts_skipped: scan.skipped,
      posts_unreadable: scan.unreadable,
      permission_denied_count: scan.permissionDenied.length,
      permission_denied_sample: scan.permissionDenied.slice(0, 5),
      new_comments: candidates.length,
      ...tally,
      posts_comment_read_failed: scan.transient,
      ...(sourcesSkipped.length > 0 ? { sources_skipped: sourcesSkipped } : {}),
      ...(granted !== null && !canEngage ? { engagement_scope_missing: true } : {}),
      ...(!canEngage ? { replies_blocked: blocked } : {}),
      ...(scanError ? { scan_error: scanError, error: `comment scan incomplete: ${scanError}` } : {}),
      ...(tokenInvalid ? { token_invalid: tokenInvalid, error: `Meta token rejected: ${tokenInvalid}` } : {}),
    }
  } catch (err) {
    return { client_id: clientId, ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/**
 * Which posts to read comments from: recent feed posts + Reels (whose comments
 * live on the video object, not the /published_posts representation) + pinned
 * evergreen posts + boosted story ids from the ad account.
 *
 * A list that fails part-way still returns what it got — the caller replies on
 * those and reports the scan as incomplete via `listErrors`. The feed list is
 * required; Reels and boosted posts are optional sources — when Meta refuses
 * them outright (permission / unsupported), that goes to `sourcesSkipped`
 * instead, so a Page that cannot list Reels does not fail every run forever.
 */
async function collectPostIds(
  config: CommentConfig,
  pageToken: string,
  userToken: string,
  adAccountId: string | null,
): Promise<{ postIds: Set<string>; listErrors: string[]; sourcesSkipped: string[] }> {
  const list = (edge: 'published_posts' | 'video_reels') =>
    listPageObjectIds({ pageId: config.fb_page_id, pageAccessToken: pageToken, edge, maxItems: MAX_OBJECTS_PER_EDGE })
  const [posts, reels] = await Promise.all([list('published_posts'), list('video_reels')])
  // 🔴 用 fullId（`<page_id>_<post_id>`），不是拆过的 postId。
  //    /comments 边上给裸 id，Graph 会把它当成老式 singular status 对象，
  //    直接回 #12「该端点自 v2.4 起已下线」—— 2026-08-15 生产日志里那批
  //    每半小时重复一次的 400 就是这么来的。/published_posts 返回的 id 本来就是
  //    fullId；Reels 的 id 就是视频 id，两边可以一视同仁。
  const postIds = new Set([...posts.ids, ...reels.ids])
  const listErrors: string[] = []
  const sourcesSkipped: string[] = []
  if (!posts.ok) listErrors.push(posts.error)
  if (!reels.ok) (isSourceRefusal(reels.code) ? sourcesSkipped : listErrors).push(reels.error)
  for (const pid of config.pinned_post_ids ?? []) if (pid) postIds.add(pid)
  // Boosted posts/Reels carry paid-delivery comments on the ad's story object,
  // which the organic endpoints undercount. Pull those story ids via the Ads API.
  if (adAccountId) {
    const ads = await fetchAdStoryIdsResult(adAccountId, userToken)
    if (ads.error) (isSourceRefusal(ads.code) ? sourcesSkipped : listErrors).push(ads.error)
    // 广告账户里会混进**别人主页**的素材（老广告、合作方主页）。用本主页的
    // token 去读它们，Meta 一律回 #10 —— 那不是我们缺权限，是根本不该问。
    for (const sid of ads.ids) if (belongsToPage(sid, config.fb_page_id)) postIds.add(sid)
  }
  return { postIds, listErrors, sourcesSkipped }
}

/**
 * Graph codes that mean "this token/Page may not use this edge at all" —
 * #3 capability, #10 and #200-299 permission, #100 unsupported / not found.
 * Asking again next run gets the same answer, so it is not a scan failure.
 * Code 1 (too much data), 5xx and network errors are NOT refusals.
 */
function isSourceRefusal(code: number | null): boolean {
  return code === 3 || code === 10 || code === 100 || (code !== null && code >= 200 && code < 300)
}

/**
 * Is this post id one of OUR Page's objects?
 *
 * Page feed posts and ad story ids look like `<page_id>_<post_id>`; Reels and
 * videos are a bare numeric id and only ever reach us from this Page's own
 * endpoints, so they count as ours.
 */
export function belongsToPage(postId: string, pageId: string): boolean {
  return !postId.includes('_') || postId.startsWith(`${pageId}_`)
}

interface CommentContext extends ReplyContext { clientId: string; adAccountId: string | null }

async function loadClientContext(clientId: string): Promise<CommentContext> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('name, domain, meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  const name = (data?.name as string) ?? 'our team'
  const domain = (data?.domain as string) ?? ''
  return {
    clientId,
    clientName: name,
    siteUrl: domain ? `https://${domain}` : '',
    adAccountId: (data?.meta_ad_account_id as string) ?? null,
  }
}

interface ExistingRow { comment_id: string; reply_status: string; attempts: number }

/**
 * Pre-filter: keep comments with no row, or a retryable 'failed' row
 * (attempts < MAX). Terminal / in-flight rows are excluded so we never
 * reclassify or resend them. This is only a cheap pre-pass — claimComment()
 * performs the real atomic lock.
 */
async function filterProcessable(comments: PageComment[]): Promise<PageComment[]> {
  if (comments.length === 0) return []
  const ids = comments.map(c => c.commentId)
  const { data } = await supabaseAdmin
    .from('social_comment_engagements')
    .select('comment_id, reply_status, attempts')
    .in('comment_id', ids)
  const byId = new Map<string, ExistingRow>()
  for (const r of (data ?? []) as ExistingRow[]) byId.set(r.comment_id, r)

  return comments.filter(c => {
    const row = byId.get(c.commentId)
    if (!row) return true
    return row.reply_status === 'failed' && (row.attempts ?? 0) < MAX_ATTEMPTS
  })
}

interface Claim { rowId: string; attempts: number }

/**
 * Atomically claim a comment for processing. Returns the claimed row's id, or
 * null when another run already owns it or it's not retryable.
 *
 * New comment  → insert 'processing' (UNIQUE(comment_id) rejects a racing run).
 * Failed retry → update the existing 'failed' row to 'processing', guarded on
 *                reply_status='failed' so only one racer wins.
 */
async function claimComment(comment: PageComment, config: CommentConfig): Promise<Claim | null> {
  const insertRes = await supabaseAdmin
    .from('social_comment_engagements')
    .insert({
      client_id: config.client_id,
      platform: 'facebook',
      page_id: config.fb_page_id,
      post_id: comment.postId,
      comment_id: comment.commentId,
      author_id: comment.fromId,
      author_name: comment.fromName,
      comment_text: comment.message,
      comment_created_at: comment.createdAt,
      reply_status: 'processing',
      attempts: 1,
    })
    .select('id, attempts')
    .single()

  if (!insertRes.error && insertRes.data) {
    return { rowId: insertRes.data.id as string, attempts: 1 }
  }

  // Insert failed — either a UNIQUE conflict (already claimed/done) or a retry
  // of a 'failed' row. Try to grab a retryable failed row atomically.
  const { data: existing } = await supabaseAdmin
    .from('social_comment_engagements')
    .select('id, reply_status, attempts')
    .eq('comment_id', comment.commentId)
    .maybeSingle()

  if (!existing) return null
  const row = existing as { id: string; reply_status: string; attempts: number }
  if (row.reply_status !== 'failed' || (row.attempts ?? 0) >= MAX_ATTEMPTS) return null

  const nextAttempts = (row.attempts ?? 0) + 1
  const { data: updated } = await supabaseAdmin
    .from('social_comment_engagements')
    .update({ reply_status: 'processing', attempts: nextAttempts, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('reply_status', 'failed') // lost the race if someone flipped it first
    .select('id')
    .maybeSingle()

  return updated ? { rowId: row.id, attempts: nextAttempts } : null
}

interface Outcome {
  publicReplied: boolean; dmSent: boolean; hidden: boolean; needsHuman: boolean; failed: boolean
  /** A public reply / hide was held back because the token lacks the permission. */
  blocked: boolean
}

function categoryAllowed(category: CommentCategory, config: CommentConfig): boolean {
  if (category === 'praise') return config.auto_reply_praise
  if (category === 'question') return config.auto_reply_question
  if (category === 'complaint') return config.auto_reply_complaint
  return false // 'spam' handled via auto_hide_spam; 'other' never auto-replies
}

/** Classify a claimed comment, act (DM-first), and finalise its row. */
async function processClaimedComment(
  comment: PageComment,
  claim: Claim,
  config: CommentConfig,
  ctxBase: CommentContext,
  pageToken: string,
  canEngage: boolean,
): Promise<Outcome> {
  const ctx: ReplyContext = {
    clientName: ctxBase.clientName,
    siteUrl: ctxBase.siteUrl,
    authorFirstName: firstName(comment.fromName),
  }
  const decision = await classifyComment(comment.message, ctx, seedFrom(comment.commentId))

  // Spam → hide (if enabled). No reply.
  if (decision.shouldHide) {
    const blocked = config.auto_hide_spam && !canEngage
    const hidden = config.auto_hide_spam && canEngage ? await hideComment(comment.commentId, pageToken) : false
    await finalise(claim.rowId, decision, {
      status: hidden ? 'hidden' : blocked ? 'pending' : 'skipped', hidden, dmSent: false, publicReplyId: null, publicText: null,
      ...(blocked ? { needsHuman: true, error: ENGAGEMENT_BLOCKED_ERROR } : {}),
    })
    return { publicReplied: false, dmSent: false, hidden, needsHuman: blocked, failed: false, blocked }
  }

  // Category disabled → record classification, take no send action.
  if (!categoryAllowed(decision.category, config)) {
    await finalise(claim.rowId, decision, {
      status: decision.needsHuman ? 'pending' : 'skipped', hidden: false, dmSent: false, publicReplyId: null, publicText: null,
    })
    return { publicReplied: false, dmSent: false, hidden: false, needsHuman: decision.needsHuman, failed: false, blocked: false }
  }

  // DM-first, so the public "we've messaged you" wording is only used if it landed.
  let dmSent = false
  if (decision.privateReply && config.private_reply_enabled) {
    dmSent = await sendPrivateReply(comment.commentId, decision.privateReply, pageToken)
  }
  const publicText = (dmSent && decision.publicReplyAfterDm) ? decision.publicReplyAfterDm : decision.publicReply

  let publicReplyId: string | null = null
  let publicFailed = false
  const blocked = Boolean(publicText) && !canEngage
  if (publicText && canEngage) {
    publicReplyId = await replyToComment(comment.commentId, publicText, pageToken)
    publicFailed = publicReplyId === null
  }

  const status = publicReplyId ? 'replied'
    : dmSent ? 'dm_sent'
    : publicFailed ? 'failed'
    : decision.needsHuman || blocked ? 'pending'
    : 'skipped'

  await finalise(claim.rowId, decision, {
    status, hidden: false, dmSent, publicReplyId,
    publicText: publicReplyId ? publicText : null,
    error: publicFailed ? 'replyToComment returned null (check pages_manage_engagement scope / rate limit)'
      : blocked ? ENGAGEMENT_BLOCKED_ERROR : undefined,
    ...(blocked ? { needsHuman: true } : {}),
  })

  if (publicReplyId || dmSent) await recordFlywheel(comment, config, decision, { publicReplyId, dmSent, hidden: false })

  return {
    publicReplied: publicReplyId !== null,
    dmSent,
    hidden: false,
    needsHuman: decision.needsHuman || blocked,
    failed: status === 'failed',
    blocked,
  }
}

interface FinaliseResult {
  status: string
  hidden: boolean
  dmSent: boolean
  publicReplyId: string | null
  publicText: string | null
  error?: string
  /** Overrides the classifier's needs_human (e.g. a reply we could not send). */
  needsHuman?: boolean
}

/** Update the claimed row with the classification + send result. Logs (never throws) on DB error. */
async function finalise(rowId: string, decision: CommentDecision, r: FinaliseResult): Promise<void> {
  const { error } = await supabaseAdmin
    .from('social_comment_engagements')
    .update({
      category: decision.category,
      category_confidence: decision.confidence,
      needs_human: r.needsHuman ?? decision.needsHuman,
      guardrail_flags: decision.guardrailFlags,
      reply_source: decision.replySource,
      reply_status: r.status,
      public_reply_text: r.publicText,
      public_reply_id: r.publicReplyId,
      private_reply_text: r.dmSent ? decision.privateReply : null,
      private_reply_sent: r.dmSent,
      hidden: r.hidden,
      error_message: r.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
  if (error) console.error('[autoreply-engine] finalise update failed:', error.message)
}

async function recordFlywheel(
  comment: PageComment,
  config: CommentConfig,
  decision: CommentDecision,
  result: { publicReplyId: string | null; dmSent: boolean; hidden: boolean },
): Promise<void> {
  await supabaseAdmin.from('flywheel_actions').insert({
    client_id: config.client_id,
    flywheel: 'social',
    action_type: 'social.comment_auto_reply',
    execution_mode: 'in_house',
    payload: {
      comment_id: comment.commentId,
      category: decision.category,
      public_replied: result.publicReplyId !== null,
      dm_sent: result.dmSent,
      hidden: result.hidden,
    },
  }).then(() => {}, () => { /* non-fatal */ })
}

function firstName(fullName: string | null): string | undefined {
  if (!fullName) return undefined
  const first = fullName.trim().split(/\s+/)[0]
  return first || undefined
}

/** Deterministic small seed from a comment id, to rotate praise fallback templates. */
function seedFrom(commentId: string): number {
  let h = 0
  for (let i = 0; i < commentId.length; i++) h = (h + commentId.charCodeAt(i)) % 997
  return h
}
