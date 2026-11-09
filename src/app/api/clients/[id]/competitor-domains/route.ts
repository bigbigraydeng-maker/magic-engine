/**
 * Competitor domains — single write entry.
 *
 * GET   → returns the persisted FDE list (clients.competitor_domains only,
 *         NOT merged with brief / auto — those are read via resolver elsewhere).
 * PATCH → replaces the FDE list. All inputs normalised before persistence.
 *
 * On PATCH success, downstream cache layers are invalidated so SEO Intelligence,
 * AI Tracker, GEO Composer, etc. see the new list on next read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { saveMetadata } from '@/lib/web-intelligence/targets'
import { normaliseDomain } from '@/lib/competitors/resolver'

const MAX_DOMAINS = 20

interface PatchBody {
  domains?: unknown
  monitoring?: unknown
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
    .select('competitor_domains')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const raw = data.competitor_domains
  const domains = Array.isArray(raw)
    ? raw.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : []

  return NextResponse.json({ domains })
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

  if (body.monitoring !== undefined) {
    if (access.role !== 'admin') return NextResponse.json({ error: 'Administrator required' }, { status: 403 })
    try {
      await saveMetadata(clientId, body.monitoring)
      return NextResponse.json({ success: true })
    } catch {
      return NextResponse.json({ error: 'Monitoring metadata not saved. Use an existing competitor and valid settings.' }, { status: 400 })
    }
  }

  if (!Array.isArray(body.domains)) {
    return NextResponse.json(
      { error: 'Body must include `domains: string[]`' },
      { status: 400 },
    )
  }

  // Normalise + dedupe + cap
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of body.domains) {
    if (typeof raw !== 'string') continue
    const norm = normaliseDomain(raw)
    if (!norm) continue
    if (seen.has(norm)) continue
    if (cleaned.length >= MAX_DOMAINS) break
    seen.add(norm)
    cleaned.push(norm)
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update({ competitor_domains: cleaned.length === 0 ? null : cleaned })
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update competitor_domains: ${updateErr.message}` },
      { status: 500 },
    )
  }

  // Invalidate downstream caches that depend on competitor_domains.
  // These match the routes in the resolver's consumer list.
  try {
    revalidatePath(`/api/clients/${clientId}/seo-intelligence/competitors-gap`)
    revalidatePath(`/dashboard/clients/${clientId}/seo-intelligence`)
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
    revalidateTag(`client-competitors-${clientId}`)
  } catch {
    // revalidate is best-effort during dev / non-Next runtime; ignore
  }

  return NextResponse.json({
    success: true,
    domains: cleaned,
    count: cleaned.length,
  })
}
