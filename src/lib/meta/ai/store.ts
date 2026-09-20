import { supabaseAdmin } from '@/lib/supabase'
import { decryptToken } from '@/lib/platform-oauth/vocabulary'
import { MetaReadError } from '../graph-read'
import { enabled, META_ADS_SCOPE } from './contract'
import type { ApiKeyAuth } from '@/lib/auth/api-key-access'
export type MetaPrincipal = Extract<ApiKeyAuth, { kind: 'client' }>
export interface ReadGrant { id: string; client_id: string; connection_id: string; ad_account_id: string; revision: string; principal_id: string }
export function requireMetaScope(principal: MetaPrincipal) {
  if (!enabled()) throw new MetaReadError('not_available', 404)
  if (!principal.scopes.includes(META_ADS_SCOPE)) throw new MetaReadError('scope_required', 403)
}
export async function reserveRead(clientId: string) {
  const { data, error } = await supabaseAdmin.rpc('meta_ads_reserve_read', { tenant: clientId })
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  if (data !== true) throw new MetaReadError('rate_limited', 429)
}
export async function activeConnection(clientId: string, connectionId: string) {
  const { data, error } = await supabaseAdmin.from('platform_oauth_connections')
    .select('id,access_token_enc,token_expiry,updated_at').eq('client_id', clientId).eq('id', connectionId)
    .eq('provider','meta').eq('purpose','meta_ads_read').eq('status','active').contains('scopes',['ads_read'])
    .gt('token_expiry', new Date(Date.now()+60_000).toISOString()).maybeSingle()
  if (error) throw new MetaReadError('authorization_unavailable',503)
  if (!data) throw new MetaReadError('reconnect_required',403)
  return { id: data.id as string, token: decryptToken(data.access_token_enc), version: data.updated_at as string }
}
export async function readGrant(principal: MetaPrincipal): Promise<ReadGrant> {
  requireMetaScope(principal)
  const { data: key, error: keyError } = await supabaseAdmin.from('client_api_keys').select('metadata,scopes,expires_at')
    .eq('id',principal.keyId).eq('client_id',principal.clientId).is('revoked_at',null).maybeSingle()
  if (keyError) throw new MetaReadError('authorization_unavailable',503)
  if (!key || !key.scopes.includes(META_ADS_SCOPE) || !key.expires_at || Date.parse(key.expires_at) <= Date.now()) throw new MetaReadError('key_expired_or_revoked',403)
  const grantId = (key.metadata as { meta_ads_grant_id?: string }).meta_ads_grant_id
  if (!grantId) throw new MetaReadError('grant_required',403)
  const { data, error } = await supabaseAdmin.from('meta_ads_read_grants').select('*').eq('id',grantId)
    .eq('client_id',principal.clientId).is('revoked_at',null).maybeSingle()
  if (error) throw new MetaReadError('authorization_unavailable',503)
  if (!data) throw new MetaReadError('grant_revoked',403)
  const grant = data as ReadGrant
  if ((key.metadata as { meta_ads_grant_revision?:string }).meta_ads_grant_revision !== grant.revision) throw new MetaReadError('grant_changed',403)
  const { data: conflict, error: conflictError } = await supabaseAdmin.rpc('meta_ads_account_conflict', { tenant: principal.clientId, account: grant.ad_account_id })
  if (conflictError) throw new MetaReadError('authorization_unavailable',503)
  if (conflict !== false) throw new MetaReadError('account_unavailable',403)
  return grant
}
