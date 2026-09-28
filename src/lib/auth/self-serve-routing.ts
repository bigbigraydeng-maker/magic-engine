import { supabaseAdmin } from '@/lib/supabase'
import { recordToolLead } from '@/lib/tools-lab/lead-events'

const DASHBOARD_ROOT = '/dashboard'
const PROSPECT_ROOT = '/prospect'
const PORTAL_ROOT = '/portal'
/** Public, identity-free entry to the Facebook ad check-up (Tools Lab). Always resolves to the caller's own client. */
export const ADS_CHECK_ENTRY = '/meta-ads-ai/mine'

function adsCheckPath(clientId: string): string {
  return `/meta-ads-ai/${clientId}`
}

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

  // Ad check-up page of this same client (exact match only; any other client id falls through to home).
  // The Tools Lab entry never carries a client id: it is rewritten to the caller's own client.
  if (requestedPath === ADS_CHECK_ENTRY || requestedPath === adsCheckPath(clientId)) return adsCheckPath(clientId)

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

/**
 * PR6（docs/specs/2026-08-11-onboarding-integrations-unify-v1.md）：正式激活
 * 开关——新自助客户第一次登录，从这里落地，不再是旧的单页 /brief 表单。
 */
function buildOnboardingPath(clientId: string, nextPath: string, welcome: boolean): string {
  const params = new URLSearchParams()
  const clientHome = clientHomePath(clientId)

  if (nextPath !== clientHome) {
    params.set('next', nextPath)
  }

  if (welcome) {
    params.set('welcome', '1')
  }

  const query = params.toString()
  return `/dashboard/clients/${clientId}/onboarding${query ? `?${query}` : ''}`
}

export async function resolveSelfServeLanding(
  clientId: string,
  requestedPath: string,
  welcome = false,
): Promise<string> {
  const nextPath = normalizeSelfServeTarget(clientId, requestedPath)
  // Someone who came for the ad check-up goes straight to it: the check-up needs nothing from the onboarding
  // wizard, and the wizard in front of it lost most of these sign-ups (Tools Lab step 1 design §1.4).
  if (nextPath === adsCheckPath(clientId)) {
    // A Tools Lab lead is a first verified sign-in through the entry (`welcome` = the welcome grant was just made),
    // not a returning customer re-entering the check-up.
    if (welcome && requestedPath === ADS_CHECK_ENTRY) {
      await recordToolLead({ tool: 'ads-check', pagePath: ADS_CHECK_ENTRY, targetHref: ADS_CHECK_ENTRY, dedupeKey: { client_id: clientId } })
    }
    return nextPath
  }
  const { data } = await supabaseAdmin
    .from('clients')
    .select('onboarding_completed_at')
    .eq('id', clientId)
    .maybeSingle()

  // 门禁看向导自己的完成标记（onboarding_completed_at），不是 Step 1 的
  // brief_completed_at——只填完 Step 1 但没走完整个向导的客户，应该被继续
  // 送回向导续填，不能因为 Step 1 填过就当成"已经 onboard 完"放行。
  if (!data?.onboarding_completed_at) {
    return buildOnboardingPath(clientId, nextPath, welcome)
  }

  if (welcome && nextPath === clientHomePath(clientId)) {
    return `${nextPath}?welcome=1`
  }

  return nextPath
}
