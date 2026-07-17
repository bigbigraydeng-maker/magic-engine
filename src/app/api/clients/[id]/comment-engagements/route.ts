/**
 * Social comment engagements — FDE audit view.
 *
 * GET   → recent auto-reply decisions for the client (what was replied / DM'd /
 *         hidden / flagged for human). Supports ?status=, ?needs_human=1, ?limit=.
 * PATCH → intervene on one engagement:
 *           action 'revert'        — delete our public reply on FB, mark reverted
 *           action 'mark_reviewed' — FDE acknowledged (clears needs_human)
 *
 * Read-only surface over a full-auto system: the cron does the work, humans
 * only inspect + occasionally undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { deleteComment } from '@/lib/meta/comments'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const url = new URL(req.url)
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
