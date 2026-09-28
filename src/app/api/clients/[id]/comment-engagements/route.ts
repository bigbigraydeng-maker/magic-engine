/**
 * Social comment engagements — FDE audit view.
 *
 * GET   → recent auto-reply decisions for the client (what was replied / DM'd /
 *         hidden / flagged for human). Supports ?status=, ?needs_human=1, ?limit=,
 *         ?stuck=1.
 * PATCH → intervene on one engagement:
 *           action 'revert'        — delete our public reply on FB, mark reverted
 *           action 'mark_reviewed' — FDE acknowledged (clears needs_human)
 *
 * Read-only surface over a full-auto system: the cron does the work, humans
 * only inspect + occasionally undo.
 *
 * `?stuck=1` mirrors comment-autoreply-stuck-items.ts's own "permanently
 * stuck" predicate (failed+retries exhausted / dm_sent with no public reply /
 * processing past the stale window) instead of the default recency window
 * (Codex round 7 复审 P1): the default `?limit=` page only covers the most
 * recent rows, so a stuck row older than that never loads client-side — its
 * only closing action ("标记已阅" in CommentAuditList.tsx) becomes permanently
 * unreachable even after an FDE has manually handled it. `stuck=1` ignores
 * `limit`/`status`/`needs_human` and returns every currently-stuck row for
 * this client regardless of age.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { deleteComment } from '@/lib/meta/comments'
import { MAX_ATTEMPTS, STALE_PROCESSING_MS, DEFAULT_LOOKBACK_DAYS } from '@/lib/social/comment-autoreply-constants'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const url = new URL(req.url)
  const stuck = url.searchParams.get('stuck') === '1'

  if (stuck) {
    const data = await fetchStuckEngagements(clientId)
    return NextResponse.json({ engagements: data })
  }

  const status = url.searchParams.get('status')
  const needsHuman = url.searchParams.get('needs_human') === '1'
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50))

  let query = supabaseAdmin
    .from('social_comment_engagements')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('reply_status', status)
  if (needsHuman) query = query.eq('needs_human', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ engagements: data ?? [] })
}

/**
 * Mirrors comment-autoreply-stuck-items.ts's own "permanently stuck" query
 * shape (separate branches, unioned) rather than one raw PostgREST `.or()`
 * filter string — same predicate logic in two different query styles would
 * drift out of sync over time, and this shape is already the proven, tested
 * pattern for this exact definition of "stuck". Capped at 200/branch
 * defensively; a single client with more permanently-stuck comments than
 * that is its own emergency, visible elsewhere.
 *
 * 4th branch — `failed` rows that haven't exhausted retries but have aged
 * out of the client's configured lookback window (Codex round 13 复审 P1):
 * round 12 added this category to the pm-todo detector but left this route
 * and `CommentAuditList.tsx`'s `isStuck()` on the old 3-category definition,
 * so a row only this route/detector agreed was "stuck" had no reachable
 * "标记已阅" — the exact closed-loop gap round 6/7 already fixed once for
 * the other three categories.
 */
async function fetchStuckEngagements(clientId: string) {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString()
  const base = () =>
    supabaseAdmin
      .from('social_comment_engagements')
      .select('*')
      .eq('client_id', clientId)
      .is('reviewed_at', null)
      .order('created_at', { ascending: false })
      .limit(200)

  const [failed, dmOnly, stuckProcessing, partialFailed, config] = await Promise.all([
    base().eq('reply_status', 'failed').gte('attempts', MAX_ATTEMPTS),
    base().eq('reply_status', 'dm_sent').is('public_reply_id', null),
    base().eq('reply_status', 'processing').lt('updated_at', staleBefore),
    base().eq('reply_status', 'failed').lt('attempts', MAX_ATTEMPTS),
    supabaseAdmin.from('social_comment_config').select('lookback_days').eq('client_id', clientId).maybeSingle(),
  ])
  for (const r of [failed, dmOnly, stuckProcessing, partialFailed]) {
    if (r.error) throw new Error(r.error.message)
  }
  const lookbackDays = (config.data as { lookback_days?: number | null } | null)?.lookback_days ?? DEFAULT_LOOKBACK_DAYS
  const lookbackCutoff = Date.now() - lookbackDays * 86_400_000
  const orphaned = (partialFailed.data ?? []).filter(
    (r) => Date.parse((r as { comment_created_at: string }).comment_created_at) < lookbackCutoff,
  )

  const byId = new Map<string, NonNullable<typeof failed.data>[number]>()
  for (const row of [...(failed.data ?? []), ...(dmOnly.data ?? []), ...(stuckProcessing.data ?? []), ...orphaned]) {
    byId.set((row as { id: string }).id, row)
  }
  return Array.from(byId.values())
}

interface PatchBody {
  engagement_id?: unknown
  action?: unknown
  reviewer?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const engagementId = typeof body.engagement_id === 'string' ? body.engagement_id : ''
  const action = body.action
  const reviewer = typeof body.reviewer === 'string' ? body.reviewer : null
  if (!engagementId || (action !== 'revert' && action !== 'mark_reviewed')) {
    return NextResponse.json(
      { error: 'Body must include engagement_id and action ("revert" | "mark_reviewed")' },
      { status: 400 },
    )
  }

  const { data: row } = await supabaseAdmin
    .from('social_comment_engagements')
    .select('id, client_id, page_id, public_reply_id, reply_status')
    .eq('id', engagementId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 })

  const now = new Date().toISOString()

  if (action === 'mark_reviewed') {
    await supabaseAdmin
      .from('social_comment_engagements')
      .update({ needs_human: false, reviewed_by: reviewer, reviewed_at: now, updated_at: now })
      .eq('id', engagementId)
    return NextResponse.json({ success: true, action: 'mark_reviewed' })
  }

  // action === 'revert' — delete our public reply on FB, then mark reverted.
  const publicReplyId = (row as { public_reply_id: string | null }).public_reply_id
  let fbDeleted = false
  if (publicReplyId) {
    const userToken = await getMetaTokenForClient(clientId)
    const pageId = (row as { page_id: string }).page_id
    const pageToken = userToken ? await getPageAccessToken(userToken, pageId) : null
    if (!pageToken) {
      return NextResponse.json({ error: 'Could not resolve Page token to delete the reply' }, { status: 502 })
    }
    fbDeleted = await deleteComment(publicReplyId, pageToken)
    if (!fbDeleted) {
      return NextResponse.json({ error: 'Failed to delete the reply on Facebook' }, { status: 502 })
    }
  }

  await supabaseAdmin
    .from('social_comment_engagements')
    .update({ reply_status: 'reverted', needs_human: false, reviewed_by: reviewer, reviewed_at: now, updated_at: now })
    .eq('id', engagementId)

  return NextResponse.json({ success: true, action: 'revert', fb_deleted: fbDeleted })
}
