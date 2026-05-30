import { supabaseAdmin } from '@/lib/supabase'

/** Grants 500 MTC welcome bonus to a self_serve client on first email verification.
 *  Idempotent — checks email_verified_at before acting; safe to call multiple times. */
export async function grantSignupBonus(clientId: string): Promise<boolean> {
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('source, email_verified_at')
    .eq('id', clientId)
    .single()

  if (!client || client.source !== 'self_serve' || client.email_verified_at) {
    return false
  }

  await supabaseAdmin
    .from('clients')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', clientId)

  const purchasedAt = new Date()
  const expiresAt = new Date(purchasedAt)
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  const { data: purchase, error } = await supabaseAdmin
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

  if (error || !purchase) {
    console.error('[grant-signup-bonus] purchase insert failed:', error)
    return false
  }

  await supabaseAdmin.from('mtc_ledger').insert({
    client_id: clientId,
    purchase_id: purchase.id,
    direction: 'credit',
    service_key: 'bonus_registration',
    mtc_amount: 500,
    source: 'bonus',
    notes: 'Welcome bonus — email verified',
  })

  return true
}
