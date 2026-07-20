/**
 * POST /api/admin/prospecting/rescan-emails  { limit?: number }
 *
 * Admin-only. Re-runs email discovery (homepage → contact pages) on prospects
 * that have a website but no email — mostly ones audited before the contact-page
 * fallback existed / before CONTACT_PATHS widened (P35.11). Free, SSRF-guarded
 * fetches (no AI, no paid API), so it just needs a batch bound.
 *
 * A found email is written to the `email` column AND merged into
 * `audit.tracking.emails` (the field the send path reads), so an emailless
 * `outreach_ready` card with a ready draft becomes immediately sendable.
 * Junk is already filtered by the tracking detector inside discoverContactEmail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { discoverContactEmail, type ProspectAudit } from '@/lib/prospecting/audit'
import { isJunkContactEmail } from '@/lib/prospecting/tracking-detector'

const DEFAULT_BATCH = 12
const MAX_BATCH = 20
// Each prospect is up to 1 homepage + 8 contact-page fetches, all serial, so
// bound the whole request by wall-clock too — stop cleanly and return what we
// scanned rather than letting the platform gateway time the request out.
const TIME_BUDGET_MS = 60_000

// Statuses where a backfilled email actually unblocks the prospect. outreach_ready
// first (has a draft → instantly sendable), then the funnel stages that gate on
// email downstream.
const SCANNABLE_STATUSES = ['outreach_ready', 'analyzed', 'qualified', 'audited']

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const body  = await req.json().catch(() => null) as { limit?: number } | null
  const limit = Math.min(MAX_BATCH, Math.max(1, body?.limit ?? DEFAULT_BATCH))

  const { data: batch, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, website_url, domain, audit, status')
    .is('email', null)
    .in('status', SCANNABLE_STATUSES)
    .or('website_url.not.is.null,domain.not.is.null')
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let scanned = 0
  let found = 0
  const deadline = Date.now() + TIME_BUDGET_MS

  for (const p of (batch ?? []) as Array<{ id: string; website_url: string | null; domain: string | null; audit: ProspectAudit | null; status: string }>) {
    if (Date.now() > deadline) break   // return what we have; the rest waits for the next click
    scanned++
    const site = p.website_url ?? p.domain
    if (!site) continue

    const emails = await discoverContactEmail(site)
    const email = emails.find(e => !isJunkContactEmail(e))
    if (!email) continue

    // Merge into audit.tracking.emails (the send path reads emails[0]) + the
    // email column (the list/queue filter). Preserve the rest of the audit.
    const audit = p.audit ?? null
    const tracking = audit?.tracking ? { ...audit.tracking, emails } : null
    const nextAudit = audit ? { ...audit, ...(tracking ? { tracking } : {}) } : null

    const { error: upErr } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ email, ...(nextAudit ? { audit: nextAudit } : {}), updated_at: new Date().toISOString() })
      .eq('id', p.id)
      .is('email', null)   // don't clobber an email set meanwhile
    if (!upErr) found++
  }

  const { count: remaining } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id', { count: 'exact', head: true })
    .is('email', null)
    .in('status', SCANNABLE_STATUSES)
    .or('website_url.not.is.null,domain.not.is.null')

  return NextResponse.json({ scanned, found, remaining: remaining ?? 0 })
}
