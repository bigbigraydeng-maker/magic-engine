/**
 * GET /api/partner/me → the signed-in distributor's own portal view (read-only).
 * Auth is the portal session cookie only — never a ME / Supabase login. 401 without a live session.
 */
import { NextResponse } from 'next/server'
import { resolveSession, sessionTokenFrom } from '@/lib/distributor/portal-auth'
import { buildPortalView } from '@/lib/distributor/portal-view'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const distributorId = await resolveSession(sessionTokenFrom(req))
    if (!distributorId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    return NextResponse.json(await buildPortalView(distributorId), { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('[partner-portal] me failed:', err)
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  }
}
