/**
 * 拿到含 `business.manage` scope 的 Google token 后，把 GBP 连接落库。
 *
 * 抽出来是为了让「一次 OAuth 覆盖全部」的合并流（`/api/auth/google/callback`）
 * 和「只连商家页」的兼容入口（`/api/auth/google/gbp/callback`）共用同一段落库
 * 逻辑，不用把三张表的写法（`platform_oauth_connections.google_gbp` +
 * `client_connectors.gbp` + 试着 resolve location）复制两份。
 *
 * 契约：
 *  - 只做数据落库 + 位置解析，不做 OAuth token 交换、不做鉴权 —— 那两件事上游做。
 *  - 拉不到账号（403 / 429 / 404 / no accounts）返回 `{ ok: false, reason }`，
 *    reason 与 gbp/callback 保留一致的 slug，上游据此渲染错误页。
 *  - 拉到账号但 resolve location 失败不算致命：连接照样写成 active，
 *    `locationStatus === 'needs_location'`，daily-todo 的 GBP 待办会自动
 *    落到「差最后一步」那条。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { encryptToken } from '@/lib/platform-oauth/vocabulary'
import { resolveGbpLocation } from '@/lib/gbp/location'
import { GBP_SCOPE } from '@/lib/google-oauth/client'

const GBP_ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts'

/**
 * 与 `/api/auth/google/gbp/callback` 的 error reason 保持同一套 slug ——
 * 只在拉不到账号时算致命；DB 写失败按现有习惯降级为 warning，不阻断跳回 settings。
 */
export type GbpPersistReason = 'gbp_api_failed' | 'no_gbp_accounts'

export interface GbpPersistResult {
  ok: boolean
  reason?: GbpPersistReason
  /** 只有 `ok: true` 时才有意义；`needs_location` 表示连接活了但发帖前还差一步选门店。*/
  locationStatus?: 'ready' | 'needs_location'
}

export interface GbpPersistInput {
  clientId: string
  accessToken: string
  refreshToken: string
  expiresInSec: number
  /** 完整 scope 字符串（Google 返回的 `tokens.scope`）。用于校验和记账。*/
  scope: string
}

/**
 * 判断 Google 返回的 scope 是否包含 GBP 管理权限。
 *
 * scope 是空格分隔的字符串（`buildAuthUrl` / OAuth 规范），必须整段匹配，
 * 别用 `includes('business.manage')`——那样带任何前缀的 URL 都会误命中。
 */
export function scopeIncludesGbp(scope: string | undefined | null): boolean {
  if (!scope) return false
  return scope.split(/\s+/).includes(GBP_SCOPE)
}

export async function persistGbpFromTokens(input: GbpPersistInput): Promise<GbpPersistResult> {
  const { clientId, accessToken, refreshToken, expiresInSec, scope } = input

  // 1. 拉 GBP 账号
  const accountsRes = await fetch(GBP_ACCOUNTS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!accountsRes.ok) {
    // 403 → 用户不在 Test users 名单 / scope 没生效；429 → 配额；404 → API 未启用
    const errorBody = await accountsRes.text().catch(() => '(unreadable)')
    console.error('[gbp-oauth-persist] GBP accounts API failed:', {
      status:     accountsRes.status,
      statusText: accountsRes.statusText,
      body:       errorBody.slice(0, 500),
      scope,
    })
    return { ok: false, reason: 'gbp_api_failed' }
  }

  const accountsData = (await accountsRes.json()) as {
    accounts?: Array<{ name: string; accountName: string }>
  }
  const accounts = accountsData.accounts ?? []
  if (accounts.length === 0) {
    console.warn('[gbp-oauth-persist] no GBP accounts under this Google user')
    return { ok: false, reason: 'no_gbp_accounts' }
  }

  const gbpAccount = accounts[0]

  // 2. 加密并 upsert `platform_oauth_connections.google_gbp`
  const expiresAt = new Date(Date.now() + expiresInSec * 1000)
  const { error: dbError } = await supabaseAdmin
    .from('platform_oauth_connections')
    .upsert(
      {
        client_id:         clientId,
        provider:          'google_gbp',
        access_token_enc:  encryptToken(accessToken),
        refresh_token_enc: encryptToken(refreshToken),
        token_expiry:      expiresAt.toISOString(),
        account_id:        gbpAccount.name,
        display_name:      gbpAccount.accountName,
        scopes:            [GBP_SCOPE],
        status:            'active',
      },
      { onConflict: 'client_id,provider,account_id' },
    )

  if (dbError) {
    // 与 gbp/callback 原逻辑一致：非致命，上游继续走 —— 用户可以从 settings 重连。
    console.error('[gbp-oauth-persist] Failed to persist connection:', dbError.message)
  }

  // 3. Onboarding 向导和 daily-todo 「GBP 已连接」读的是 client_connectors。
  const now = new Date().toISOString()
  await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id:    clientId,
        anchor:       'gbp',
        status:       'connected',
        config:       { account_name: gbpAccount.accountName },
        connected_at: now,
        updated_at:   now,
      },
      { onConflict: 'client_id,anchor' },
    )

  // 4. 顺手解析要发到哪家门店。失败不致命 —— 连接活的，只是差最后一步。
  //    默认 `needs_location`：不知道就说不知道，别谎报 ready（魏征 🟡5）。
  let locationStatus: 'ready' | 'needs_location' = 'needs_location'
  try {
    const { data: clientRow } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain')
      .eq('id', clientId)
      .single()

    if (clientRow) {
      const resolved = await resolveGbpLocation(
        clientRow as { id: string; name: string; domain: string | null },
      )
      if (resolved.ok) locationStatus = 'ready'
      else console.warn('[gbp-oauth-persist] location unresolved:', resolved.reason)
    } else {
      console.warn('[gbp-oauth-persist] client row unreadable — leaving location unconfirmed')
    }
  } catch (err) {
    console.warn('[gbp-oauth-persist] location resolution failed:', err instanceof Error ? err.message : err)
  }

  return { ok: true, locationStatus }
}
