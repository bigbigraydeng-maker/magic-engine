/**
 * Prospecting pipeline batch operations — the stages the auto-sweep cron
 * advances (Phase 35). Each is a bounded, self-contained step reusing the same
 * libs the manual admin routes use (audit / score / analyze / report /
 * outreach) so cron-driven and console-driven runs behave identically.
 *
 * NOTE: the manual /api/admin/prospecting/* routes still carry their own copy
 * of this orchestration. Consolidating both onto these functions is follow-up
 * cleanup — kept separate here to avoid refactoring the tested money-path
 * routes in the same change.
 *
 * Sending is intentionally NOT here: every outreach email is human-approved in
 * the review queue.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { CITY_COORDS, type BusinessListing } from '@/lib/dataforseo/business-listings'
import { discoverBusinessesViaPlaces } from '@/lib/places/business-discovery'
import { runProspectAudit, type ProspectAudit } from './audit'
import { calculateProspectScore, type ScoreSignal } from './score'
import { analyzeProspect, type ProspectAnalysis } from './analyze'
import { buildLeakReport } from './report'
import { generateOutreachEmail } from './outreach'

const MAX_ATTEMPTS = 2

// ─── Queue introspection (drives the cron's stage choice) ─────────────────────

async function countDiscoveredOrQualified(status: 'discovered' | 'qualified'): Promise<number> {
  const { count } = await supabaseAdmin
    .from('outbound_prospects').select('id', { count: 'exact', head: true }).eq('status', status)
  return count ?? 0
}

/**
 * Draftable = analyzed, analysis succeeded (no `error`), AND not already
 * parked as un-draftable (no `draft_error`). Excluding draft_error is what
 * keeps a poison-pill row from making pickStage return 'draft' forever and
 * starving discovery.
 */
async function countDraftable(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('outbound_prospects').select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed').is('ai_report->error', null).is('ai_report->draft_error', null)
  return count ?? 0
}

export async function queueCounts(): Promise<{ discovered: number; qualified: number; draftable: number }> {
  const [discovered, qualified, draftable] = await Promise.all([
    countDiscoveredOrQualified('discovered'),
    countDiscoveredOrQualified('qualified'),
    countDraftable(),
  ])
  return { discovered, qualified, draftable }
}

/** Row count per "industry|city" so the cron can discover the least-covered seed. */
export async function coverageByCombo(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin.from('outbound_prospects').select('industry, city')
  const cov: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{ industry: string; city: string }>) {
    cov[`${r.industry}|${r.city}`] = (cov[`${r.industry}|${r.city}`] ?? 0) + 1
  }
  return cov
}

// ─── Stage: audit (discovered → qualified / audited) ──────────────────────────

