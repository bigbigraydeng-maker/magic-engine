import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { getMtcBalance } from '@/lib/mtc/balance'
import { clientPortalMembershipsForUser } from '@/lib/auth/client-portal-membership'

// GET /api/mtc/balance?clientId=xxx
export async function GET(request: NextRequest) {
  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status })

  const clientId = request.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  // Verify caller owns this client
  const { rows: memberships, error: membershipError } = await clientPortalMembershipsForUser(session.user)
  if (membershipError) return NextResponse.json({ error: 'Authorization check failed' }, { status: 500 })
  const portalUser = memberships.find(row => row.client_id === clientId)

  if (!portalUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await getMtcBalance(clientId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[mtc/balance]', err)
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 })
  }
}
