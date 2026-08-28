/**
 * SEO automation config — single write entry for clients.seo_config (22.E.S16).
 *
 * GET   → returns the persisted config ({ weekly_blog, repo_meta_executor }).
 * PATCH → merges known keys into clients.seo_config.
 *
 * SEMANTICS (22.E.S15): weekly_blog doubles as the FOCUS-CLIENT MASTER
 * SWITCH for the whole SEO watchdog line — it gates the blog-weekly cron
 * AND the site-audit-weekly recrawl (which feeds the patrol's R2 link
 * signals). Turning it off for a client silences all of it. Split into
 * separate keys only when a client genuinely needs one without the other.
 *
 * repo_meta_executor (客户数据红线 #1121) gates a DIFFERENT cron
 * (repo-meta-executor) for clients whose site lives in a code repo rather
 * than WordPress — see src/lib/seo-meta/repo-meta-executor.ts. Missing or
 * incomplete config means that cron skips the client (fail-closed), it
 * never falls back to a guessed default.
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { loadRepoMetaExecutorConfig, type RepoMetaExecutorConfig } from '@/lib/seo-meta/repo-meta-executor'

interface SeoConfig {
  weekly_blog: boolean
  repo_meta_executor: RepoMetaExecutorConfig | null
}

interface PatchBody {
  weekly_blog?: unknown
  repo_meta_executor?: unknown
}

function parseConfig(raw: unknown): SeoConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>
  return {
    weekly_blog: cfg['weekly_blog'] === true,
    repo_meta_executor: loadRepoMetaExecutorConfig(cfg),
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

  const hasWeeklyBlog = 'weekly_blog' in body
  const hasRepoMetaExecutor = 'repo_meta_executor' in body

  if (!hasWeeklyBlog && !hasRepoMetaExecutor) {
    return NextResponse.json(
      { error: 'weekly_blog or repo_meta_executor is required' },
      { status: 400 },
    )
  }
  if (hasWeeklyBlog && typeof body.weekly_blog !== 'boolean') {
    return NextResponse.json(
      { error: 'weekly_blog must be a boolean' },
      { status: 400 },
    )
  }
  if (hasRepoMetaExecutor && (typeof body.repo_meta_executor !== 'object' || body.repo_meta_executor === null)) {
    return NextResponse.json({ error: 'repo_meta_executor must be an object' }, { status: 400 })
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

  const currentSeoConfig = (current as { seo_config: unknown }).seo_config as Record<string, unknown> ?? {}

  // Validated the same way the cron reads it (loadRepoMetaExecutorConfig) —
  // a config that fails this parse would silently never run. Merges onto
  // the already-stored value first so `{ enabled: false }` alone can
  // disable it without having to resend dataDir/brandSuffix/voiceHint
  // (those are kept in storage, just inert while disabled).
  let repoMetaExecutorPatch: Record<string, unknown> | undefined
  if (hasRepoMetaExecutor) {
    const existing = currentSeoConfig['repo_meta_executor']
    const candidate = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      ...(body.repo_meta_executor as Record<string, unknown>),
    }
    if (candidate.enabled !== false) {
      const parsed = loadRepoMetaExecutorConfig({ repo_meta_executor: candidate })
      if (!parsed) {
        return NextResponse.json(
          {
            error:
              'enabling repo_meta_executor requires enabled=true plus dataDir (non-empty string), ' +
              'brandSuffix (string), voiceHint (non-empty string)',
          },
          { status: 400 },
        )
      }
    }
    repoMetaExecutorPatch = candidate
  }

  const merged = {
    ...currentSeoConfig,
    ...(hasWeeklyBlog ? { weekly_blog: body.weekly_blog } : {}),
    ...(repoMetaExecutorPatch ? { repo_meta_executor: repoMetaExecutorPatch } : {}),
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
