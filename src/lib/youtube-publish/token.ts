/**
 * 取 YouTube 发布用的令牌:按**目标频道**精确选那一条授权,而不是「这个客户最新连的那条」。
 *
 * 为什么不用通用的 getValidToken:它服务 GBP / GSC / GA4 等所有 Google 类平台,
 * 取的是「最新创建的一条」,不认频道。客户换过频道、留着旧授权时,最新的未必是目标频道那条。
 * 发布前 workflow 还会用令牌实际核对一次频道(lockChannel),所以取错只会被拦下;
 * 这里让它一开始就取对,并且在对不上时给出明确原因,而不是靠后面兜底。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'
import { getValidTokenForConnection, PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'
import { getClientChannelId } from './store'

interface ActiveYouTubeConnection {
  id: string
  account_id: string
}

export interface YouTubeTokenDeps {
  getChannelId: (clientId: string) => Promise<string | null>
  listActive: (clientId: string) => Promise<ActiveYouTubeConnection[]>
  tokenForConnection: (connectionId: string) => Promise<string>
}

async function listActive(clientId: string): Promise<ActiveYouTubeConnection[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, account_id')
    .eq('client_id', clientId)
    .eq('provider', PLATFORM_PROVIDERS.GOOGLE_YOUTUBE)
    .eq('status', 'active')
    .eq('purpose', 'legacy')
  if (error) throw new Error(`YouTube 授权查询失败: ${error.message}`)
  return (data ?? []) as ActiveYouTubeConnection[]
}

const defaults: YouTubeTokenDeps = {
  getChannelId: getClientChannelId,
  listActive,
  tokenForConnection: (id) => getValidTokenForConnection(id),
}

/**
 * @throws {PlatformConnectionNotFoundError} 没有任何有效授权(与原行为一致)。
 * @throws {Error} 没配目标频道,或有授权但没有一条对应目标频道。
 */
export async function getYouTubePublishToken(clientId: string, deps: YouTubeTokenDeps = defaults): Promise<string> {
  const channelId = await deps.getChannelId(clientId)
  if (!channelId) throw new Error('这个客户还没有配置 YouTube 目标频道,已暂停发布')

  const rows = await deps.listActive(clientId)
  if (rows.length === 0) throw new PlatformConnectionNotFoundError(clientId, PLATFORM_PROVIDERS.GOOGLE_YOUTUBE)

  const match = rows.find((row) => row.account_id === channelId)
  if (!match) throw new Error('已授权的 YouTube 频道不是目标频道,已暂停发布,请联系团队核实')

  return deps.tokenForConnection(match.id)
}
