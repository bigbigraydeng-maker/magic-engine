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
 * competitor_watch_enabled is the master switch for the weekly competitor
 * snapshot job (src/lib/inngest/functions/competitor-watch-weekly.ts) — off
 * by default for every client; only flip it on for a client PM has approved,
 * since each opted-in client spends DataForSEO calls (one per configured
 * competitor domain) every week.
 *
 * ai_visibility_inngest_enabled is the gate for the Inngest-based rewrite of
 * the weekly AI-visibility (GEO) tracker
 * (src/lib/inngest/functions/ai-visibility-weekly.ts) — off by default for
 * every client. While off, that client keeps running through the old
 * Render-cron path (`ai-tracker-weekly`). The two paths are mutually
 * exclusive by construction — `ai-tracker-weekly/route.ts` explicitly
 * excludes any client with this flag set from its own candidate query, so
 * flipping it on moves a client from one path to the other, never both.
 * Only flip it on for a client after a dry-run/parallel-run comparison
 * confirms the Inngest path produces the same judgment output as the old
 * path, and PM has approved — same rollout discipline as
 * competitor_watch_enabled.
 *
 * brand_terms / brand_ambiguous_terms are the per-client brand-word lists behind the brand / non-brand split of the
 * stored Search Console queries (src/lib/gsc/brand-split.ts, docs/specs/2026-10-13-gsc-query-page-daily-design.md §7).
 * They live here — not in shared code — so a new client never needs a code change. Terms are stored trimmed and de-duplicated (the matcher normalises on read) and a term that normalises to fewer than 2
 * characters is rejected (an empty term would match every query). No Settings input yet: written through this PATCH only.
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { normalizeQueryText } from '@/lib/gsc/brand-split'

interface SeoConfig {
  weekly_blog: boolean
  /** SEO Meta-Cycle v1 (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md) master switch — L4 override, no code change to enable a new client. */
  meta_cycle_enabled: boolean
  meta_cycle_max_pages: number | null
  meta_cycle_cooldown_days: number | null
  meta_cycle_brand_voice: string | null
  competitor_watch_enabled: boolean
  ai_visibility_inngest_enabled: boolean
  brand_terms: string[]
  brand_ambiguous_terms: string[]
}

/** Hard limits so a typo cannot store a novel in a config column. */
const MAX_BRAND_TERMS = 50
const MAX_BRAND_TERM_LENGTH = 60

/** Trimmed, de-duplicated list, or an error message. A term must keep at least 2 characters after normalisation. */
function parseTermList(name: string, raw: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: `${name} must be an array of strings` }
  if (raw.length > MAX_BRAND_TERMS) return { ok: false, error: `${name} can hold at most ${MAX_BRAND_TERMS} terms` }
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') return { ok: false, error: `${name} must be an array of strings` }
    const trimmed = entry.trim()
    if (trimmed.length > MAX_BRAND_TERM_LENGTH) return { ok: false, error: `${name}: a term is longer than ${MAX_BRAND_TERM_LENGTH} characters` }
    if (normalizeQueryText(trimmed).length < 2) return { ok: false, error: `${name}: a term is too short once punctuation is removed` }
    if (!out.includes(trimmed)) out.push(trimmed)
  }
  return { ok: true, value: out }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

interface PatchBody {
  weekly_blog?: unknown
  meta_cycle_enabled?: unknown
  meta_cycle_max_pages?: unknown
  meta_cycle_cooldown_days?: unknown
  meta_cycle_brand_voice?: unknown
  competitor_watch_enabled?: unknown
  ai_visibility_inngest_enabled?: unknown
  brand_terms?: unknown
  brand_ambiguous_terms?: unknown
}

function parseConfig(raw: unknown): SeoConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>
  return {
    weekly_blog: cfg['weekly_blog'] === true,
    meta_cycle_enabled: cfg['meta_cycle_enabled'] === true,
    meta_cycle_max_pages: typeof cfg['meta_cycle_max_pages'] === 'number' ? cfg['meta_cycle_max_pages'] : null,
    meta_cycle_cooldown_days: typeof cfg['meta_cycle_cooldown_days'] === 'number' ? cfg['meta_cycle_cooldown_days'] : null,
    meta_cycle_brand_voice: typeof cfg['meta_cycle_brand_voice'] === 'string' ? cfg['meta_cycle_brand_voice'] : null,
    competitor_watch_enabled: cfg['competitor_watch_enabled'] === true,
    ai_visibility_inngest_enabled: cfg['ai_visibility_inngest_enabled'] === true,
    brand_terms: stringArray(cfg['brand_terms']),
    brand_ambiguous_terms: stringArray(cfg['brand_ambiguous_terms']),
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
  if (body.competitor_watch_enabled !== undefined && typeof body.competitor_watch_enabled !== 'boolean') {
    return NextResponse.json({ error: 'competitor_watch_enabled must be a boolean' }, { status: 400 })
  }
  if (body.ai_visibility_inngest_enabled !== undefined && typeof body.ai_visibility_inngest_enabled !== 'boolean') {
    return NextResponse.json({ error: 'ai_visibility_inngest_enabled must be a boolean' }, { status: 400 })
  }
  let brandTerms: string[] | undefined
  if (body.brand_terms !== undefined) {
    const parsed = parseTermList('brand_terms', body.brand_terms)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    brandTerms = parsed.value
  }
  let ambiguousTerms: string[] | undefined
  if (body.brand_ambiguous_terms !== undefined) {
    const parsed = parseTermList('brand_ambiguous_terms', body.brand_ambiguous_terms)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    ambiguousTerms = parsed.value
  }
  if (
    body.weekly_blog === undefined &&
    body.meta_cycle_enabled === undefined &&
    body.meta_cycle_max_pages === undefined &&
    body.meta_cycle_cooldown_days === undefined &&
    body.meta_cycle_brand_voice === undefined &&
    body.competitor_watch_enabled === undefined &&
    body.ai_visibility_inngest_enabled === undefined &&
    brandTerms === undefined &&
    ambiguousTerms === undefined
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
    ...(body.competitor_watch_enabled !== undefined ? { competitor_watch_enabled: body.competitor_watch_enabled } : {}),
    ...(body.ai_visibility_inngest_enabled !== undefined ? { ai_visibility_inngest_enabled: body.ai_visibility_inngest_enabled } : {}),
    ...(brandTerms !== undefined ? { brand_terms: brandTerms } : {}),
    ...(ambiguousTerms !== undefined ? { brand_ambiguous_terms: ambiguousTerms } : {}),
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
