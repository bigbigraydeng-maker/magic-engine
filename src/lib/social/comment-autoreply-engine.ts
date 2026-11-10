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
 * Send gate: before a public reply or private reply, `routeComment` must return
 * a greeting, FAQ or genuine praise. Price, complaint, refund, booking change,
 * unknown, or a routing throw is recorded for the
 * existing human queue and does not call Meta. Spam the classifier marks with
 * shouldHide is still hidden, as before. If classification throws, nothing is
 * hidden or sent — the comment waits for a person.
 *
 * DM-first: when a send is allowed, the DM goes out before the public reply, so
 * the public "we've messaged you" wording is only used when the DM actually
 * landed (otherwise a no-DM public variant is used — never a false claim).
 *
 * A send that is attempted but fails is recorded as reply_status='failed' with
 * an error_message and retried on a later run (bounded by MAX_ATTEMPTS) — a
 * failed reply is never silently dropped.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchPagePosts, fetchPageReels, fetchPostText, type HalvingStats, type PostText } from '@/lib/meta/page-posts'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { fetchAdStoryIds } from '@/lib/meta/ads-posts'
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
import { routeComment, type CommentIntent } from './comment-routing'
import { draftTourAnswer } from './comment-tour-draft'
import { loadSocialFactSource, type SocialFactSource } from './weekly-loop/fact-aliases'

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
  /** needs_human comments that got a catalog-grounded draft for a person to send. */
  drafts?: number
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
  /** Times Meta said "too much data" and the post-list page size was halved to retry. */
  list_halvings?: number
  /** Page size that finally worked for the post list (100 = no halving was needed). */
  list_page_size?: number
  /** Set when the token itself was rejected — the scan stops, nothing else works. */
  token_invalid?: string
}

/** Max send attempts before a 'failed' row stops being retried. */
export const MAX_ATTEMPTS = 3
/** Non-terminal statuses that should never be reprocessed (claimed or done). */
const TERMINAL_OR_INFLIGHT = ['processing', 'replied', 'dm_sent', 'hidden', 'skipped', 'reverted']

/** Global kill switch — set SOCIAL_COMMENT_AUTOREPLY_KILL=1 in env to stop all runs. */
export function isKilled(): boolean {
  return process.env.SOCIAL_COMMENT_AUTOREPLY_KILL === '1'
}

/** Stops catalog-grounded drafting only (set SOCIAL_COMMENT_TOUR_DRAFT_KILL=1). Replies are unaffected. */
export function isTourDraftKilled(): boolean {
  return process.env.SOCIAL_COMMENT_TOUR_DRAFT_KILL === '1'
}

/**
 * Per-run memo for drafting: the catalog is read at most once per run, and a
 * post's text at most once per post. Both are loaded lazily — a run with no
 * question comments reads neither.
 */
interface DraftScratch {
  clientId: string
  pageToken: string
  today: string
  facts?: Promise<SocialFactSource>
  posts: Map<string, Promise<PostText | null>>
}

function newDraftScratch(clientId: string, pageToken: string): DraftScratch {
  return { clientId, pageToken, today: new Date().toISOString().slice(0, 10), posts: new Map() }
}

async function pageGate(
  clientId: string,
  configuredPageId: string,
): Promise<{ ok: true; pageToken: string } | { ok: false; error: string }> {
  const auth = await authorizeConfiguredPage(supabaseAdmin, clientId, configuredPageId, process.env)
  if (auth.ok) return { ok: true, pageToken: auth.pageToken }
  if (auth.skipped === 'page_not_verified') return { ok: false, error: `page_not_verified: ${auth.reason}` }
  if (auth.skipped === 'no_meta_token') return { ok: false, error: 'no Meta token configured' }
  return { ok: false, error: 'could not resolve Page access token' }
}

