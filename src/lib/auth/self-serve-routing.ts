import { supabaseAdmin } from '@/lib/supabase'

const DASHBOARD_ROOT = '/dashboard'
const PROSPECT_ROOT = '/prospect'
const PORTAL_ROOT = '/portal'

function clientHomePath(clientId: string): string {
  return `/dashboard/clients/${clientId}`
}

/**
 * Forces a self-serve user's landing path to stay inside their own client.
 *
 * P0-J PR-2 fix (魏征 CRITICAL #4): previously the function blind-returned
 * `requestedPath` whenever it wasn't a /portal/ alias or a known root. A
 * self_serve user could log in with `?next=/dashboard/clients/{other-id}/execution`
 * and the function would happily echo that back — middleware was the only
 * second-line defence. Now we actively rewrite any `/dashboard/clients/{id}/...`
 * path to use the caller's own clientId, and reject anything outside the
 * `/dashboard/clients/...`, `/dashboard`, `/prospect`, `/portal` whitelist.
 */
export function normalizeSelfServeTarget(clientId: string, requestedPath: string): string {
  const clientHome = clientHomePath(clientId)

  if (!requestedPath || requestedPath === DASHBOARD_ROOT || requestedPath === PROSPECT_ROOT || requestedPath === PORTAL_ROOT) {
    return clientHome
  }

  // /portal/{x}/... — strip the prefix and remap onto our own dashboard home.
  if (requestedPath.startsWith('/portal/')) {
    const suffix = requestedPath.replace(/^\/portal\/[^/]+/, '')
    return `${clientHome}${suffix || ''}`
  }

  // /dashboard/clients/{whatever}/... — force the clientId segment to the
  // self-serve user's own client. This is the path-traversal close.
  if (requestedPath.startsWith('/dashboard/clients/')) {
    const segments = requestedPath.split('/')
    // segments: ['', 'dashboard', 'clients', '{id}', ...rest]
    segments[3] = clientId
    return segments.join('/')
  }

  // Anything else inside /dashboard but not /dashboard/clients — kick back
  // to the client home (prevents access to /dashboard/admin/users etc.).
  if (requestedPath.startsWith('/dashboard/')) {
    return clientHome
  }

  // Off-app or unknown root — refuse and fall back to client home.
  return clientHome
}

function buildBriefPath(clientId: string, nextPath: string, welcome: boolean): string {
  const params = new URLSearchParams()
  const clientHome = clientHomePath(clientId)

  if (nextPath !== clientHome) {
    params.set('next', nextPath)
  }

  if (welcome) {
    params.set('welcome', '1')
  }

  const query = params.toString()
  return `/dashboard/clients/${clientId}/brief${query ? `?${query}` : ''}`
}

export async function resolveSelfServeLanding(
  clientId: string,
  requestedPath: string,
  welcome = false,
): Promise<string> {
  const nextPath = normalizeSelfServeTarget(clientId, requestedPath)
  const { data } = await supabaseAdmin
    .from('clients')
    .select('brief_completed_at')
    .eq('id', clientId)
    .maybeSingle()

  if (!data?.brief_completed_at) {
    return buildBriefPath(clientId, nextPath, welcome)
  }

  if (welcome && nextPath === clientHomePath(clientId)) {
    return `${nextPath}?welcome=1`
  }

  return nextPath
}
