/**
 * Brand geo anchors — single write entry for clients.brand_geo_anchors.
 *
 * GET   → returns the persisted FDE list.
 * PATCH → replaces it. All inputs normalised before persistence.
 *
 * Consumed by `src/lib/ai-tracker/client-brand-match.ts >
 * admissibleClientIdentifiers`: when the list is non-empty, evidence that
 * comes ONLY from a brand alias requires one of these words to appear in the
 * AI answer, so a same-named sibling abroad ("China Travel Service
 * (Australia) Pty Ltd") cannot claim a NZ-only client. The official brand
 * name and clients.domain are never gated.
 *
 * Mirrors src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const MAX_ANCHORS   = 20
const MIN_ANCHOR_LEN = 2

interface PatchBody {
  anchors?: unknown
}

/** lowercase + collapse internal whitespace + trim. Inner spaces kept. */
function normaliseAnchor(raw: string): string {
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
    .select('brand_geo_anchors')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = (data as { brand_geo_anchors: unknown }).brand_geo_anchors
  const anchors = Array.isArray(raw)
    ? raw.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : []

  return NextResponse.json({ anchors })
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

  if (!Array.isArray(body.anchors)) {
    return NextResponse.json(
      { error: 'Body must include `anchors: string[]`' },
      { status: 400 },
    )
  }

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.anchors) {
    if (typeof raw !== 'string') continue
    const norm = normaliseAnchor(raw)
    if (norm.length < MIN_ANCHOR_LEN) continue
    if (seen.has(norm)) continue
    if (cleaned.length >= MAX_ANCHORS) break
    seen.add(norm)
    cleaned.push(norm)
  }

  // Persist NULL when empty so the matcher reads it as "rule disabled"
  // (migration comment: NULL or empty array leaves matching unchanged).
  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ brand_geo_anchors: cleaned.length === 0 ? null : cleaned })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update brand_geo_anchors: ${updateErr.message}` },
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
    anchors: cleaned,
    count:   cleaned.length,
  })
}
