import { NextRequest, NextResponse } from 'next/server'
import { getWeakSpotOpportunities } from '@/lib/blog/topic-selector'
import { clampLimit } from '@/lib/validation-utils'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/blog/opportunities
 *
 * Returns AI Tracker weak spots sorted by weakness score.
 * These are the recommended blog topics for GEO-mode generation.
 *
 * Query params:
 *   limit?   - max results (default 20, max 100)
 *
 * Security: Requires Bearer token. Error messages do not expose internals.
 *
 * Reference: ROADMAP.md P7.3.3
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    // HIGH-1: clamp limit to prevent unbounded queries
    const limit = clampLimit(req.nextUrl.searchParams.get('limit'))

    const opportunities = await getWeakSpotOpportunities(clientId, limit)

    return NextResponse.json({ success: true, opportunities })
  } catch (err: unknown) {
    // HIGH-3: log details server-side, return generic message to caller
    console.error('[opportunities GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'Failed to retrieve opportunities' }, { status: 500 })
  }
}
