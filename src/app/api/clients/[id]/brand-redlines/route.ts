/**
 * Brand redline phrases — single write entry for clients.brand_redline_phrases.
 *
 * GET   → returns the persisted redline phrase list.
 * PATCH → replaces the list. Trim + collapse whitespace + case-insensitive
 *         dedupe; original casing preserved (PM readability — matching in
 *         strategist gate1 is already case-insensitive via normalizeAngle).
 *
 * Consumed by the P21.J content factory strategist (闸 1 副闸): any signal
 * text surface or angle candidate containing a redline phrase is rejected
 * with `brand_redline_hit` before a work order is created. Seeded for CTS
 * by migration 20260711000002 ("Auckland since 1928" family).
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const MAX_PHRASES   = 50
const MIN_PHRASE_LEN = 3 // shorter fragments over-match (containsPhrase is substring-based)

interface PatchBody {
  phrases?: unknown
}

/** Collapse internal whitespace + trim; casing preserved for PM readability. */
function normalisePhrase(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
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
    .select('brand_redline_phrases')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { brand_redline_phrases: unknown }).brand_redline_phrases
  const phrases = Array.isArray(raw)
    ? raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : []

  return NextResponse.json({ phrases })
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

  if (!Array.isArray(body.phrases)) {
    return NextResponse.json(
      { error: 'Body must include `phrases: string[]`' },
      { status: 400 },
    )
  }

  // Normalise + drop too-short + case-insensitive dedupe + cap
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.phrases) {
    if (typeof raw !== 'string') continue
    const norm = normalisePhrase(raw)
    if (norm.length < MIN_PHRASE_LEN) continue
    const key = norm.toLowerCase()
    if (seen.has(key)) continue
    if (cleaned.length >= MAX_PHRASES) break
    seen.add(key)
    cleaned.push(norm)
  }

  // Column is NOT NULL DEFAULT '{}' — empty list persists as [], never null
  // (strategist fail-closed only rejects when the clients row itself is missing).
  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ brand_redline_phrases: cleaned })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update brand_redline_phrases: ${updateErr.message}` },
      { status: 500 },
    )
  }

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({
    success: true,
    phrases: cleaned,
    count:   cleaned.length,
  })
}
