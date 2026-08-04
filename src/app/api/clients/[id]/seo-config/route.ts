/**
 * SEO automation config — single write entry for clients.seo_config (22.E.S16).
 *
 * GET   → returns the persisted config ({ weekly_blog: boolean }).
 * PATCH → merges known keys into clients.seo_config.
 *
 * SEMANTICS (22.E.S15): weekly_blog doubles as the FOCUS-CLIENT MASTER
 * SWITCH for the whole SEO watchdog line — it gates the blog-weekly cron
 * AND the site-audit-weekly recrawl (which feeds the patrol's R2 link
 * signals). Turning it off for a client silences all of it. Split into
 * separate keys only when a client genuinely needs one without the other.
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

interface SeoConfig {
  weekly_blog: boolean
}

interface PatchBody {
  weekly_blog?: unknown
}

function parseConfig(raw: unknown): SeoConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>
  return { weekly_blog: cfg['weekly_blog'] === true }
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

  if (typeof body.weekly_blog !== 'boolean') {
    return NextResponse.json(
      { error: 'weekly_blog must be a boolean' },
      { status: 400 },
    )
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
    weekly_blog: body.weekly_blog,
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
