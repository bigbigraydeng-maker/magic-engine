import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { resolveSelfServeLanding } from '@/lib/auth/self-serve-routing'

const CUSTOMER_ACCESS_TYPES = new Set(['self_serve', 'portal', 'both', 'dashboard', 'client'])

export type PhoneLinkAccess = 'allowed' | 'denied' | 'unavailable'
export type PhoneOtpAccess = PhoneLinkAccess | 'none'

/** Only existing customer identities may bind or use a phone to enter their workspace. */
export async function phoneLinkAccessForEmail(emailValue: string | null | undefined): Promise<PhoneLinkAccess> {
  const email = emailValue?.trim().toLowerCase()
  if (!email) return 'denied'

  const permissions = getUserPermissions(email)
  if (permissions?.role === 'admin') return 'denied'

  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('access_type, scoped_admin')
    .eq('email', email)

  if (error) return 'unavailable'

  const rows = (data ?? []) as Array<{ access_type?: unknown; scoped_admin?: unknown }>
  if (rows.some(row => row.scoped_admin === true)) return 'denied'
  if (rows.some(row => typeof row.access_type === 'string' && CUSTOMER_ACCESS_TYPES.has(row.access_type))) {
    return 'allowed'
  }

  // Preserve existing CLIENT_VIEWERS environment-based access without allowing
  // global or scoped administrators to self-enrol a phone identity.
  return permissions?.role === 'client-viewer' ? 'allowed' : 'denied'
}

export async function phoneLinkAccessForUser(user: User): Promise<PhoneLinkAccess> {
  return phoneLinkAccessForEmail(user.email)
}

/** Resolve Auth-hook SMS eligibility by stable Auth ID, with legacy email fallback. */
export async function phoneOtpAccessForIdentity(userId: string, emailValue?: string | null): Promise<PhoneOtpAccess> {
  const email = emailValue?.trim().toLowerCase()
  if (email && getUserPermissions(email)?.role === 'admin') return 'denied'

  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('access_type, scoped_admin')
    .eq('auth_user_id', userId)

  if (error) return 'unavailable'
  const rows = (data ?? []) as Array<{ access_type?: unknown; scoped_admin?: unknown }>
  if (rows.some(row => row.scoped_admin === true)) return 'denied'
  if (rows.some(row => typeof row.access_type === 'string' && CUSTOMER_ACCESS_TYPES.has(row.access_type))) {
    return 'allowed'
  }
  if (rows.length > 0) return 'denied'

  if (email) {
    const legacyAccess = await phoneLinkAccessForEmail(email)
    if (legacyAccess !== 'denied') return legacyAccess
    if (getUserPermissions(email)?.role === 'client-viewer') return 'allowed'
    // Distinguish a known but ineligible email identity from an unlinked new user.
    const { data: emailRows, error: emailError } = await supabaseAdmin
      .from('client_portal_users')
      .select('id')
      .eq('email', email)
    if (emailError) return 'unavailable'
    return (emailRows ?? []).length ? 'denied' : 'none'
  }

  return 'none'
}

/** Resolve the same customer's workspace without granting signup benefits. */
export async function phoneLinkWorkspaceForEmail(emailValue: string | null | undefined): Promise<string | null> {
  const email = emailValue?.trim().toLowerCase()
  if (!email) return null

  const permissions = getUserPermissions(email)
  if (permissions?.role === 'admin') return null

  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id, access_type, scoped_admin')
    .eq('email', email)

  if (error) return null

  const rows = (data ?? []) as Array<{
    client_id?: unknown
    access_type?: unknown
    scoped_admin?: unknown
  }>
  if (rows.some(row => row.scoped_admin === true)) return null

  const selfServe = rows.find(row => row.access_type === 'self_serve' && typeof row.client_id === 'string')
  const selfServeClientId = selfServe?.client_id
  if (typeof selfServeClientId === 'string') {
    return resolveSelfServeLanding(selfServeClientId, '/dashboard')
  }

  const portal = rows.find(row =>
    (row.access_type === 'portal' || row.access_type === 'both') && typeof row.client_id === 'string'
  )
  if (portal?.client_id) return `/portal/${portal.client_id}`

  const dashboard = rows.find(row =>
    ['dashboard', 'fde', 'client'].includes(String(row.access_type)) && typeof row.client_id === 'string'
  )
  if (dashboard?.client_id) return `/dashboard/clients/${dashboard.client_id}`

  if (permissions?.role === 'client-viewer' && permissions.allowedClientId) {
    return `/dashboard/clients/${permissions.allowedClientId}`
  }

  return null
}
