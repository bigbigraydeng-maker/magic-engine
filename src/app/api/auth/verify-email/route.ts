import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// POST /api/auth/verify-email
// Called after Supabase confirms the user's email (from confirmation link callback).
// Grants 100 MTC bonus if not already granted.
// Body: { clientId }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const { clientId } = body ?? {}

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  // Check client exists and is self_serve
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

  // Idempotent: if already verified, skip
  if (client.email_verified_at) {
    return NextResponse.json({ ok: true, alreadyVerified: true, bonusGranted: false })
  }

  // Mark verified
  await supabaseAdmin
    .from('clients')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', clientId)

  // Grant 100 MTC bonus
  const purchasedAt = new Date()
  const expiresAt = new Date(purchasedAt)
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  const { data: purchase, error: purchaseError } = await supabaseAdmin
    .from('mtc_purchases')
    .insert({
      client_id: clientId,
      stripe_payment_intent_id: null,
      package_key: 'bonus_500',
      amount_nzd: 0,
      mtc_amount: 500,
      mtc_remaining: 500,
      purchased_at: purchasedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'completed',
    })
    .select('id')
    .single()

  if (purchaseError || !purchase) {
    console.error('[verify-email] bonus purchase insert failed:', purchaseError)
    return NextResponse.json({ ok: true, bonusGranted: false, error: 'Bonus grant failed' })
  }

  // Write ledger credit entry
  await supabaseAdmin.from('mtc_ledger').insert({
    client_id: clientId,
    purchase_id: purchase.id,
    direction: 'credit',
    service_key: 'bonus_registration',
    mtc_amount: 100,
    source: 'bonus',
    notes: 'Welcome bonus — email verified',
  })

  return NextResponse.json({ ok: true, bonusGranted: true, mtcBalance: 500 })
}
