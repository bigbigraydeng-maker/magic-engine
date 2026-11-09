/**
 * GET /api/auth/facebook/connect?client_id=<uuid>
 *
 * Starts the Meta consent flow for one client. Builds a signed state token
 * (HMAC-SHA256, 10-min TTL) carrying the client id, then redirects to Meta.
 *
 * On success Meta redirects to /api/auth/facebook/callback with code + state.
 *
 * Replaces the manual step this used to require: generating a token by hand and
 * adding META_SYSTEM_USER_TOKEN_PAGE_<id> to Render for every new client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { buildState, buildAuthUrl, META_STATE_COOKIE, META_STATE_PATH, META_STATE_TTL_SECS } from '@/lib/meta-oauth/client'
import { projectFactoryConfig } from '@/lib/factory/client-config'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

/** Send the operator back to the settings-drawer panel with a non-secret result,
 *  used when publishing reauth must not even start (no valid publish target). */
function backToPanel(clientId: string, outcome: string): NextResponse {
  const query = new URLSearchParams({ settings: 'platform', meta: outcome })
  return NextResponse.redirect(`${appUrl()}/dashboard/clients/${clientId}?${query.toString()}`)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  // Anyone who can reach this URL could otherwise start a consent flow that
  // attaches their Meta account to a client they have no business touching.
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // `intent=publishing` marks the "Reauthorize Meta Publishing" action so the
  // callback can fail closed with a publishing-specific message. Any other
  // value is ignored — the flow itself, scopes and guards are identical.
  const intent = req.nextUrl.searchParams.get('intent') === 'publishing' ? 'publishing' : undefined

  // rerequest=1 用于评论回复等「某项权限被拒过」的重新授权入口，流程、权限清单、回调完全不变，只是让 Meta 再展示一次被拒过的权限。
  const rerequest = intent === 'publishing' || req.nextUrl.searchParams.get('rerequest') === '1'

  // Publishing reauth authorises the Facebook Reel adapter's target Page
  // (factory_config.publish_target), NOT the inbox Page. Resolve it server-side
  // from the verified client and fail closed BEFORE starting Meta consent if
  // there is no valid Facebook publish target — starting would be a misleading
  // authorisation that stores a token for the wrong (or no) Page. Sign the
  // original target as well as re-reading it on callback to detect changes.
  const { data, error } = await supabaseAdmin
      .from('clients')
      .select('facebook_page_id, factory_config')
      .eq('id', clientId)
      .maybeSingle()
  if (error || !data) return backToPanel(clientId, 'verify_failed')
  let targetPageId: string | null = data.facebook_page_id ?? null
  if (intent === 'publishing') {
    const target = projectFactoryConfig((data as { factory_config?: unknown } | null)?.factory_config).publish_target
    if (!target || target.platform !== 'facebook' || !target.page_id) {
      return backToPanel(clientId, 'no_publish_target')
    }
    targetPageId = target.page_id
  }

  let authUrl: string
  let state: string
  try {
    const redirectUri = `${appUrl()}/api/auth/facebook/callback`
    // Publishing reauth and explicit rerequest=1 both use auth_type=rerequest so
    // a previously declined permission (e.g. pages_manage_posts) is actually
    // shown again (Meta hides it otherwise).
    state = buildState({ clientId, userId: access.user.id, targetPageId, ...(intent ? { intent } : {}) })
    authUrl = buildAuthUrl(state, redirectUri, rerequest)
  } catch {
    return NextResponse.json(
      { error: 'Meta connection is not configured' },
      { status: 503 },
    )
  }

  const response = NextResponse.redirect(authUrl)
  response.cookies.set(META_STATE_COOKIE, state, {
    httpOnly: true, secure: new URL(appUrl()).protocol === 'https:',
    sameSite: 'lax', path: META_STATE_PATH, maxAge: META_STATE_TTL_SECS,
  })
  return response
}
