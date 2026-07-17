/**
 * Social comment auto-reply config — per-client settings.
 *
 * GET   → current config (or safe defaults with enabled=false if none exists).
 * PATCH → upsert config (enable flag, fb_page_id, per-category toggles, limits).
 *
 * Backs the Settings UI so FDE/PM never touch Supabase directly (CLAUDE.md
 * FDE-config-must-have-UI rule).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

interface ConfigBody {
  enabled?: unknown
  fb_page_id?: unknown
  auto_reply_praise?: unknown
  auto_reply_question?: unknown
  auto_reply_complaint?: unknown
  auto_hide_spam?: unknown
  private_reply_enabled?: unknown
  lookback_days?: unknown
  max_replies_per_run?: unknown
}

const DEFAULTS = {
  enabled: false,
  fb_page_id: '',
  auto_reply_praise: true,
  auto_reply_question: true,
  auto_reply_complaint: true,
  auto_hide_spam: false,
  private_reply_enabled: true,
  lookback_days: 7,
  max_replies_per_run: 20,
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data } = await supabaseAdmin
    .from('social_comment_config')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()

  return NextResponse.json({ config: data ?? { client_id: clientId, ...DEFAULTS } })
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.round(v) : NaN
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: ConfigBody
  try {
    body = (await req.json()) as ConfigBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const fbPageId = typeof body.fb_page_id === 'string' ? body.fb_page_id.trim() : ''
  const enabled = bool(body.enabled, false)

  // Enabling with no page id is a foot-gun — the cron would silently no-op.
  if (enabled && !fbPageId) {
    return NextResponse.json(
      { error: 'fb_page_id is required to enable auto-reply' },
      { status: 400 },
    )
  }

  const row = {
    client_id: clientId,
    enabled,
    fb_page_id: fbPageId,
    auto_reply_praise: bool(body.auto_reply_praise, DEFAULTS.auto_reply_praise),
    auto_reply_question: bool(body.auto_reply_question, DEFAULTS.auto_reply_question),
    auto_reply_complaint: bool(body.auto_reply_complaint, DEFAULTS.auto_reply_complaint),
    auto_hide_spam: bool(body.auto_hide_spam, DEFAULTS.auto_hide_spam),
    private_reply_enabled: bool(body.private_reply_enabled, DEFAULTS.private_reply_enabled),
    lookback_days: clampInt(body.lookback_days, 1, 30, DEFAULTS.lookback_days),
    max_replies_per_run: clampInt(body.max_replies_per_run, 1, 100, DEFAULTS.max_replies_per_run),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabaseAdmin
    .from('social_comment_config')
    .upsert(row, { onConflict: 'client_id' })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: `Failed to save config: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, config: data })
}
