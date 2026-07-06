/**
 * GET /api/admin/prospecting?status=&industry=&min_score=&page=&limit=&full=1
 *
 * Admin-only. Paginated list of outbound_prospects (Phase 35 pipeline).
 * Excludes heavy jsonb fields (raw_listing / audit / ai_report) unless
 * `full=1` is passed together with a status filter — the review queue needs
 * complete cards (ai_report + outreach_email) in one request. Full mode is
 * capped at 20 rows and also returns the compliance footer + sender
 * identity so the client can render exactly what will be sent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { complianceFooter, senderIdentity } from '@/lib/prospecting/outreach'

const PAGE_SIZE = 30
const VALID_STATUSES = [
  'discovered', 'audited', 'qualified', 'analyzed',
  'outreach_ready', 'contacted', 'replied', 'converted', 'archived', 'opted_out',
]

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const params   = req.nextUrl.searchParams
  const status   = params.get('status') ?? ''
  const industry = params.get('industry') ?? ''
  const minScore = parseInt(params.get('min_score') ?? '', 10)
  const full     = params.get('full') === '1' && status !== ''
  const page     = Math.max(1, parseInt(params.get('page') ?? '1', 10))
  const maxLimit = full ? 20 : 100
  const limit    = Math.min(maxLimit, Math.max(1, parseInt(params.get('limit') ?? String(PAGE_SIZE), 10)))
  const offset   = (page - 1) * limit

  const baseColumns =
    'id, business_name, industry, city, country, domain, phone, email, rating, review_count, prospect_score, status, created_at, audited_at'

  let query = supabaseAdmin
    .from('outbound_prospects')
    .select(
      full ? `${baseColumns}, ai_report, outreach_email` : baseColumns,
      { count: 'exact' },
    )
    .order('prospect_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && VALID_STATUSES.includes(status)) query = query.eq('status', status)
  if (industry) query = query.eq('industry', industry)
  if (!Number.isNaN(minScore)) query = query.gte('prospect_score', minScore)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    prospects: data ?? [],
    total: count ?? 0,
    page,
    limit,
    // Footer is a template — `{{business_name}}` substituted per card so the
    // preview shows exactly what each owner receives.
    ...(full ? { compliance_footer: complianceFooter(), sender_configured: senderIdentity().configured } : {}),
  })
}
