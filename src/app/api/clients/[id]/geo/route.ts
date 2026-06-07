import { unstable_noStore as noStore } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

// Must never be cached — the GEO Composer re-reads this immediately after a
// save; a cached response would re-populate the editor with stale (pre-save)
// directive content, making edits appear to revert.
export const dynamic = 'force-dynamic'

/**
 * GET /api/clients/[id]/geo
 *
 * Returns all GEO directives for a client, ordered newest first.
 * Includes active, draft, and archived.
 *
 * Reference: ROADMAP.md P7.2.6, ARCHITECTURE.md §11.4
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  // Explicitly opt out of Next.js Data Cache — force a live Supabase read
  // so the editor always reflects the latest saved directive.
  noStore()

  try {
    const clientId = params.id

    const { data, error } = await supabaseAdmin
      .from('geo_directives')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    const directives = (data ?? []) as GeoDirective[]
    const active = directives.find(d => d.status === 'active') ?? null

    return NextResponse.json(
      { success: true, directives, active, count: directives.length },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
