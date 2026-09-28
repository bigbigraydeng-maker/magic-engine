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
import { buildState, buildAuthUrl } from '@/lib/meta-oauth/client'
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

  // `intent=publishing` marks the "Reauthorize Meta Publishing" action, and
  // `intent=comment_reply` the comment-autoreply reconnect action, so the
  // callback can fail closed / target the right Page. Any other value is
  // ignored — the flow itself, scopes and guards are identical.
  const rawIntent = req.nextUrl.searchParams.get('intent')
  const intent = rawIntent === 'publishing' ? 'publishing' : rawIntent === 'comment_reply' ? 'comment_reply' : undefined

  // Publishing reauth authorises the Facebook Reel adapter's target Page
  // (factory_config.publish_target), NOT the inbox Page. Resolve it server-side
  // from the verified client and fail closed BEFORE starting Meta consent if
  // there is no valid Facebook publish target — starting would be a misleading
  // authorisation that stores a token for the wrong (or no) Page. The callback
  // re-reads the same config, so a config change after this point still fails
  // closed there.
  if (intent === 'publishing') {
    const { data } = await supabaseAdmin
      .from('clients')
      .select('factory_config')
      .eq('id', clientId)
      .maybeSingle()
    const target = projectFactoryConfig((data as { factory_config?: unknown } | null)?.factory_config).publish_target
    if (!target || target.platform !== 'facebook' || !target.page_id) {
      return backToPanel(clientId, 'no_publish_target')
    }
  }

  // Comment-reply reauth authorises the comment-autoreply engine's configured
  // Page (social_comment_config.fb_page_id), which is not always the same Page
  // as clients.facebook_page_id (Codex round 8 复审 P1) — same fail-closed
  // shape as publishing above, for the same reason: starting consent with
  // nothing to target would store a token for the wrong (or no) Page.
  if (intent === 'comment_reply') {
    const { data } = await supabaseAdmin
      .from('social_comment_config')
      .select('fb_page_id')
      .eq('client_id', clientId)
      .maybeSingle()
    const pageId = (data as { fb_page_id?: string | null } | null)?.fb_page_id
    if (!pageId) return backToPanel(clientId, 'no_comment_page')
  }

  let authUrl: string
  try {
    const redirectUri = `${appUrl()}/api/auth/facebook/callback`
    // Publishing / comment-reply reauth use auth_type=rerequest so a
    // previously declined scope is actually shown again (Meta hides it
    // otherwise) — the ordinary inbox connect never needs this.
    authUrl = buildAuthUrl(buildState(clientId, intent), redirectUri, intent !== undefined)
  } catch (err) {
    // Missing app credentials — say which knob is missing rather than 500ing.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    )
  }

  return NextResponse.redirect(authUrl)
}
