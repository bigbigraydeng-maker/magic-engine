import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resolveRedirectForSession } from '@/lib/auth/resolve-redirect'
import { ADS_CHECK_ENTRY } from '@/lib/auth/self-serve-routing'
import { clientPortalMembershipsForUser } from '@/lib/auth/client-portal-membership'

export const dynamic = 'force-dynamic'

const REGISTER = `/portal/register?next=${encodeURIComponent(ADS_CHECK_ENTRY)}`

/**
 * Tools Lab entry to the Facebook ad check-up: one public link for everyone.
 * Identity comes only from the signed-in session, never from the URL.
 *  - not signed in → the Chinese sign-up / sign-in page (it sends a login code to an existing verified email);
 *  - self-serve member → their own check-up page (shared landing logic, which also records the lead once);
 *  - staff / paying clients → their usual landing;
 *  - signed in with no workspace at all → sign-up, which creates the self-serve workspace for this email.
 * Never returns this same path, so it cannot loop.
 */
export default async function AdsCheckEntry() {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(REGISTER)

  const landing = await resolveRedirectForSession(supabase, ADS_CHECK_ENTRY)
  if (landing !== ADS_CHECK_ENTRY) redirect(landing)

  const { rows } = await clientPortalMembershipsForUser(user)
  redirect(rows.length > 0 ? '/dashboard' : REGISTER)
}
