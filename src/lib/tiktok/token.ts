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

/**
 * 这个客户有不止一条有效的 TikTok 授权:不知道该用哪个账号发,所以一律不发。
 * 文案刻意不含 token 字样 —— 报错翻译里凡是带 token 的都会被翻成「去重新连接 TikTok」,
 * 而存在多个授权时连接按钮是隐藏的,会把人指到一个不存在的入口。
 */
export class TikTokAmbiguousConnectionError extends Error {
  constructor() {
    super('存在多个 TikTok 授权,已暂停发布,请联系团队核实')
    this.name = 'TikTokAmbiguousConnectionError'
  }
}

type ActiveRow = {
  id: string
  access_token_enc?: string
  refresh_token_enc?: string
  token_expiry?: string
  account_id?: string
}

/** 取该客户有效的 TikTok 授权;最多取 2 条,够判断「是不是多条」就行。accountId 给定时只取那个账号。 */
async function fetchActiveRows(clientId: string, accountId?: string): Promise<{ rows: ActiveRow[]; failed: boolean }> {
  let query = supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, access_token_enc, refresh_token_enc, token_expiry, account_id')
    .eq('client_id', clientId)
    .eq('provider', PLATFORM_PROVIDERS.TIKTOK)
    .eq('status', 'active')
  if (accountId) query = query.eq('account_id', accountId)
  const { data, error } = await query.limit(2)
  return { rows: error ? [] : ((data ?? []) as ActiveRow[]), failed: Boolean(error) }
}

/**
 * @param opts.accountId 已知要用哪个账号时传入(例如已发出任务的状态轮询带着原账号):
 *   这个账号恰好有一条有效授权就用它,即使该客户还有别的有效授权;找不到则按默认规则处理。
 *   账号一致性不降低,只是不让一条无关的授权把已发出的任务卡死。
 * @returns 令牌;没有授权(或查库出错)返回 null。
 * @throws {TikTokAmbiguousConnectionError} 没指定账号、或指定账号没匹配上,且有效授权多于一条。
 *   以前这里「取最新创建的一条」,但重新授权旧账号不会更新 created_at,最新的未必是刚授权的那条,
 *   有取错账号发布的风险。
 */
export async function getValidTikTokToken(clientId: string, opts?: { accountId?: string }): Promise<TikTokToken | null> {
  let { rows, failed } = opts?.accountId ? await fetchActiveRows(clientId, opts.accountId) : { rows: [], failed: false }
  if (rows.length !== 1) ({ rows, failed } = await fetchActiveRows(clientId))
  if (failed || rows.length === 0) return null
  if (rows.length > 1) throw new TikTokAmbiguousConnectionError()
  const row = rows[0]

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
