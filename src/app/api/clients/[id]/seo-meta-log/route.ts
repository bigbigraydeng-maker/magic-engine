/**
 * GET /api/clients/[id]/seo-meta-log
 *
 * Returns the SEO meta optimisation history for a client.
 * Populated by the oztop-seo-optimizer cron loop.
 *
 * Query params:
 *   ?limit=N   (default 50)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '50'), 200)

  const { data, error } = await supabaseAdmin
    .from('seo_meta_log')
    .select('id, page_slug, page_url, keyword, old_title, old_desc, new_title, new_desc, wp_updated, optimised_at')
    .eq('client_id', clientId)
    .order('optimised_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, logs: data ?? [] })
}
