/**
 * GET /api/auth/google/callback?code=<code>&state=<state>
 *
 * OAuth 2.0 callback handler. Verifies the HMAC state, exchanges the
 * authorization code for tokens, stores them in google_oauth_tokens, and
 * marks the client's GSC connector as 'partial' (OAuth done, site_url pending).
 *
 * The signed state carries a `flow` field that decides where the user lands
 * afterwards:
 *   - 'admin'   → /dashboard/clients/[id]/settings?tab=connect  (internal operator)
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
import { setGa4Property } from '@/lib/ga4/property'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { persistGbpFromTokens, scopeIncludesGbp } from '@/lib/gbp/oauth-persist'

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
  // PR5 2026-08-11 复审：/connectors 页已退役，这里原来落到的死路径靠
  // next.config.js 的重定向兜住不 404，但那只是兜底，不是终点——直接改到
  // 真正的落点，省一次多余的跳转（spec §2.4 明确点名这种"靠重定向兜着不
  // 改真实目标"是反模式）。
  return `${appUrl()}/dashboard/clients/${clientId}/settings?tab=connect&oauth=${oauth}`
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
          // 刚用授权码换到令牌 = 一次货真价实的「跟对方通上话」。不盖这个时间戳的话，
          // 断线监控（platform-oauth/connection-health.ts）在人已经重连好之后还会
          // 继续报，一直报到第二天那条每日取数任务真跑到这个客户为止。
          last_synced_at:    new Date().toISOString(),
          // 状态改回 active 就必须擦掉旧报错，否则一条健康连接永远挂着上次断线的原文，
          // 任何「按报错找坏连接」的排查都会被它骗一次。
          error_message:     null,
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

  // GA4 — persist the OAuth grant before trying to discover properties.
  //
  // OAuth active is deliberately NOT the same thing as GA4 connected. This
  // row only says the Google grant is available; setGa4Property() remains the
  // only path that can mark client_connectors.ga4 as connected after a live
  // Data API read succeeds. Property discovery is an optional convenience and
  // must never decide whether the refresh token survives this callback.
  const { data: priorGa4Credential, error: priorGa4Err } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('refresh_token_enc')
    .eq('client_id', clientId)
    .eq('provider', 'google_ga4')
    .eq('account_id', clientId)
    .maybeSingle<{ refresh_token_enc: string }>()

  if (priorGa4Err) {
    console.error('[google/callback] GA4 credential read failed:', priorGa4Err.message)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  const previousRefreshToken = priorGa4Credential?.refresh_token_enc
  const refreshTokenEnc = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : previousRefreshToken

  if (!refreshTokenEnc) {
    console.error('[google/callback] GA4 credential missing refresh token')
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  // The current product supports one GA4 grant per client. Use the client ID
  // as a stable slot. The replacement must be durable before historical
  // email/property keyed rows are retired, so a failed reauthorization never
  // destroys the previously working grant.
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  const { error: ga4CredentialErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .upsert(
      {
        client_id:         clientId,
        provider:          'google_ga4',
        access_token_enc:  encryptToken(tokens.access_token),
        refresh_token_enc: refreshTokenEnc,
        token_expiry:      expiresAt.toISOString(),
        account_id:        clientId,
        display_name:      googleEmail ?? 'Google Analytics 4',
        scopes:            tokens.scope.split(' '),
        status:            'active',
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'client_id,provider,account_id' },
    )

  if (ga4CredentialErr) {
    console.error('[google/callback] GA4 credential write failed:', ga4CredentialErr.message)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  const { error: retireGa4Err } = await supabaseAdmin
    .from('platform_oauth_connections')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('provider', 'google_ga4')
    .neq('account_id', clientId)

  if (retireGa4Err) {
    console.error('[google/callback] GA4 credential retirement failed:', retireGa4Err.message)
    return NextResponse.redirect(destination(flow, clientId, 'error'))
  }

  // Resolve which properties (if any) this Google account can see.
  // Zero properties is a normal "customer doesn't have GA4 yet" state, not
  // an error — only a genuine API failure gets logged loudly (spec §2.6:
  // "真的没有" vs "接口报错" must not be conflated).
  //
  // 2026-08-18 rewrite (#1052 GA4 connector state-invariant fix, PM Gate
  // BLOCKED on the original version): this used to unconditionally upsert
  // `client_connectors.anchor='ga4', status='connected'` the moment the
  // Admin API returned ANY properties — no verification, and no check for
  // whether a connector row already existed. That meant every subsequent
  // re-auth could silently: (a) mark GA4 "connected" without ever proving
  // read access, (b) overwrite a human's deliberately-chosen property with
  // whichever one happened to sort first, and (c) flip a diagnosed
  // status='error' row back to 'connected' with a different property,
  // erasing the error without fixing anything. That's three violations of
  // the state invariant this PR establishes:
  //   OAuth active       ≠ GA4 connected
  //   Property discovered ≠ Property selected
  //   Property selected   ≠ Property verified
  //   status='connected'  = the selected property passed verifyGa4PropertyAccess()
  //
  // The only place allowed to write status='connected' is setGa4Property()
  // (src/lib/ga4/property.ts) — it's the single source of truth for "does
  // this token actually have read access to this property", and it already
  // refuses to clobber a different, already-working connector. This
  // callback calls that same function instead of re-implementing any part
  // of that logic, and only in the one case narrow enough to not need a
  // human decision: exactly one candidate property AND no client_connectors
  // row exists yet at all (nothing to clobber, nothing to second-guess).
  // Every other case — zero properties, more than one candidate, or a
  // connector row already present in ANY status (connected OR error) —
  // does nothing here and leaves it to the settings page's property picker
  // (GET/PATCH /api/clients/[id]/ga4-properties), which re-verifies live on
  // every save regardless of what this callback did or didn't do.
  {
    const ga4Result = await listGa4Properties(tokens.access_token)
    if (!ga4Result.ok) {
      console.error('[google/callback] GA4 property list failed — OAuth saved; leaving GA4 unconnected for this round')
    } else if (ga4Result.properties.length > 0) {
      const chosen    = ga4Result.properties[0]
      if (ga4Result.properties.length === 1) {
        const { data: existingConnector, error: existingConnectorErr } = await supabaseAdmin
          .from('client_connectors')
          .select('id')
          .eq('client_id', clientId)
          .eq('anchor', 'ga4')
          .maybeSingle<{ id: string }>()

        if (existingConnectorErr) {
          console.error('[google/callback] GA4 connector read failed; skipping auto-select:', existingConnectorErr.message)
        } else if (!existingConnector) {
          // Nothing to clobber — verify-then-write through the one shared
          // path. If verification fails, setGa4Property() itself records
          // status='error' with the reason; either way this callback never
          // writes 'connected' directly.
          await setGa4Property(clientId, chosen.property)
        }
        // existingConnector already present (connected OR error) → leave it
        // exactly as-is; re-auth must never silently override it.
      }
      // properties.length > 1 → ambiguous, no auto-pick; user chooses via
      // the settings page picker, which lists all of them live from Google.
    }
    // properties.length === 0 → customer genuinely has no GA4 account yet,
    // not an error — nothing to write, matches the wizard's skip-and-move-on path.
  }

  // ── GBP: 若这次授权包含 business.manage，一并把商家页连接落库 ────────────
  // 铁律 3 落地（2026-09-07）：从前 GBP 和 GSC/GA4 是两条独立 OAuth，每客户要
  // 点两次；PM 每天早上待办里都躺着三条「要你点一次的连接」，实际上大半是同
  // 一个 Google 账号只是要跳第二遍。合到一次点后，一次 consent 覆盖商家页 +
  // GSC + GA4 + Indexing，daily-todo 的 setup 卡片就真的能"以后不再出现"了。
  //
  // 非致命：GSC / GA4 已经写好，即使 GBP 这一支失败（用户不在 Test users /
  // Business API 没启用 / 账号名下没商家页），也不该把整条授权推回错误页 ——
  // daily-todo 的 GBP 待办明天照旧会浮出来，用户再单独走一次 gbp/start 就行。
  if (tokens.refresh_token && scopeIncludesGbp(tokens.scope)) {
    const gbpResult = await persistGbpFromTokens({
      clientId,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresInSec: tokens.expires_in,
      scope:        tokens.scope,
    }).catch((err) => {
      console.error('[google/callback] GBP persist threw:', err instanceof Error ? err.message : err)
      return { ok: false as const }
    })
    if (!gbpResult.ok) {
      console.warn('[google/callback] GBP not persisted this round — daily-todo will re-surface it')
    }
  }

  // Redirect back to where the flow started
  return NextResponse.redirect(destination(flow, clientId, 'success'))
}
