import { supabaseAdmin } from '@/lib/supabase'

export interface ClientPortalMembership {
  id: string
  email: string | null
  auth_user_id: string | null
  client_id: string
  display_name: string
  access_type: string
  scoped_admin: boolean
}

type AuthIdentity = { id?: string; email?: string | null }

/** Resolve workspace membership by stable Auth ID, retaining email fallback for legacy rows. */
export async function clientPortalMembershipsForUser(user: AuthIdentity): Promise<{
  rows: ClientPortalMembership[]
  error: unknown | null
}> {
  let byAuthId: ClientPortalMembership[] = []
  if (user.id) {
    const result = await supabaseAdmin
      .from('client_portal_users')
      .select('id, email, auth_user_id, client_id, display_name, access_type, scoped_admin')
      .eq('auth_user_id', user.id)
    if (result.error) return { rows: [], error: result.error }
    byAuthId = (result.data ?? []) as ClientPortalMembership[]
  }

  const email = user.email?.trim().toLowerCase()
  let byEmail: ClientPortalMembership[] = []
  if (email) {
    const result = await supabaseAdmin
      .from('client_portal_users')
      .select('id, email, auth_user_id, client_id, display_name, access_type, scoped_admin')
      .eq('email', email)
    if (result.error) return { rows: [], error: result.error }
    byEmail = result.data ?? []
  }

  const rowsByClient = new Map<string, ClientPortalMembership>()
  for (const row of [...(byEmail ?? []), ...byAuthId]) {
    const membership = row as ClientPortalMembership
    const previous = rowsByClient.get(membership.client_id)
    if (!previous || (!!user.id && membership.auth_user_id === user.id)) {
      rowsByClient.set(membership.client_id, membership)
    }
  }

  return { rows: [...rowsByClient.values()], error: null }
}
