/**
 * Primary keywords — single write entry.
 *
 * GET   → returns the persisted FDE list (clients.primary_keywords only,
 *         NOT merged with brief — that's the resolver's job).
 * PATCH → replaces the FDE list. All inputs normalised before persistence.
 *
 * On PATCH success, downstream cache layers are invalidated so SEO Intelligence,
 * AI Tracker, GEO Composer, etc. see the new list on next read.
 *
 * Mirrors src/app/api/clients/[id]/competitor-domains/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { normaliseKeyword } from '@/lib/keywords/resolver'

const MAX_KEYWORDS = 20

interface PatchBody {
  keywords?: unknown
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
    .select('primary_keywords')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = data.primary_keywords
  const keywords = Array.isArray(raw)
    ? raw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    : []

  return NextResponse.json({ keywords })
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

  if (!Array.isArray(body.keywords)) {
    return NextResponse.json(
      { error: 'Body must include `keywords: string[]`' },
      { status: 400 },
    )
  }

  // Normalise + dedupe + cap
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.keywords) {
    if (typeof raw !== 'string') continue
    const norm = normaliseKeyword(raw)
    if (!norm) continue
    if (seen.has(norm)) continue
    if (cleaned.length >= MAX_KEYWORDS) break
    seen.add(norm)
    cleaned.push(norm)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ primary_keywords: cleaned.length === 0 ? null : cleaned })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update primary_keywords: ${updateErr.message}` },
      { status: 500 },
    )
  }

  // Invalidate downstream caches that depend on primary_keywords.
  // (Consumers will be migrated to the resolver in a followup; for now we
  // pre-emptively invalidate the same surfaces as competitor_domains so the
  // UX is consistent when the migrations land.)
  try {
    revalidatePath(`/api/clients/${clientId}/seo-intelligence/competitors-gap`)
    revalidatePath(`/dashboard/clients/${clientId}/seo-intelligence`)
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
    revalidateTag(`client-keywords-${clientId}`)
  } catch {
    // revalidate is best-effort during dev / non-Next runtime; ignore
  }

  return NextResponse.json({
    success: true,
    keywords: cleaned,
    count: cleaned.length,
  })
}
