/**
 * 授权入库前的账号归属检查(社媒平台)。
 *
 * 起因(2026-10-20):同一个 TikTok 账号被误授权挂到了两个客户名下。授权回来之后系统直接存库,
 * 没有任何一道闸问「这个账号是不是已经是别的客户的」「这个客户是不是已经有另一个账号了」。
 *
 * 只做两件事,且都是**拒绝**,不做替换:
 *   ① 同一个平台账号已挂在**别的客户**名下(未撤销)→ account_in_use
 *   ② 这个客户在该平台已有**另一个账号**的授权(未撤销)→ has_other_account
 * 「未撤销」包含过期/出错:只有撤销才是释放,和每日串台审计、面板的口径一致。
 * 要换号就由管理员先断开旧的(= 撤销),再重新连接。
 */

import { supabaseAdmin } from '@/lib/supabase'

export type SocialAccountVerdict = 'ok' | 'account_in_use' | 'has_other_account'

export async function checkSocialAccountAvailable(
  clientId: string,
  provider: string,
  accountId: string,
): Promise<SocialAccountVerdict> {
  // 空串会匹配所有空串行;宁可抛出也不放行。
  if (!accountId.trim()) throw new Error('授权占用检查失败: 账号编号为空')

  // 两次参数化查询,不用 .or(...) 拼字符串:账号编号来自第三方返回,不能拼进过滤语法。
  const sameAccount = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('client_id, account_id')
    .eq('provider', provider)
    .neq('status', 'revoked')
    .eq('account_id', accountId)
  if (sameAccount.error) throw new Error('授权占用检查失败')
  const rowsOfAccount = (sameAccount.data ?? []) as Array<{ client_id: string }>
  if (rowsOfAccount.some(r => r.client_id !== clientId)) return 'account_in_use'

  const sameClient = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('client_id, account_id')
    .eq('provider', provider)
    .neq('status', 'revoked')
    .eq('client_id', clientId)
  if (sameClient.error) throw new Error('授权占用检查失败')
  const rowsOfClient = (sameClient.data ?? []) as Array<{ account_id: string }>  // blank-id rows are invisible in the panel, so they must not lock the client out
  if (rowsOfClient.some(r => r.account_id.trim() && r.account_id !== accountId)) return 'has_other_account'

  return 'ok'
}
