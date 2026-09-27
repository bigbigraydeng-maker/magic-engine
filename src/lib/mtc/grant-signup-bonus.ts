import { supabaseAdmin } from '@/lib/supabase'

/**
 * RETIRED (2026-09-02, PM decision — ME 会员分档 v2 redesign): the 500 MTC
 * signup bonus is gone. The new tier design's free tier grants 0 MTC/month,
 * and a signup bonus larger than the $39 tier's monthly allowance undermined
 * the ladder.
 *
 * This function is kept (not deleted) because 5 call sites in the self-serve
 * auth flow (`auth/callback`, `api/auth/self-register`, `api/auth/verify-email`,
 * `api/onboard/self`, `lib/auth/resolve-redirect`) still call it and consume
 * its boolean return value for "show welcome banner" UI branching. It now
 * only stamps the legacy `email_verified_at` field some UI still reads, and
 * always returns false — there is nothing left to grant.
 */
export async function grantSignupBonus(clientId: string): Promise<boolean> {
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('source, email_verified_at')
    .eq('id', clientId)
    .single<{ source: string | null; email_verified_at: string | null }>()

  if (!client || client.source !== 'self_serve') return false

  if (!client.email_verified_at) {
    await supabaseAdmin
      .from('clients')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', clientId)
  }

  return false
}
