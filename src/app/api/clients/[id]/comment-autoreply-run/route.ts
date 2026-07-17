/**
 * Social comment auto-reply — manual run (on-demand trigger).
 *
 * POST → runs one auto-reply pass for this client immediately, instead of
 * waiting for the 30-min cron. Same code path as the cron (processClientComments),
 * so it respects every toggle + guardrail + the claim-first idempotency lock.
 *
 * Backs the "立即运行一次" button so FDE/PM can test / kick a run on demand.
 * Dashboard-authenticated (same gate as config PATCH); never bypasses the
 * per-client enable/category flags.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { processClientComments, CommentConfig } from '@/lib/social/comment-autoreply-engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data: config, error } = await supabaseAdmin
    .from('social_comment_config')
    .select('client_id, fb_page_id, auto_reply_praise, auto_reply_question, auto_reply_complaint, auto_hide_spam, private_reply_enabled, lookback_days, max_replies_per_run')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!config) {
    return NextResponse.json({ error: '尚未配置 —— 先填 Page ID 并保存' }, { status: 400 })
  }
  if (!(config as { fb_page_id: string }).fb_page_id) {
    return NextResponse.json({ error: '缺少 Facebook 主页 ID' }, { status: 400 })
  }

  const result = await processClientComments(config as CommentConfig)
  return NextResponse.json({ result })
}
