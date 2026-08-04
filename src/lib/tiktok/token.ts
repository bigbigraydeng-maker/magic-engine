/**
 * 取这个客户能用的 TikTok 令牌 —— 过期了自动换新的。
 *
 * 为什么必须有这一层(跟 Meta 不一样):
 * Meta 的页 token 只要授权还在就一直有效,存下来就不用管。TikTok 的 access token **24 小时就死**,
 * 拿着过期令牌去发,报错长得像「权限不够」,会把人引到完全错误的方向去查。
 * 所以每次用之前先看有效期,快到了就用 refresh token 换一套,并且把新的存回去
 * ——TikTok 每次刷新都会给一个**新的 refresh token**,不存回去下次就换不动了。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { decryptToken, encryptToken, PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { needsRefresh, refreshTokens } from '@/lib/tiktok-oauth/client'

export interface TikTokToken {
  accessToken: string
  openId: string
}

export async function getValidTikTokToken(clientId: string): Promise<TikTokToken | null> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, access_token_enc, refresh_token_enc, token_expiry, account_id')
    .eq('client_id', clientId)
    .eq('provider', PLATFORM_PROVIDERS.TIKTOK)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const row = data as {
    id: string
    access_token_enc?: string
    refresh_token_enc?: string
    token_expiry?: string
    account_id?: string
  }

  const expiry = row.token_expiry ? new Date(row.token_expiry) : null
  if (!needsRefresh(expiry, Date.now())) {
    try {
      const access = decryptToken(row.access_token_enc ?? '')
      if (access) return { accessToken: access, openId: row.account_id ?? '' }
    } catch {
      // 解不开就当没有,往下走刷新这条路 —— 返回一串垃圾会让 TikTok 报一个看不懂的错
    }
  }

  let refresh: string
  try {
    refresh = decryptToken(row.refresh_token_enc ?? '')
  } catch {
    return null
  }
  if (!refresh) return null

  const fresh = await refreshTokens(refresh)
  if (!fresh) return null

  await supabaseAdmin
    .from('platform_oauth_connections')
    .update({
      access_token_enc: encryptToken(fresh.accessToken),
      // 必须存回新的 refresh token:TikTok 每次刷新都换一个,沿用旧的下次就换不动了
      refresh_token_enc: encryptToken(fresh.refreshToken),
      token_expiry: new Date(Date.now() + fresh.expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  return { accessToken: fresh.accessToken, openId: fresh.openId || (row.account_id ?? '') }
}
