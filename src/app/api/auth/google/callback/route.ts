/**
 * GET /api/auth/google/callback?code=<code>&state=<state>
 *
 * OAuth 2.0 callback handler. Verifies the HMAC state, exchanges the
 * authorization code for tokens, stores them in google_oauth_tokens, and
 * marks the client's GSC connector as 'partial' (OAuth done, site_url pending).
 *
 * The signed state carries a `flow` field that decides where the user lands
 * afterwards:
 *   - 'admin'   → /dashboard/clients/[id]/connectors/gsc  (internal operator)
 *   - 'connect' → /connect/[id]  (public customer-facing page, no login)
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyState,
  exchangeCode,
  fetchGoogleEmail,
  storeTokens,
  type OAuthFlow,
} from '@/lib/google-oauth/client'
import { supabaseAdmin } from '@/lib/supabase'
import { encryptToken } from '@/lib/platform-oauth/vocabulary'
import { listGa4Properties } from '@/lib/ga4/admin'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

type OAuthResult = 'success' | 'error' | 'denied'

function destination(flow: OAuthFlow, clientId: string, oauth: OAuthResult): string {
  if (flow === 'connect') {
    return `${appUrl()}/connect/${clientId}?oauth=${oauth}`
  }
  // 板桥 2026-08-11 复审：向导发起的授权必须落回向导本身，落到 settings 页
  // 会把客户送进一个他看不懂的 FDE 内部后台，onboarding 卡死在这一步。
  if (flow === 'wizard') {
    return `${appUrl()}/dashboard/clients/${clientId}/onboarding?oauth=${oauth}`
  }
  return `${appUrl()}/dashboard/clients/${clientId}/connectors/gsc?oauth=${oauth}`
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const verified = state ? verifyState(state) : null

  // User denied consent
  //
  // 魏征 2026-08-11 复审：原来只给 'connect' 打了"别送去会撞登录墙的 /dashboard"
  // 的补丁，漏了同样是非 FDE 用户的 'wizard'——而"在 Google 同意页点取消"正是
  // 向导 UX 设计里要覆盖的主路径之一（没有账号就跳过/点了取消，不该被撞飞出
  // 向导）。'connect' 和 'wizard' 现在统一走 destination()，只有 'admin'（本来
  // 就是已登录 FDE）和 state 完全解析不出来（没有 clientId 可用）才落回裸
  // /dashboard。
  if (error) {
    if (verified && verified.flow !== 'admin') {
      return NextResponse.redirect(destination(verified.flow, verified.clientId, 'denied'))
    }
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=denied`)
  }

  // Missing code or state — route connect/wizard customers away from the dashboard login wall
  if (!code || !state) {
    if (verified && verified.flow !== 'admin') {
      return NextResponse.redirect(destination(verified.flow, verified.clientId, 'error'))
    }
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=missing_params`)
  }

  // Verify signed state → extract clientId + flow.
  // If state is tampered/expired we cannot trust the flow, so use a public-safe fallback.
  if (!verified) {
    return NextResponse.redirect(`${appUrl()}/?google_auth_error=invalid_link`)
  }
  const { clientId, flow } = verified

  // Re-validate clientId as UUID — defence-in-depth against any future refactor that
  // might allow non-HMAC-sourced clientIds to reach this point.
  if (!UUID_RE.test(clientId)) {
    return NextResponse.redirect(`${appUrl()}/dashboard?google_auth_error=invalid_state`)
  }

  // 狄仁杰 2026-08-11 攻击验证：state 的 HMAC 签名只证明"这条 state 是本服务
  // 签发的"，不证明"签发时的调用者真的有权碰这个 clientId"——/api/auth/google/
  // connect 那一端现在已经堵了 admin/wizard 两条 flow 的入口，这里是第二道闸，
  // 用当前请求的真实会话重新校验一次，跟 gbp/callback 的模式一致（不是只信
  // state 里带的东西）。'connect' flow 是刻意设计成无登录的公网页，不在这道
  // 闸门里——它自己的鉴权模型是另一个独立问题，见 spec §2.1 B1。
  if (flow !== 'connect') {
    const access = await requireDashboardClientAccess(clientId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
  }

  // Exchange authorization code for tokens
  const redirectUri = `${appUrl()}/api/auth/google/callback`
  let tokens
  try {
    tokens = await exchangeCode(code, redirectUri)
  } catch (err) {
    console.error('[google/callback] token exchange failed:', err)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  // Fetch the Google account email for display
  const googleEmail = await fetchGoogleEmail(tokens.access_token)

  // Persist tokens
  try {
    await storeTokens(clientId, tokens, googleEmail)
  } catch (err) {
    console.error('[google/callback] failed to store tokens:', err)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  // Dual-write to platform_oauth_connections (encrypted path) so getValidToken()
  // works for GSC. Keep writing to google_oauth_tokens above for backward compat.
  if (tokens.refresh_token) {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const { error: connErr } = await supabaseAdmin
      .from('platform_oauth_connections')
      .upsert(
        {
          client_id:         clientId,
          provider:          'google_gsc',
          access_token_enc:  encryptToken(tokens.access_token),
          refresh_token_enc: encryptToken(tokens.refresh_token),
          token_expiry:      expiresAt.toISOString(),
          account_id:        googleEmail ?? clientId,
          display_name:      googleEmail ?? 'Google Search Console',
          scopes:            tokens.scope.split(' '),
          status:            'active',
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'client_id,provider,account_id' },
      )
    if (connErr) {
      console.warn('[google/callback] dual-write to platform_oauth_connections failed:', connErr.message)
      // Non-fatal — legacy path still works
    }
  }

  // Update GSC connector — preserve site_url and existing 'connected' status.
  // Only set 'partial' when no site_url is recorded yet.
  const now = new Date().toISOString()
  const { data: existing } = await supabaseAdmin
    .from('client_connectors')
    .select('status, config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .maybeSingle<{ status: string; config: Record<string, unknown> | null }>()

  const hasSiteUrl = Boolean(existing?.config?.site_url)
  const newStatus  = existing?.status === 'connected' || hasSiteUrl ? 'connected' : 'partial'
  const newConfig  = { ...(existing?.config ?? {}), google_email: googleEmail }

  await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id:    clientId,
        anchor:       'gsc',
        status:       newStatus,
        config:       newConfig,
        connected_at: now,
        updated_at:   now,
      },
      { onConflict: 'client_id,anchor' },
    )

  // GA4 — resolve which property (if any) this Google account can see, and
  // auto-connect it. Zero properties is a normal "customer doesn't have GA4
  // yet" state, not an error — only a genuine API failure gets logged loudly
  // (spec §2.6: "真的没有" vs "接口报错" must not be conflated). Multiple
  // properties: take the first (same MVP simplification GBP already uses for
  // its account picker) — settings page lets someone change it later via
  // /api/clients/[id]/ga4-properties.
  if (tokens.refresh_token) {
    const ga4Result = await listGa4Properties(tokens.access_token)
    if (!ga4Result.ok) {
      console.error('[google/callback] GA4 property list failed — leaving GA4 unconnected for this round')
    } else if (ga4Result.properties.length > 0) {
      const chosen    = ga4Result.properties[0]
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
      const { error: ga4Err } = await supabaseAdmin
        .from('platform_oauth_connections')
        .upsert(
          {
            client_id:         clientId,
            provider:          'google_ga4',
            access_token_enc:  encryptToken(tokens.access_token),
            refresh_token_enc: encryptToken(tokens.refresh_token),
            token_expiry:      expiresAt.toISOString(),
            account_id:        chosen.property,
            display_name:      chosen.displayName,
            scopes:            tokens.scope.split(' '),
            status:            'active',
            updated_at:        new Date().toISOString(),
          },
          { onConflict: 'client_id,provider,account_id' },
        )
      if (ga4Err) {
        console.warn('[google/callback] GA4 connection write failed:', ga4Err.message)
      } else {
        // 向导 Step 3 和每日同步 cron 判定"已连接"读的是这张表，不是
        // platform_oauth_connections——漏了这一步 GA4 数据永远不会真的被拉取，
        // 界面却显示绿勾（2026-08-11 复审发现，见 spec §2.2）。
        await supabaseAdmin
          .from('client_connectors')
          .upsert(
            {
              client_id:    clientId,
              anchor:       'ga4',
              status:       'connected',
              config:       { google_email: googleEmail, property_id: chosen.property },
              connected_at: now,
              updated_at:   now,
            },
            { onConflict: 'client_id,anchor' },
          )
      }
    }
    // properties.length === 0 → customer genuinely has no GA4 account yet,
    // not an error — nothing to write, matches the wizard's skip-and-move-on path.
  }

  // Redirect back to where the flow started
  return NextResponse.redirect(destination(flow, clientId, 'success'))
}