export async function auditBatch(limit: number): Promise<{ audited: number; qualified: number }> {
  const { data: batch } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, website_url, domain, phone, rating, review_count, raw_listing')
    .eq('status', 'discovered')
    .order('created_at', { ascending: true })
    .limit(limit)
  if (!batch || batch.length === 0) return { audited: 0, qualified: 0 }

  let qualified = 0
  for (const p of batch) {
    const websiteRef = (p.website_url ?? p.domain ?? '').trim()
    const hasWebsite = websiteRef.length > 0
    const audit = hasWebsite ? await runProspectAudit(websiteRef).catch(() => null) : null
    const isClaimed = (p.raw_listing as { is_claimed?: boolean } | null)?.is_claimed === true
    const { score, qualified: ok, breakdown } = calculateProspectScore({
      rating: p.rating, review_count: p.review_count, has_phone: Boolean(p.phone),
      is_claimed: isClaimed, has_website: hasWebsite,
      https_ok: audit ? audit.https_ok : null, tracking: audit?.tracking ?? null, onpage: audit?.onpage ?? null,
    })
    if (ok) qualified++
    await supabaseAdmin.from('outbound_prospects').update({
      audit, prospect_score: score, score_breakdown: breakdown,
      ...(audit?.tracking?.emails[0] ? { email: audit.tracking.emails[0] } : {}),
      ...(audit?.tracking?.facebook_url ? { facebook_url: audit.tracking.facebook_url } : {}),
      ...(audit?.tracking?.instagram_url ? { instagram_url: audit.tracking.instagram_url } : {}),
      status: ok ? 'qualified' : 'audited', audited_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', p.id).eq('status', 'discovered')
  }
  return { audited: batch.length, qualified }
}

// ─── Stage: analyze (qualified → analyzed) ────────────────────────────────────

type StoredReport = (ProspectAnalysis & { attempts?: number }) | null

export async function analyzeBatch(limit: number): Promise<{ analyzed: number; retrying: number }> {
  const { data: batch } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, business_name, industry, city, country, website_url, domain, facebook_url, instagram_url, rating, review_count, score_breakdown, ai_report, updated_at')
    .eq('status', 'qualified')
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (!batch || batch.length === 0) return { analyzed: 0, retrying: 0 }

  let analyzed = 0, retrying = 0
  for (const p of batch) {
    const { data: claimed } = await supabaseAdmin
      .from('outbound_prospects').update({ updated_at: new Date().toISOString() })
      .eq('id', p.id).eq('status', 'qualified').eq('updated_at', p.updated_at).select('id')
    if (!claimed || claimed.length === 0) continue

    const analysis = await analyzeProspect({
      business_name: p.business_name, industry: p.industry, city: p.city, country: p.country,
      website_url: p.website_url, domain: p.domain, facebook_url: p.facebook_url, instagram_url: p.instagram_url,
      rating: p.rating, review_count: p.review_count, score_breakdown: (p.score_breakdown ?? null) as ScoreSignal[] | null,
    })
    const attempts = ((p.ai_report as StoredReport)?.attempts ?? 0) + 1
    const nextStatus = analysis.error && attempts < MAX_ATTEMPTS ? 'qualified' : 'analyzed'
    nextStatus === 'qualified' ? retrying++ : analyzed++
    const { error: upErr } = await supabaseAdmin.from('outbound_prospects')
      .update({ ai_report: { ...analysis, attempts }, status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', p.id).eq('status', 'qualified')
    // The analysis is already paid for; a lost write would let the next fire
    // re-analyze (re-spend). Surface it so the cron logs a failure instead.
    if (upErr) throw new Error(`analyze update failed for ${p.id}: ${upErr.message}`)
  }
  return { analyzed, retrying }
}

// ─── Stage: draft (analyzed → outreach_ready) ─────────────────────────────────

export async function draftBatch(limit: number): Promise<{ drafted: number; failed: number }> {
  const { data: batch } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, business_name, industry, city, country, domain, website_url, rating, review_count, ai_report, audit, score_breakdown, updated_at')
    .eq('status', 'analyzed').is('ai_report->error', null).is('ai_report->draft_error', null)
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (!batch || batch.length === 0) return { drafted: 0, failed: 0 }

  let drafted = 0, failed = 0
  for (const p of batch) {
    const report = p.ai_report as (ProspectAnalysis & { draft_attempts?: number }) | null
    if (!report || report.error) continue
    const { data: claimed } = await supabaseAdmin
      .from('outbound_prospects').update({ updated_at: new Date().toISOString() })
      .eq('id', p.id).eq('status', 'analyzed').eq('updated_at', p.updated_at).select('id')
    if (!claimed || claimed.length === 0) continue

    // has_website must agree with the audit-side definition (website_url ?? domain):
    // domain can be null for an unparseable URL that still has a website, and
    // claiming "you have no website" on the report would be a false statement.
    const hasWebsite = Boolean(p.website_url || p.domain)
    const audit = p.audit as ProspectAudit | null
    const leak_report = buildLeakReport({
      business_name: p.business_name, industry: p.industry, city: p.city, country: p.country,
      has_website: hasWebsite, rating: p.rating, review_count: p.review_count,
      https_ok: audit?.https_ok ?? null, tracking: audit?.tracking ?? null,
      breakdown: (p.score_breakdown as ScoreSignal[] | null) ?? null, analysis: report,
    })
    try {
      const email = await generateOutreachEmail({
        business_name: p.business_name, industry: p.industry, city: p.city, country: p.country,
        domain: p.domain, rating: p.rating, review_count: p.review_count, ai_report: report, leak_report,
      })
      await supabaseAdmin.from('outbound_prospects')
        .update({ outreach_email: email, status: 'outreach_ready', updated_at: new Date().toISOString() })
        .eq('id', p.id).eq('status', 'analyzed')
      drafted++
    } catch (err) {
      // Retry cap: a persistently un-draftable row must not re-spend every fire
      // nor block discovery forever. After MAX_ATTEMPTS, park it with a
      // draft_error so countDraftable() and draftBatch's filter skip it.
      const draftAttempts = (report.draft_attempts ?? 0) + 1
      const parked = draftAttempts >= MAX_ATTEMPTS
      const patch: Record<string, unknown> = parked
        ? { ...report, draft_attempts: draftAttempts, draft_error: err instanceof Error ? err.message : String(err) }
        : { ...report, draft_attempts: draftAttempts }
      await supabaseAdmin.from('outbound_prospects')
        .update({ ai_report: patch, updated_at: new Date().toISOString() })
        .eq('id', p.id).eq('status', 'analyzed')
      failed++
    }
  }
  return { drafted, failed }
}

// ─── Stage: discover (pull a seed → discovered) ───────────────────────────────

function dedupe(listings: BusinessListing[]): BusinessListing[] {
  const seenPlace = new Set<string>(), seenDomain = new Set<string>(), out: BusinessListing[] = []
  for (const l of listings) {
    if (!l.place_id && !l.domain) continue
    if (l.place_id && seenPlace.has(l.place_id)) continue
    if (l.domain && seenDomain.has(l.domain)) continue
    if (l.place_id) seenPlace.add(l.place_id)
    if (l.domain) seenDomain.add(l.domain)
    out.push(l)
  }
  return out
}

export async function discoverAndInsert(params: {
  industry: string; city: string; limit: number
}): Promise<{ discovered: number; inserted: number }> {
  const loc = CITY_COORDS[params.city]
  if (!loc) throw new Error(`Unknown city seed: ${params.city}`)
  const listings = await discoverBusinessesViaPlaces({
    industry: params.industry, city: params.city, coord: loc.coord, country: loc.country, limit: params.limit,
  })
  const unique = dedupe(listings)
  if (unique.length === 0) return { discovered: listings.length, inserted: 0 }

  const placeIds = unique.map(l => l.place_id).filter((v): v is string => Boolean(v))
  const domains = unique.map(l => l.domain).filter((v): v is string => Boolean(v))
  const [byPlace, byDomain] = await Promise.all([
    placeIds.length ? supabaseAdmin.from('outbound_prospects').select('place_id').in('place_id', placeIds) : Promise.resolve({ data: [] }),
    domains.length ? supabaseAdmin.from('outbound_prospects').select('domain').in('domain', domains) : Promise.resolve({ data: [] }),
  ])
  const knownPlace = new Set((byPlace.data ?? []).map(r => (r as { place_id: string }).place_id))
  const knownDomain = new Set((byDomain.data ?? []).map(r => (r as { domain: string }).domain))
  const fresh = unique.filter(l => !(l.place_id && knownPlace.has(l.place_id)) && !(l.domain && knownDomain.has(l.domain)))
  if (fresh.length === 0) return { discovered: listings.length, inserted: 0 }

  const rows = fresh.map(l => ({
    business_name: l.name, industry: params.industry, city: params.city, country: loc.country,
    domain: l.domain, website_url: l.website_url, phone: l.phone, place_id: l.place_id,
    rating: l.rating, review_count: l.review_count, raw_listing: l.raw, status: 'discovered',
  }))
  const { error } = await supabaseAdmin.from('outbound_prospects').insert(rows)
  if (error) throw new Error(error.message)
  return { discovered: listings.length, inserted: rows.length }
}