/** Process one client's recent comments end-to-end. Never throws — returns a result. */
export async function processClientComments(config: CommentConfig): Promise<ClientRunResult> {
  const clientId = config.client_id
  try {
    if (isKilled()) return { client_id: clientId, ok: true, error: 'killed' }

    // AD-SEC-4: this run reads, replies to, hides and DMs on the configured Page,
    // and the config is editable by client members. Only act on a Page that is the
    // client's verified bound Page (or one it consented to via OAuth) — otherwise a
    // client could point it at another client's Page and act there with a token
    // that can see both.
    const gate = await pageGate(clientId, config.fb_page_id)
    if (!gate.ok) return { client_id: clientId, ok: false, error: gate.error }
    const pageToken = gate.pageToken

    const ctxBase = await loadClientContext(clientId)

    // lookback_days bounds COMMENT freshness, NOT post age — an evergreen post
    // from months ago that still gets fresh comments must be handled. Scan the
    // page's recent posts (up to 100) regardless of when they were published,
    // then reply only to comments newer than the cutoff.
    const cutoff = Date.now() - config.lookback_days * 86_400_000
    // Scan recent feed posts + Reels (whose comments live on the video object,
    // not the /published_posts representation) + any pinned evergreen posts.
    const postStats: HalvingStats = { halvings: 0, finalLimit: 100 }
    const reelStats: HalvingStats = { halvings: 0, finalLimit: 100 }
    const [recent, reels] = await Promise.all([
      fetchPagePosts(config.fb_page_id, pageToken, 100, { stats: postStats }),
      fetchPageReels(config.fb_page_id, pageToken, 100, { stats: reelStats }),
    ])
    // 🔴 用 fullId（`<page_id>_<post_id>`），不是拆过的 postId。
    //    /comments 边上给裸 id，Graph 会把它当成老式 singular status 对象，
    //    直接回 #12「该端点自 v2.4 起已下线」—— 2026-08-15 生产日志里那批
    //    每半小时重复一次的 400 就是这么来的。Reels 的 fullId 就是视频 id，
    //    两边可以一视同仁。
    const postIds = new Set([...recent.map(p => p.fullId), ...reels.map(r => r.fullId)])
    for (const pid of config.pinned_post_ids ?? []) if (pid) postIds.add(pid)
    // Boosted posts/Reels carry paid-delivery comments on the ad's story object,
    // which the organic endpoints undercount. Pull those story ids via the Ads API.
    // The ads API needs the user token, not the Page token; without one (a
    // client connected only through OAuth) boosted-post comments are skipped.
    const userToken = ctxBase.adAccountId ? await getMetaTokenForClient(clientId) : null
    if (ctxBase.adAccountId && userToken) {
      const storyIds = await fetchAdStoryIds(ctxBase.adAccountId, userToken).catch(() => [])
      // 广告账户里会混进**别人主页**的素材（老广告、合作方主页）。用本主页的
      // token 去读它们，Meta 一律回 #10 —— 那不是我们缺权限，是根本不该问。
      for (const sid of storyIds) if (belongsToPage(sid, config.fb_page_id)) postIds.add(sid)
    }

    const now = new Date()
    const skips = new Map<string, PostSkip>()
    for (const s of await loadPostSkips(supabaseAdmin, clientId)) skips.set(s.post_id, s)
    const scan = { skipped: 0, unreadable: 0, permissionDenied: [] as string[] }
    let tokenInvalid: string | undefined
    // 名单没变就不写库 —— 每 30 分钟一次无意义的 UPDATE 没有任何收益
    let skipsChanged = false

    const comments: PageComment[] = []
    for (const postId of Array.from(postIds)) {
      if (isStillSkipped(skips.get(postId), now)) {
        scan.skipped++
        continue
      }
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
      if (!isPersistableFailure(r.failure)) continue
      scan.unreadable++
      if (r.failure.reason === 'permission_denied' && belongsToPage(postId, config.fb_page_id)) {
        scan.permissionDenied.push(postId)
      }
      skips.set(postId, mergeSkip(skips.get(postId), postId, r.failure, now))
      skipsChanged = true
    }
    if (skipsChanged) await savePostSkips(supabaseAdmin, clientId, Array.from(skips.values()))

    const candidates = (await filterProcessable(comments)).slice(0, config.max_replies_per_run)

    const tally = { public_replies: 0, private_replies: 0, hidden: 0, needs_human: 0, failed: 0, drafts: 0 }
    const scratch = newDraftScratch(clientId, pageToken)
    for (const comment of candidates) {
      const claim = await claimComment(comment, config)
      if (!claim) continue // another run/pass owns it, or not retryable
      const outcome = await processClaimedComment(comment, claim, config, ctxBase, pageToken, scratch)
      tally.public_replies += outcome.publicReplied ? 1 : 0
      tally.private_replies += outcome.dmSent ? 1 : 0
      tally.hidden += outcome.hidden ? 1 : 0
      tally.needs_human += outcome.needsHuman ? 1 : 0
      tally.failed += outcome.failed ? 1 : 0
      tally.drafts += outcome.drafted ? 1 : 0
    }

    return {
      client_id: clientId,
      // 令牌被拒时这一轮并没有真的跑完 —— 记成 ok 就是那种「报告一切正常、
      // 其实什么都没读到」的静默失败
      ok: !tokenInvalid,
      page_id: config.fb_page_id,
      posts_scanned: postIds.size,
      list_halvings: postStats.halvings + reelStats.halvings,
      list_page_size: Math.min(postStats.finalLimit, reelStats.finalLimit),
      posts_skipped: scan.skipped,
      posts_unreadable: scan.unreadable,
      permission_denied_count: scan.permissionDenied.length,
      permission_denied_sample: scan.permissionDenied.slice(0, 5),
      new_comments: candidates.length,
      ...tally,
      ...(tokenInvalid ? { token_invalid: tokenInvalid, error: `Meta token rejected: ${tokenInvalid}` } : {}),
    }
  } catch (err) {
    return { client_id: clientId, ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
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

interface Outcome { publicReplied: boolean; dmSent: boolean; hidden: boolean; needsHuman: boolean; failed: boolean; drafted?: boolean }

function categoryAllowed(category: CommentCategory, config: CommentConfig): boolean {
  if (category === 'praise') return config.auto_reply_praise
  if (category === 'question') return config.auto_reply_question
  if (category === 'complaint') return config.auto_reply_complaint
  return false // 'spam' handled via auto_hide_spam; 'other' never auto-replies
}

/** Intents that may receive an automatic public reply or DM. Everything else waits for a person. */
const GREETING_OR_FAQ: ReadonlySet<CommentIntent> = new Set([
  'greeting',
  'faq_itinerary',
  'faq_visa',
  'faq_signup',
  'praise',
])

export type CommentAutoReplyBlock = 'not_greeting_or_faq' | 'routing_error'

export type CommentAutoReplyGate =
  | { send: true }
  | { send: false; block: CommentAutoReplyBlock }

/**
 * Fail closed for replies and DMs. A throw, an unknown intent, or any route
 * other than greeting/FAQ means do not reply. `route === 'auto_ok'` is not
 * enough on its own. Spam hiding is decided separately, before this gate.
 */
export function assessCommentAutoReply(
  commentText: string,
  category: string | null,
): CommentAutoReplyGate {
  try {
    const routing = routeComment({ category, comment_text: commentText })
    if (routing.route === 'auto_ok' && GREETING_OR_FAQ.has(routing.intent)) return { send: true }
    return { send: false, block: 'not_greeting_or_faq' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[autoreply-engine] routeComment failed; not sending:', message)
    return { send: false, block: 'routing_error' }
  }
}

function handoffDecision(decision: CommentDecision, block: CommentAutoReplyBlock): CommentDecision {
  const flag = block === 'routing_error' ? 'routing_error' : 'not_greeting_or_faq'
  const flags = decision.guardrailFlags.includes(flag)
    ? decision.guardrailFlags
    : [...decision.guardrailFlags, flag]
  return { ...decision, needsHuman: true, shouldHide: false, guardrailFlags: flags }
}

export const TOUR_DRAFT_FLAG = 'tour_draft'

function withDraft(decision: CommentDecision): CommentDecision {
  const flags = decision.guardrailFlags.includes(TOUR_DRAFT_FLAG)
    ? decision.guardrailFlags
    : [...decision.guardrailFlags, TOUR_DRAFT_FLAG]
  return { ...decision, guardrailFlags: flags, replySource: 'catalog_draft' }
}

/** Human-only intents never get a draft, whatever the classifier called the comment. */
const NO_DRAFT_INTENTS: ReadonlySet<CommentIntent> = new Set(['price', 'complaint', 'refund', 'booking_change'])

/**
 * A reply draft grounded in the client's published tour catalog, or null.
 * Null for every doubt: no catalog, post not about one sellable tour, price /
 * complaint / refund / booking wording, model failure, or a draft that says
 * more than the catalog does. Never throws and never calls a Meta write.
 */
async function tryTourDraft(comment: PageComment, ctx: ReplyContext, scratch: DraftScratch): Promise<string | null> {
  try {
    if (isTourDraftKilled()) return null
    if (NO_DRAFT_INTENTS.has(routeComment({ category: 'question', comment_text: comment.message }).intent)) return null

    scratch.facts ??= loadSocialFactSource(supabaseAdmin, scratch.clientId, scratch.today)
    const facts = await scratch.facts
    if (!facts.ok) return null

    let postRead = scratch.posts.get(comment.postId)
    if (!postRead) {
      postRead = fetchPostText(comment.postId, scratch.pageToken)
      scratch.posts.set(comment.postId, postRead)
    }
    const post = await postRead
    if (!post) return null

    const result = await draftTourAnswer({
      commentText: comment.message,
      authorFirstName: ctx.authorFirstName,
      post,
      tours: facts.tours,
      aliasesByTourId: facts.aliasesByTourId,
      today: scratch.today,
    })
    return result.ok ? result.reply : null
  } catch (err) {
    console.error('[autoreply-engine] tour draft failed; leaving the comment to a person:', err instanceof Error ? err.message : 'unknown')
    return null
  }
}

/** Classification threw. Do not hide and do not guess a reply. */
function classifierErrorDecision(): CommentDecision {
  return {
    category: 'other',
    confidence: 0,
    publicReply: null,
    publicReplyAfterDm: null,
    privateReply: null,
    shouldHide: false,
    needsHuman: true,
    guardrailFlags: ['classifier_error'],
    replySource: 'none',
  }
}

/** Classify a claimed comment, act (DM-first), and finalise its row. */
async function processClaimedComment(
  comment: PageComment,
  claim: Claim,
  config: CommentConfig,
  ctxBase: CommentContext,
  pageToken: string,
  scratch: DraftScratch,
): Promise<Outcome> {
  const ctx: ReplyContext = {
    clientName: ctxBase.clientName,
    siteUrl: ctxBase.siteUrl,
    authorFirstName: firstName(comment.fromName),
  }
  let decision: CommentDecision
  try {
    decision = await classifyComment(comment.message, ctx, seedFrom(comment.commentId))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error('[autoreply-engine] classifyComment failed; not hiding or sending:', message)
    await finalise(claim.rowId, classifierErrorDecision(), {
      status: 'pending', hidden: false, dmSent: false, publicReplyId: null, publicText: null,
    })
    return { publicReplied: false, dmSent: false, hidden: false, needsHuman: true, failed: false }
  }

  // Spam the classifier marked for hiding. Same path as before the reply gate.
  if (decision.shouldHide) {
    const hidden = config.auto_hide_spam ? await hideComment(comment.commentId, pageToken) : false
    await finalise(claim.rowId, decision, {
      status: hidden ? 'hidden' : 'skipped', hidden, dmSent: false, publicReplyId: null, publicText: null,
    })
    return { publicReplied: false, dmSent: false, hidden, needsHuman: false, failed: false }
  }

  // Greeting, FAQ or genuine praise only. Price, complaint, refund, unknown, and
  // routing errors are not replied to or DM'd — they join the needs_human queue.
  const gate = assessCommentAutoReply(comment.message, decision.category)
  if (!gate.send) {
    const handoff = handoffDecision(decision, gate.block)
    // A question we will not auto-answer may still get a catalog-grounded DRAFT.
    // Nothing is sent: the draft sits on the needs_human row for a person.
    const draft = gate.block === 'not_greeting_or_faq' && decision.category === 'question'
      ? await tryTourDraft(comment, ctx, scratch)
      : null
    await finalise(claim.rowId, draft ? withDraft(handoff) : handoff, {
      status: 'pending', hidden: false, dmSent: false, publicReplyId: null, publicText: draft,
    })
    return { publicReplied: false, dmSent: false, hidden: false, needsHuman: true, failed: false, drafted: draft !== null }
  }

  // Category disabled → record classification, take no send action.
  if (!categoryAllowed(decision.category, config)) {
    await finalise(claim.rowId, decision, {
      status: decision.needsHuman ? 'pending' : 'skipped', hidden: false, dmSent: false, publicReplyId: null, publicText: null,
    })
    return { publicReplied: false, dmSent: false, hidden: false, needsHuman: decision.needsHuman, failed: false }
  }

  // DM-first, so the public "we've messaged you" wording is only used if it landed.
  let dmSent = false
  if (decision.privateReply && config.private_reply_enabled) {
    dmSent = await sendPrivateReply(comment.commentId, decision.privateReply, pageToken)
  }
  const publicText = (dmSent && decision.publicReplyAfterDm) ? decision.publicReplyAfterDm : decision.publicReply

  let publicReplyId: string | null = null
  let publicFailed = false
  if (publicText) {
    publicReplyId = await replyToComment(comment.commentId, publicText, pageToken)
    publicFailed = publicReplyId === null
  }

  const status = publicReplyId ? 'replied'
    : dmSent ? 'dm_sent'
    : publicFailed ? 'failed'
    : decision.needsHuman ? 'pending'
    : 'skipped'

  await finalise(claim.rowId, decision, {
    status, hidden: false, dmSent, publicReplyId,
    publicText: publicReplyId ? publicText : null,
    error: publicFailed ? 'replyToComment returned null (check pages_manage_engagement scope / rate limit)' : undefined,
  })

  if (publicReplyId || dmSent) await recordFlywheel(comment, config, decision, { publicReplyId, dmSent, hidden: false })

  return {
    publicReplied: publicReplyId !== null,
    dmSent,
    hidden: false,
    needsHuman: decision.needsHuman,
    failed: status === 'failed',
  }
}

interface FinaliseResult {
  status: string
  hidden: boolean
  dmSent: boolean
  publicReplyId: string | null
  publicText: string | null
  error?: string
}

/** Update the claimed row with the classification + send result. Logs (never throws) on DB error. */
async function finalise(rowId: string, decision: CommentDecision, r: FinaliseResult): Promise<void> {
  const { error } = await supabaseAdmin
    .from('social_comment_engagements')
    .update({
      category: decision.category,
      category_confidence: decision.confidence,
      needs_human: decision.needsHuman,
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
