import { supabaseAdmin } from '@/lib/supabase'
import { normalizeEmail } from '@/lib/auth/email'

const BONUS_MTC_AMOUNT = 500

/**
 * Grants the 500 MTC welcome bonus for a self_serve client on first email verification.
 *
 * Phase X.S3 (H2 fix): idempotency key is now the canonical form of the user's
 * email — Gmail aliases (a+1@gmail.com, a.b@gmail.com, googlemail.com) all
 * collapse to one key, so a single human cannot harvest the bonus across
 * multiple self_serve workspaces by varying their alias.
 *
 * The function is safe to call concurrently / repeatedly:
 *   - The `signup_bonus_grants` row is created with `INSERT ... ON CONFLICT
 *     DO NOTHING` and an atomic re-fetch; if a parallel call already won the
 *     race, this one observes the existing row and returns false.
 *   - `email_verified_at` on the clients row is still stamped (UI compat).
 *
 * Returns true only when this call actually credited the MTC.
 */
export async function grantSignupBonus(clientId: string): Promise<boolean> {
  // ── 1. Load client + look up the user's email via client_portal_users. ────
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('source, email_verified_at')
    .eq('id', clientId)
    .single<{ source: string | null; email_verified_at: string | null }>()

  if (!client || client.source !== 'self_serve') return false

  // Fetch the self_serve user's email. We look up via client_portal_users
  // because clients.contact_email isn't reliably populated on self-register.
  const { data: portalUsers } = await supabaseAdmin
    .from('client_portal_users')
    .select('email')
    .eq('client_id', clientId)
    .eq('access_type', 'self_serve')
    .limit(1)

  const rawEmail = portalUsers?.[0]?.email as string | undefined
  const norm = normalizeEmail(rawEmail)
  if (!norm) {
    // No email on record — refuse to grant. Better to leave the user without
    // the bonus than to grant an un-deduplicatable credit.
    console.warn('[grant-signup-bonus] no portal email for client', clientId)
    return false
  }

  // ── 2. Email-level dedup — Wei Zheng H2 fix. ─────────────────────────────
  // Attempt to claim the canonical email. If a row already exists (same human,
  // different alias), the insert is a no-op and we treat it as "already granted".
  const { data: claimRows, error: claimErr } = await supabaseAdmin
    .from('signup_bonus_grants')
    .insert({
      email_canonical: norm.normalized,
      client_id:       clientId,
      email_lower:     norm.lower,
      mtc_amount:      BONUS_MTC_AMOUNT,
    })
    .select('client_id')

  // PostgREST returns code 23505 (unique_violation) when the row exists.
  // Treat that as "already granted to someone (possibly this very client)".
  if (claimErr) {
    if ((claimErr as { code?: string }).code === '23505') return false
    console.error('[grant-signup-bonus] claim insert failed:', claimErr)
    return false
  }
  if (!claimRows || claimRows.length === 0) return false

  // ── 3. Stamp email_verified_at (legacy field — UI may read it). ──────────
  if (!client.email_verified_at) {
    await supabaseAdmin
      .from('clients')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', clientId)
  }

  // ── 4. Create the bonus_500 mtc_purchases batch. ─────────────────────────
  const purchasedAt = new Date()
  const expiresAt = new Date(purchasedAt)
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  const { data: purchase, error: purchaseErr } = await supabaseAdmin
    .from('mtc_purchases')
    .insert({
      client_id:               clientId,
      stripe_payment_intent_id: null,
      package_key:             'bonus_500',
      amount_nzd:              0,
      mtc_amount:              BONUS_MTC_AMOUNT,
      mtc_remaining:           BONUS_MTC_AMOUNT,
      purchased_at:            purchasedAt.toISOString(),
      expires_at:              expiresAt.toISOString(),
      status:                  'completed',
    })
    .select('id')
    .single<{ id: string }>()

  if (purchaseErr || !purchase) {
    // Rare race: bonus_grants insert succeeded but purchase failed. Roll back
    // the grant claim so a retry can re-attempt — otherwise the user is locked
    // out permanently with no balance.
    await supabaseAdmin
      .from('signup_bonus_grants')
      .delete()
      .eq('email_canonical', norm.normalized)
      .eq('client_id', clientId)
    console.error('[grant-signup-bonus] purchase insert failed; grant rolled back:', purchaseErr)
    return false
  }

  // Stamp the bonus_grants row with the purchase id for forensic joins.
  await supabaseAdmin
    .from('signup_bonus_grants')
    .update({ purchase_id: purchase.id })
    .eq('email_canonical', norm.normalized)

  // ── 5. Ledger credit. ─────────────────────────────────────────────────────
  await supabaseAdmin.from('mtc_ledger').insert({
    client_id:    clientId,
    purchase_id:  purchase.id,
    direction:    'credit',
    service_key:  'bonus_registration',
    mtc_amount:   BONUS_MTC_AMOUNT,
    source:       'bonus',
    notes:        norm.transformed
      ? `Welcome bonus — email verified (canonicalised from ${norm.lower})`
      : 'Welcome bonus — email verified',
  })

  return true
}
