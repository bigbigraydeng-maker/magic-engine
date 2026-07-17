/**
 * GET /api/cron/social-comment-autoreply
 *
 * Every 30 min — for each client with social_comment_config.enabled=true, pull
 * recent Facebook Page comments and auto-reply (public + optional DM) / hide spam.
 * Runs every 30 min (not daily) so DM private_replies stay inside Meta's 7-day
 * window and replies feel timely.
 *
 * Auth: Bearer ${CRON_SECRET}
 * Global kill switch: SOCIAL_COMMENT_AUTOREPLY_KILL=1
 *
 * Reference: ROADMAP.md P20.D (social pillar / DAPE Execution)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  processClientComments,
  isKilled,
  CommentConfig,
  ClientRunResult,
} from '@/lib/social/comment-autoreply-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('social-comment-autoreply')

  if (isKilled()) {
    await cronRun.finish({ processed: 0, summary: { killed: true } })
    return NextResponse.json({ success: true, killed: true, message: 'Kill switch active — no replies sent' })
  }

  const { data, error } = await supabaseAdmin
    .from('social_comment_config')
    .select('client_id, fb_page_id, auto_reply_praise, auto_reply_question, auto_reply_complaint, auto_hide_spam, private_reply_enabled, lookback_days, max_replies_per_run, pinned_post_ids')
    .eq('enabled', true)

  if (error) {
    await cronRun.finish({ failed: 1, error: error.message })
    return NextResponse.json({ error: `Failed to load configs: ${error.message}` }, { status: 500 })
  }

  const configs = (data ?? []) as CommentConfig[]
  if (configs.length === 0) {
    await cronRun.finish({ processed: 0 })
    return NextResponse.json({ success: true, clients_processed: 0, message: 'No clients enabled', results: [] })
  }

  const results: ClientRunResult[] = []
  for (const config of configs) {
    results.push(await processClientComments(config))
  }

  const failed = results.filter(r => !r.ok).length
  const publicReplies = results.reduce((s, r) => s + (r.public_replies ?? 0), 0)
  const privateReplies = results.reduce((s, r) => s + (r.private_replies ?? 0), 0)
  const hidden = results.reduce((s, r) => s + (r.hidden ?? 0), 0)

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { public_replies: publicReplies, private_replies: privateReplies, hidden, results },
  })

  return NextResponse.json({
    success: true,
    clients_processed: results.length,
    public_replies: publicReplies,
    private_replies: privateReplies,
    hidden,
    failed,
    results,
  })
}
