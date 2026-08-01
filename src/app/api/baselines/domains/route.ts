import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { INDUSTRY_DICTIONARY } from '@/lib/huatuo/industry-mapper'

// `industry` is the aggregation key the baseline cron writes straight into
// industry_benchmarks.industry_category. Anything outside INDUSTRY_DICTIONARY
// produces benchmarks that no reader ever looks up — which is exactly how
// flooring_tiles / real_estate / logistics_3pl drifted (see migration
// 20260728000002). Reject it here rather than discovering it months later.
const VALID_INDUSTRIES = new Set(INDUSTRY_DICTIONARY.map(e => e.category))

// GET /api/baselines/domains?sub_industry=inbound_tour_operator
// Returns all domains for a sub-industry (or all if no filter)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const subIndustry = searchParams.get('sub_industry')

  let query = supabaseAdmin
    .from('baseline_domains')
    .select('*')
    .order('sub_industry')
    .order('seo_score', { ascending: false, nullsFirst: false })

  if (subIndustry) query = query.eq('sub_industry', subIndustry)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/baselines/domains — add a new domain
export async function POST(req: Request) {
  const body = await req.json() as {
    industry: string
    sub_industry: string
    domain: string
    keywords?: string[]
    is_client?: boolean
    notes?: string
  }

  if (!body.industry || !body.sub_industry || !body.domain) {
    return NextResponse.json({ error: 'industry, sub_industry, domain are required' }, { status: 400 })
  }

  if (!VALID_INDUSTRIES.has(body.industry)) {
    return NextResponse.json(
      {
        error: `Unknown industry "${body.industry}". Must be one of: ${[...VALID_INDUSTRIES].sort().join(', ')}`,
      },
      { status: 400 },
    )
  }

  // Normalise domain
  const domain = body.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')

  const { data, error } = await supabaseAdmin
    .from('baseline_domains')
    .insert({
      industry: body.industry,
      sub_industry: body.sub_industry,
      domain,
      keywords: body.keywords ?? [],
      is_client: body.is_client ?? false,
      notes: body.notes ?? null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `${domain} already exists in ${body.sub_industry}` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
