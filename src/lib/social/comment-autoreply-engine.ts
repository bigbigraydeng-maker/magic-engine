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
import { getPageAccessToken, fetchPagePosts } from '@/lib/meta/page-posts'
import { fetchPostComments, replyToComment, sendPrivateReply, hideComment, PageComment } from '@/lib/meta/comments'
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
}

/** Max send attempts before a 'failed' row stops being retried. */
export const MAX_ATTEMPTS = 3
/** Non-terminal statuses that should never be reprocessed (claimed or done). */
const TERMINAL_OR_INFLIGHT = ['processing', 'replied', 'dm_sent', 'hidden', 'skipped', 'reverted']

/** Global kill switch — set SOCIAL_COMMENT_AUTOREPLY_KILL=1 in env to stop all runs. */
export function isKilled(): boolean {
  return process.env.SOCIAL_COMMENT_AUTOREPLY_KILL === '1'
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
    // from months ago that still gets fresh comments must be handled. Scan the
    // page's recent posts (up to 100) regardless of when they were published,
    // then reply only to comments newer than the cutoff.
    const cutoff = Date.now() - config.lookback_days * 86_400_000
    const recent = await fetchPagePosts(config.fb_page_id, pageToken, 100)
    // Scan recent posts + any pinned evergreen posts (which may be older than
    // the recent-100 window but still get fresh comments).
    const postIds = new Set(recent.map(p => p.postId))
    for (const pid of config.pinned_post_ids ?? []) if (pid) postIds.add(pid)

    const comments: PageComment[] = []
    for (const postId of Array.from(postIds)) {
      const cs = await fetchPostComments(postId, config.fb_page_id, pageToken, 100)
      comments.push(...cs.filter(c => !c.isFromPage && new Date(c.createdAt).getTime() >= cutoff))
    }

    const candidates = (await filterProcessable(comments)).slice(0, config.max_replies_per_run)

    const tally = { public_replies: 0, private_replies: 0, hidden: 0, needs_human: 0, failed: 0 }
    for (const comment of candidates) {
      const claim = await claimComment(comment, config)
      if (!claim) continue // another run/pass owns it, or not retryable
      const outcome = await processClaimedComment(comment, claim, config, ctxBase, pageToken)
      tally.public_replies += outcome.publicReplied ? 1 : 0
      tally.private_replies += outcome.dmSent ? 1 : 0
      tally.hidden += outcome.hidden ? 1 : 0
      tally.needs_human += outcome.needsHuman ? 1 : 0
      tally.failed += outcome.failed ? 1 : 0
    }

    return { client_id: clientId, ok: true, posts_scanned: postIds.size, new_comments: candidates.length, ...tally }
  } catch (err) {
    return { client_id: clientId, ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

interface CommentContext extends ReplyContext { clientId: string }

async function loadClientContext(clientId: string): Promise<CommentContext> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('name, domain')
    .eq('id', clientId)
    .maybeSingle()
  const name = (data?.name as string) ?? 'our team'
  const domain = (data?.domain as string) ?? ''
  return { clientId, clientName: name, siteUrl: domain ? `https://${domain}` : '' }
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

interface Outcome { publicReplied: boolean; dmSent: boolean; hidden: boolean; needsHuman: boolean; failed: boolean }

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
): Promise<Outcome> {
  const ctx: ReplyContext = {
    clientName: ctxBase.clientName,
    siteUrl: ctxBase.siteUrl,
    authorFirstName: firstName(comment.fromName),
  }
  const decision = await classifyComment(comment.message, ctx, seedFrom(comment.commentId))

  // Spam → hide (if enabled). No reply.
  if (decision.shouldHide) {
    const hidden = config.auto_hide_spam ? await hideComment(comment.commentId, pageToken) : false
    await finalise(claim.rowId, decision, {
      status: hidden ? 'hidden' : 'skipped', hidden, dmSent: false, publicReplyId: null, publicText: null,
    })
    return { publicReplied: false, dmSent: false, hidden, needsHuman: false, failed: false }
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
