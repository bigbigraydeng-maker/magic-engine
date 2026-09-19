/**
 * SEO automation config — single write entry for clients.seo_config (22.E.S16).
 *
 * GET   → returns the persisted config.
 * PATCH → merges known keys into clients.seo_config (any subset of them).
 *
 * SEMANTICS (22.E.S15): weekly_blog doubles as the FOCUS-CLIENT MASTER
 * SWITCH for the whole SEO watchdog line — it gates the blog-weekly cron
 * AND the site-audit-weekly recrawl (which feeds the patrol's R2 link
 * signals). Turning it off for a client silences all of it. Split into
 * separate keys only when a client genuinely needs one without the other.
 *
 * meta_cycle_enabled is the separate master switch for SEO Meta-Cycle v1
 * (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md) — spec §6 requires the
 * repo-narrow-lane path, MAX_PAGES_PER_RUN, COOLDOWN_DAYS and the brand-voice
 * prompt sentence to be client configuration, not hardcoded in shared code;
 * meta_cycle_max_pages / meta_cycle_cooldown_days / meta_cycle_brand_voice
 * are the L4 overrides for those (all optional — the roster loader falls
 * back to platform defaults when unset).
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

interface SeoConfig {
  weekly_blog: boolean
  /** SEO Meta-Cycle v1 (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md) master switch — L4 override, no code change to enable a new client. */
  meta_cycle_enabled: boolean
  meta_cycle_max_pages: number | null
  meta_cycle_cooldown_days: number | null
  meta_cycle_brand_voice: string | null
}

interface PatchBody {
  weekly_blog?: unknown
  meta_cycle_enabled?: unknown
  meta_cycle_max_pages?: unknown
  meta_cycle_cooldown_days?: unknown
  meta_cycle_brand_voice?: unknown
}

function parseConfig(raw: unknown): SeoConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>
  return {
    weekly_blog: cfg['weekly_blog'] === true,
    meta_cycle_enabled: cfg['meta_cycle_enabled'] === true,
    meta_cycle_max_pages: typeof cfg['meta_cycle_max_pages'] === 'number' ? cfg['meta_cycle_max_pages'] : null,
    meta_cycle_cooldown_days: typeof cfg['meta_cycle_cooldown_days'] === 'number' ? cfg['meta_cycle_cooldown_days'] : null,
    meta_cycle_brand_voice: typeof cfg['meta_cycle_brand_voice'] === 'string' ? cfg['meta_cycle_brand_voice'] : null,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('seo_config')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({ config: parseConfig((data as { seo_config: unknown }).seo_config) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.weekly_blog !== undefined && typeof body.weekly_blog !== 'boolean') {
    return NextResponse.json({ error: 'weekly_blog must be a boolean' }, { status: 400 })
  }
  if (body.meta_cycle_enabled !== undefined && typeof body.meta_cycle_enabled !== 'boolean') {
    return NextResponse.json({ error: 'meta_cycle_enabled must be a boolean' }, { status: 400 })
  }
  if (body.meta_cycle_max_pages !== undefined && (typeof body.meta_cycle_max_pages !== 'number' || body.meta_cycle_max_pages <= 0)) {
    return NextResponse.json({ error: 'meta_cycle_max_pages must be a positive number' }, { status: 400 })
  }
  if (body.meta_cycle_cooldown_days !== undefined && (typeof body.meta_cycle_cooldown_days !== 'number' || body.meta_cycle_cooldown_days <= 0)) {
    return NextResponse.json({ error: 'meta_cycle_cooldown_days must be a positive number' }, { status: 400 })
  }
  if (body.meta_cycle_brand_voice !== undefined && typeof body.meta_cycle_brand_voice !== 'string') {
    return NextResponse.json({ error: 'meta_cycle_brand_voice must be a string' }, { status: 400 })
  }
  if (
    body.weekly_blog === undefined &&
    body.meta_cycle_enabled === undefined &&
    body.meta_cycle_max_pages === undefined &&
    body.meta_cycle_cooldown_days === undefined &&
    body.meta_cycle_brand_voice === undefined
  ) {
    return NextResponse.json({ error: 'no known seo_config keys in body' }, { status: 400 })
  }

  // Read-merge-write so future seo_config keys survive this PATCH.
  const { data: current, error: readErr } = await supabaseAdmin
    .from('clients')
    .select('seo_config')
    .eq('id', clientId)
    .single()

  if (readErr || !current) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const merged = {
    ...((current as { seo_config: unknown }).seo_config as Record<string, unknown> ?? {}),
    ...(body.weekly_blog !== undefined ? { weekly_blog: body.weekly_blog } : {}),
    ...(body.meta_cycle_enabled !== undefined ? { meta_cycle_enabled: body.meta_cycle_enabled } : {}),
    ...(body.meta_cycle_max_pages !== undefined ? { meta_cycle_max_pages: body.meta_cycle_max_pages } : {}),
    ...(body.meta_cycle_cooldown_days !== undefined ? { meta_cycle_cooldown_days: body.meta_cycle_cooldown_days } : {}),
    ...(body.meta_cycle_brand_voice !== undefined ? { meta_cycle_brand_voice: body.meta_cycle_brand_voice } : {}),
  }

  const { error: writeErr } = await supabaseAdmin
    .from('clients')
    .update({ seo_config: merged })
    .eq('id', clientId)

  if (writeErr) {
    return NextResponse.json({ error: writeErr.message }, { status: 500 })
  }

  return NextResponse.json({ config: parseConfig(merged) })
}
