/**
 * Brand aliases — single write entry for clients.brand_aliases.
 *
 * GET   → returns the persisted FDE list (clients.brand_aliases only).
 * PATCH → replaces the FDE list. All inputs normalised before persistence.
 *
 * Consumed by `auto-fetch.ts > fetchBrandSearchVolume` to identify
 * brand-tagged GSC queries when computing `brand_search_volume` for
 * Goal current_value. Required for multi-word brands ("CTS Tours" → real
 * GSC queries "cts tours", "china travel service"); the domain root alone
 * (token-equality) misses ~80% of brand searches.
 *
 * Mirrors src/app/api/clients/[id]/primary-keywords/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const MAX_ALIASES   = 20
const MIN_ALIAS_LEN = 2   // matches isBrandQueryMatch defensive lower bound

interface PatchBody {
  aliases?: unknown
}

/**
 * Same normalisation as `normaliseBrandTerm` in auto-fetch.ts:
 *   lowercase + collapse internal whitespace + trim.
 * Inner spaces are preserved ("cts tours" stays two words for substring
 * matching against query "cts tours auckland").
 */
function normaliseAlias(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim()
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
    .select('brand_aliases')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { brand_aliases: unknown }).brand_aliases
  const aliases = Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : []

  return NextResponse.json({ aliases })
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

  if (!Array.isArray(body.aliases)) {
    return NextResponse.json(
      { error: 'Body must include `aliases: string[]`' },
      { status: 400 },
    )
  }

  // Normalise + drop too-short + dedupe + cap
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.aliases) {
    if (typeof raw !== 'string') continue
    const norm = normaliseAlias(raw)
    if (norm.length < MIN_ALIAS_LEN) continue
    if (seen.has(norm)) continue
    if (cleaned.length >= MAX_ALIASES) break
    seen.add(norm)
    cleaned.push(norm)
  }

  // Persist NULL when empty so isBrandQueryMatch treats it as "no aliases"
  // (consistent with the migration comment: NULL falls back to domain-root match).
  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ brand_aliases: cleaned.length === 0 ? null : cleaned })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update brand_aliases: ${updateErr.message}` },
      { status: 500 },
    )
  }

  // The user-facing surface that reads this today is the Settings page
  // (FDE sees the just-saved list on refresh). The Goal detail page
  // doesn't read brand_aliases directly — it reads the resolved
  // current_value via /api/goals/[goalId]/fetch-current-value, which
  // re-runs autoFetchMetricValue on each call (no Next cache to bust).
  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({
    success: true,
    aliases: cleaned,
    count:   cleaned.length,
  })
}
