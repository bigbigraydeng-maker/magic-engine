/**
 * POST /api/admin/prospecting/audit
 *
 * Admin-only. Steps 2+3 of the outbound pipeline: run the zero-AI audit
 * (homepage fetch + OnPage instant) and the rule-based opportunity score
 * over a batch of `discovered` prospects.
 *
 * Body: { limit?: number }  — batch size, default 5, max 10 (each audit
 * takes up to ~20s; keep batches small and call repeatedly).
 *
 * Status transitions: discovered → qualified (score >= threshold, has site)
 *                     discovered → audited   (below threshold / no site)
 * Cost: ~$0.003 per prospect (OnPage instant). No AI calls.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { runProspectAudit } from '@/lib/prospecting/audit'
import { calculateProspectScore } from '@/lib/prospecting/score'

const DEFAULT_BATCH = 5
const MAX_BATCH = 10

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const body  = await req.json().catch(() => null) as { limit?: number } | null
  const limit = Math.min(MAX_BATCH, Math.max(1, body?.limit ?? DEFAULT_BATCH))

  const { data: batch, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, business_name, website_url, domain, phone, rating, review_count, raw_listing')
    .eq('status', 'discovered')
    .order('review_count', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!batch || batch.length === 0) {
    return NextResponse.json({ audited: 0, qualified: 0, remaining: 0 })
  }

  let qualifiedCount = 0

  for (const prospect of batch) {
    const websiteRef = (prospect.website_url ?? prospect.domain ?? '').trim()
    const hasWebsite = websiteRef.length > 0
    // runProspectAudit is designed never to throw, but a single poison row
    // must not wedge the batch (unaudited rows re-enter every batch), so
    // guard anyway and let the row transition to `audited` regardless.
    const audit = hasWebsite
      ? await runProspectAudit(websiteRef).catch(() => null)
      : null

    const isClaimed = (prospect.raw_listing as { is_claimed?: boolean } | null)?.is_claimed === true
    const { score, qualified, breakdown } = calculateProspectScore({
      rating:       prospect.rating,
      review_count: prospect.review_count,
      has_phone:    Boolean(prospect.phone),
      is_claimed:   isClaimed,
      has_website:  hasWebsite,
      https_ok:     audit ? audit.https_ok : null,
      tracking:     audit?.tracking ?? null,
      onpage:       audit?.onpage ?? null,
    })
    if (qualified) qualifiedCount++

    // Publicly listed contact points found on the site: persist for outreach.
    const email     = audit?.tracking?.emails[0] ?? null
    const facebook  = audit?.tracking?.facebook_url ?? null
    const instagram = audit?.tracking?.instagram_url ?? null

    // `.eq('status', 'discovered')`: if a concurrent audit call already
    // processed this row, leave its result alone instead of double-writing.
    const { error: updateError } = await supabaseAdmin
      .from('outbound_prospects')
      .update({
        audit,
        prospect_score:  score,
        score_breakdown: breakdown,
        ...(email ? { email } : {}),
        ...(facebook ? { facebook_url: facebook } : {}),
        ...(instagram ? { instagram_url: instagram } : {}),
        status:     qualified ? 'qualified' : 'audited',
        audited_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', prospect.id)
      .eq('status', 'discovered')

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message, audited_before_failure: prospect.id },
        { status: 500 },
      )
    }
  }

  const { count } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'discovered')

  return NextResponse.json({
    audited:   batch.length,
    qualified: qualifiedCount,
    remaining: count ?? 0,
  })
}
