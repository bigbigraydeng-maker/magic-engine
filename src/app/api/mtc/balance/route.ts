import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { getMtcBalance } from '@/lib/mtc/balance'

// GET /api/mtc/balance?clientId=xxx
export async function GET(request: NextRequest) {
  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status })

  const clientId = request.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  // Verify caller owns this client
  const { data: portalUser } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('email', (session.user.email ?? '').toLowerCase())
    .eq('client_id', clientId)
    .single()

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
