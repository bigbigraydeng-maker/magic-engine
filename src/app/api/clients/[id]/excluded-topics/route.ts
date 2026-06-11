/**
 * Excluded topics — FDE-managed list of product categories the client does NOT sell.
 *
 * GET   → reads master_briefs.excluded_topics for the active brief.
 * PATCH → writes master_briefs.excluded_topics on the active brief.
 *
 * Consumed by /api/clients/[id]/seo-intelligence/competitors-gap to filter
 * out irrelevant gap keywords (e.g. Oztop sells flooring but not shutters/blinds).
 *
 * Mirrors brand-aliases/route.ts pattern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const MAX_TOPICS = 30

interface PatchBody {
  topics?: unknown
}

function normaliseTopic(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim()
}

async function getActiveBriefId(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('master_briefs')
    .select('id')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .single()
  return data?.id ?? null
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
    .from('master_briefs')
    .select('excluded_topics')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Failed to load brief' }, { status: 500 })
  }

  const raw = (data as { excluded_topics: unknown } | null)?.excluded_topics
  const topics = Array.isArray(raw)
    ? raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : []

  return NextResponse.json({ topics })
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

  if (!Array.isArray(body.topics)) {
    return NextResponse.json(
      { error: 'Body must include `topics: string[]`' },
      { status: 400 },
    )
  }

  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.topics) {
    if (typeof raw !== 'string') continue
    const norm = normaliseTopic(raw)
    if (norm.length < 4) continue
    if (seen.has(norm)) continue
    if (cleaned.length >= MAX_TOPICS) break
    seen.add(norm)
    cleaned.push(norm)
  }

  const briefId = await getActiveBriefId(clientId)
  if (!briefId) {
    return NextResponse.json(
      { error: 'No active Brand Brief found — create one first' },
      { status: 404 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('master_briefs')
    .update({ excluded_topics: cleaned.length === 0 ? null : cleaned })
    .eq('id', briefId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update excluded_topics: ${updateErr.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    topics:  cleaned,
    count:   cleaned.length,
  })
}
