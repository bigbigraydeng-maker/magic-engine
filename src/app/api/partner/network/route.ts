/**
 * GET /api/partner/network → the signed-in distributor's unit-system page.
 * Same portal cookie as /api/partner/me. Read-only. Does not calculate a payout
 * and does not write. Until the MU tables are applied, amounts are zero.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { resolveSession, sessionTokenFrom } from '@/lib/distributor/portal-auth'
import { loadNetworkShell } from '@/lib/distributor/mn/portal'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const distributorId = await resolveSession(sessionTokenFrom(req))
    if (!distributorId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const view = await loadNetworkShell(distributorId, getPublicOrigin(req))
    return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('[partner-network] failed:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
