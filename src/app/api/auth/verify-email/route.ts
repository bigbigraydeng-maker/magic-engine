import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { grantSignupBonus } from '@/lib/mtc/grant-signup-bonus'
import { requireSession } from '@/lib/auth/require-session'

// POST /api/auth/verify-email
// Called after Supabase confirms the user's email (from confirmation link callback).
// Grants 500 MTC bonus if not already granted.
// Requires: authenticated session whose email matches the client's portal user.
// Body: { clientId }
export async function POST(request: NextRequest) {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const { clientId } = body ?? {}

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  // Verify the authenticated user's email belongs to this client — prevents
  // one portal user from triggering the bonus for a different client's account.
  const callerEmail = (session.user.email ?? '').toLowerCase().trim()
  const { data: portalUser } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('client_id', clientId)
    .eq('email', callerEmail)
    .maybeSingle()

  if (!portalUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, source, email_verified_at')
    .eq('id', clientId)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (client.source !== 'self_serve') {
    return NextResponse.json({ error: 'Not a self-serve account' }, { status: 403 })
  }

  if (client.email_verified_at) {
    return NextResponse.json({ ok: true, alreadyVerified: true, bonusGranted: false })
  }

  const bonusGranted = await grantSignupBonus(clientId)
  return NextResponse.json({ ok: true, bonusGranted, mtcBalance: bonusGranted ? 500 : 0 })
}
