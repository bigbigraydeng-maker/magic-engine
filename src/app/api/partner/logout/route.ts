/** POST /api/partner/logout → revokes the portal session and clears its cookie. Same-origin only. */
import { NextResponse, type NextRequest } from 'next/server'
import { getPublicOrigin } from '@/lib/auth/public-origin'
import { isCrossOrigin } from '@/lib/distributor/admin-http'
import { clearedSessionCookie, revokeSession, sessionTokenFrom } from '@/lib/distributor/portal-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  const token = sessionTokenFrom(req)
  try {
    if (token) await revokeSession(token)
  } catch (err) {
    console.error('[partner-portal] logout revoke failed:', err)
  }
  const response = NextResponse.json({ ok: true })
  response.headers.append('set-cookie', clearedSessionCookie(getPublicOrigin(req).startsWith('https://')))
  return response
}
