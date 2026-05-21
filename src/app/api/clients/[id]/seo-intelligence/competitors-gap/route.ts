import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import { getSerpCompetitors, getKeywordsGap, type LabsCompetitor, type LabsKeyword } from '@/lib/dataforseo/labs'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

/**
 * GET /api/clients/[id]/seo-intelligence/competitors-gap
 *
 * Returns top competitors + keyword gap (untapped keywords where competitors
 * rank but the client does not), both derived from DataForSEO in one request.
 *
 * Response shape:
 * {
 *   domain:      string
 *   competitors: LabsCompetitor[]   // top 5, ordered by intersections desc
 *   gapKeywords: LabsKeyword[]      // up to 100 untapped keywords
 * }
 *
 * Cache: 24 h (two expensive DataForSEO live calls).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const { id: clientId } = await params

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.domain) {
    return NextResponse.json(
      { error: 'Client has no domain configured' },
      { status: 400 },
    )
  }

  const locationCode = LOCATION_CODE_BY_DB[client.semrush_db ?? 'au'] ?? LOCATION_CODE_BY_DB.au

  try {
    // Step 1: discover top competitors
    const competitors: LabsCompetitor[] = await getSerpCompetitors(client.domain, locationCode, 5)

    // Step 2: compute keyword gap using top 3 competitor domains
    const top3 = competitors.slice(0, 3).map(c => c.domain)
    const gapKeywords: LabsKeyword[] = top3.length > 0
      ? await getKeywordsGap(client.domain, top3, locationCode, 100)
      : []

    return NextResponse.json(
      { domain: client.domain, competitors, gapKeywords },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DataForSEO error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
