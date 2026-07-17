/**
 * Comment auto-reply engine — per-client orchestration.
 *
 * For one client: resolve Page token, pull recent posts + comments, skip ones
 * we've already handled (idempotent on comment_id), classify each new comment,
 * take the guardrailed action (public reply / DM / hide), and log every decision
 * to social_comment_engagements for the FDE audit view + flywheel attribution.
 *
 * Full-auto: no human approval step. Safety comes from (1) the classifier never
 * letting an LLM answer a factual question, (2) the deterministic claim filter,
 * (3) a global kill switch + per-client enable flag, (4) idempotency so a
 * comment is never replied to twice.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken, fetchPagePosts } from '@/lib/meta/page-posts'
import { fetchPostComments, replyToComment, sendPrivateReply, hideComment, PageComment } from '@/lib/meta/comments'
import { classifyComment, CommentDecision } from './comment-classifier'
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
  error?: string
}

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

    // 1. Recent posts within the lookback window
    const cutoff = Date.now() - config.lookback_days * 86_400_000
    const posts = (await fetchPagePosts(config.fb_page_id, pageToken, 25))
      .filter(p => new Date(p.createdAt).getTime() >= cutoff)

    // 2. Gather comments across those posts, drop self-authored
    const comments: PageComment[] = []
    for (const post of posts) {
      const cs = await fetchPostComments(post.postId, config.fb_page_id, pageToken, 50)
      comments.push(...cs.filter(c => !c.isFromPage && new Date(c.createdAt).getTime() >= cutoff))
    }

    // 3. Idempotency — skip comments we've already logged
    const fresh = await filterUnprocessed(comments)
    const batch = fresh.slice(0, config.max_replies_per_run)

    const tally = { public_replies: 0, private_replies: 0, hidden: 0, needs_human: 0 }
    for (const comment of batch) {
      const outcome = await handleComment(comment, config, ctxBase, pageToken)
      tally.public_replies += outcome.publicReplied ? 1 : 0
      tally.private_replies += outcome.dmSent ? 1 : 0
      tally.hidden += outcome.hidden ? 1 : 0
      tally.needs_human += outcome.needsHuman ? 1 : 0
    }

    return {
      client_id: clientId, ok: true,
      posts_scanned: posts.length, new_comments: batch.length, ...tally,
    }
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

/** Return only comments with no existing engagement row (idempotency). */
async function filterUnprocessed(comments: PageComment[]): Promise<PageComment[]> {
  if (comments.length === 0) return []
  const ids = comments.map(c => c.commentId)
  const { data } = await supabaseAdmin
    .from('social_comment_engagements')
    .select('comment_id')
    .in('comment_id', ids)
  const seen = new Set((data ?? []).map(r => (r as { comment_id: string }).comment_id))
  return comments.filter(c => !seen.has(c.commentId))
}

interface HandleOutcome {
  publicReplied: boolean
  dmSent: boolean
  hidden: boolean
  needsHuman: boolean
}

/** Classify + act on a single comment, then persist the decision + result. */
async function handleComment(
  comment: PageComment,
  config: CommentConfig,
  ctxBase: CommentContext,
  pageToken: string,
): Promise<HandleOutcome> {
  const ctx: ReplyContext = {
    clientName: ctxBase.clientName,
    siteUrl: ctxBase.siteUrl,
    authorFirstName: firstName(comment.fromName),
  }
  const decision = await classifyComment(comment.message, ctx)
  const allowed = categoryAllowed(decision.category, config)

  let publicReplyId: string | null = null
  let dmSent = false
  let hidden = false

  if (decision.shouldHide && config.auto_hide_spam) {
    hidden = await hideComment(comment.commentId, pageToken)
  } else if (allowed) {
    if (decision.publicReply) {
      publicReplyId = await replyToComment(comment.commentId, decision.publicReply, pageToken)
    }
    if (decision.privateReply && config.private_reply_enabled) {
      dmSent = await sendPrivateReply(comment.commentId, decision.privateReply, pageToken)
    }
  }

  await persistEngagement(comment, config, decision, { publicReplyId, dmSent, hidden })

  return {
    publicReplied: publicReplyId !== null,
    dmSent,
    hidden,
    needsHuman: decision.needsHuman,
  }
}

function categoryAllowed(category: CommentDecision['category'], config: CommentConfig): boolean {
  if (category === 'praise') return config.auto_reply_praise
  if (category === 'question') return config.auto_reply_question
  if (category === 'complaint') return config.auto_reply_complaint
  return false // 'spam' handled via auto_hide_spam; 'other' never auto-replies
}

async function persistEngagement(
  comment: PageComment,
  config: CommentConfig,
  decision: CommentDecision,
  result: { publicReplyId: string | null; dmSent: boolean; hidden: boolean },
): Promise<void> {
  const status = result.hidden ? 'hidden'
    : result.publicReplyId ? 'replied'
    : result.dmSent ? 'dm_sent'
    : decision.needsHuman ? 'pending'
    : 'skipped'

  await supabaseAdmin.from('social_comment_engagements').insert({
    client_id: config.client_id,
    platform: 'facebook',
    page_id: config.fb_page_id,
    post_id: comment.postId,
    comment_id: comment.commentId,
    author_id: comment.fromId,
    author_name: comment.fromName,
    comment_text: comment.message,
    comment_created_at: comment.createdAt,
    category: decision.category,
    category_confidence: decision.confidence,
    needs_human: decision.needsHuman,
    guardrail_flags: decision.guardrailFlags,
    reply_source: decision.replySource,
    reply_status: status,
    public_reply_text: decision.publicReply,
    public_reply_id: result.publicReplyId,
    private_reply_text: result.dmSent ? decision.privateReply : null,
    private_reply_sent: result.dmSent,
    hidden: result.hidden,
  }).then(() => {}, (e) => console.error('[autoreply-engine] persist failed:', e?.message))

  // Flywheel attribution — best-effort, non-fatal.
  if (result.publicReplyId || result.dmSent || result.hidden) {
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
    }).then(() => {}, () => {})
  }
}

function firstName(fullName: string | null): string | undefined {
  if (!fullName) return undefined
  const first = fullName.trim().split(/\s+/)[0]
  return first || undefined
}
