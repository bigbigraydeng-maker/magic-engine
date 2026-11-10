/**
 * Social comment engagements — FDE audit view.
 *
 * GET   → recent auto-reply decisions for the client (what was replied / DM'd /
 *         hidden / flagged for human). Supports ?status=, ?needs_human=1, ?limit=.
 * PATCH → intervene on one engagement:
 *           action 'revert'        — delete our public reply on FB, mark reverted
 *           action 'mark_reviewed' — FDE acknowledged (clears needs_human)
 *           action 'send_draft'    — a person sends the stored catalog draft (or
 *                                    their edited text) as the public reply
 *
 * Read-only surface over a full-auto system: the cron does the work, humans
 * only inspect + occasionally undo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { deleteComment, replyToComment } from '@/lib/meta/comments'
import { authorizeConfiguredPage } from '@/lib/meta/page-sync-authorization'

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
  /** send_draft only: the text to post, when the person edited the draft. */
  text?: unknown
}

const MAX_PUBLIC_REPLY_CHARS = 1000

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
  if (!engagementId || (action !== 'revert' && action !== 'mark_reviewed' && action !== 'send_draft')) {
    return NextResponse.json(
      { error: 'Body must include engagement_id and action ("revert" | "mark_reviewed" | "send_draft")' },
      { status: 400 },
    )
  }

  if (action === 'send_draft') {
    return sendDraft(clientId, engagementId, access.user.email ?? reviewer, body.text)
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

/**
 * A person sends the stored draft (or their edit of it) as the public reply.
 *
 * Claim first: the row moves pending → processing in one guarded UPDATE, so two
 * clicks (or a click racing anything else) post at most once. If Meta refuses,
 * the row goes back to pending with the reason and the draft intact.
 */
async function sendDraft(
  clientId: string,
  engagementId: string,
  reviewer: string | null,
  rawText: unknown,
): Promise<NextResponse> {
  const { data: row } = await supabaseAdmin
    .from('social_comment_engagements')
    .select('id, page_id, comment_id, public_reply_text, public_reply_id, reply_status')
    .eq('id', engagementId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 })

  const current = row as {
    page_id: string; comment_id: string; public_reply_text: string | null
    public_reply_id: string | null; reply_status: string
  }
  if (current.reply_status !== 'pending' || current.public_reply_id) {
    return NextResponse.json({ error: 'This comment is not waiting for a reply' }, { status: 409 })
  }
  const edited = typeof rawText === 'string' ? rawText.trim() : ''
  const text = edited.length > 0 ? edited : (current.public_reply_text ?? '').trim()
  if (text.length === 0) return NextResponse.json({ error: 'No reply text to send' }, { status: 400 })
  if (text.length > MAX_PUBLIC_REPLY_CHARS) {
    return NextResponse.json({ error: `Reply is longer than ${MAX_PUBLIC_REPLY_CHARS} characters` }, { status: 400 })
  }

  // Same Page check the engine uses: only the client's verified bound Page.
  const auth = await authorizeConfiguredPage(supabaseAdmin, clientId, current.page_id, process.env)
  if (!auth.ok) return NextResponse.json({ error: 'Could not resolve Page token to send the reply' }, { status: 502 })

  const now = new Date().toISOString()
  const { data: claimed } = await supabaseAdmin
    .from('social_comment_engagements')
    .update({ reply_status: 'processing', updated_at: now })
    .eq('id', engagementId)
    .eq('client_id', clientId)
    .eq('reply_status', 'pending')
    .is('public_reply_id', null)
    .select('id')
    .maybeSingle()
  if (!claimed) return NextResponse.json({ error: 'Someone else is already handling this comment' }, { status: 409 })

  const replyId = await replyToComment(current.comment_id, text, auth.pageToken)
  if (!replyId) {
    await supabaseAdmin
      .from('social_comment_engagements')
      .update({
        reply_status: 'pending',
        error_message: 'send_draft: Facebook did not accept the reply',
        updated_at: new Date().toISOString(),
      })
      .eq('id', engagementId)
    return NextResponse.json({ error: 'Facebook did not accept the reply' }, { status: 502 })
  }

  const done = new Date().toISOString()
  const { error: saveError } = await supabaseAdmin
    .from('social_comment_engagements')
    .update({
      reply_status: 'replied',
      public_reply_text: text,
      public_reply_id: replyId,
      needs_human: false,
      reviewed_by: reviewer,
      reviewed_at: done,
      error_message: null,
      updated_at: done,
    })
    .eq('id', engagementId)
  if (saveError) {
    // The reply IS on Facebook. Say so rather than report a clean failure.
    return NextResponse.json(
      { success: true, action: 'send_draft', public_reply_id: replyId, warning: 'Reply was posted but the record was not updated' },
      { status: 200 },
    )
  }
  return NextResponse.json({ success: true, action: 'send_draft', public_reply_id: replyId })
}
