import { supabaseAdmin } from '@/lib/supabase'
import { generateApiKey } from '@/lib/auth/api-key-access'
import { activeConnection,reserveRead } from './store'
import { MetaReadError,metaGraphGet,graphRows,graphAfter } from '../graph-read'
import { AI_ENTITY_FIELDS } from '../entity-settings'
import { META_ADS_SCOPE } from './contract'
export async function status(clientId: string) {
  const [connections,grants,keys] = await Promise.all([
    supabaseAdmin.from('platform_oauth_connections').select('id,status,token_expiry').eq('client_id',clientId).eq('purpose','meta_ads_read'),
    supabaseAdmin.from('meta_ads_read_grants').select('id,ad_account_id,connection_id,revision').eq('client_id',clientId).is('revoked_at',null),
    supabaseAdmin.from('client_api_keys').select('id,key_prefix,expires_at,last_used_at,metadata').eq('client_id',clientId).contains('scopes',[META_ADS_SCOPE]).is('revoked_at',null),
  ])
  if (connections.error || grants.error || keys.error) throw new MetaReadError('authorization_unavailable',503)
  return { connections:connections.data,grants:grants.data,keys:keys.data.map(key=>{
    const meta=key.metadata as { meta_ads_grant_id?:string;meta_ads_grant_revision?:string }
    const grant=grants.data.find(g=>g.id===meta.meta_ads_grant_id && g.revision===meta.meta_ads_grant_revision)
    const connection=connections.data.find(c=>c.id===grant?.connection_id)
    return { id:key.id,key_prefix:key.key_prefix,expires_at:key.expires_at,last_used_at:key.last_used_at,
      account_id:grant?.ad_account_id ?? null,access_active:Boolean(grant && connection?.status==='active' && Date.parse(connection.token_expiry)>Date.now()) }
  }) }
}
export async function discover(clientId: string,connectionId: string) {
  await reserveRead(clientId)
  const connection = await activeConnection(clientId,connectionId)
  const accounts: Record<string,unknown>[] = []
  let after: string | null = null
  const deadline = Date.now()+35_000
  for (let page=0;page<5;page++) {
    const result = await metaGraphGet('me/adaccounts',connection.token,{ fields:AI_ENTITY_FIELDS.account,limit:'100',...(after ? { after } : {}) },deadline)
    accounts.push(...graphRows(result)); after=graphAfter(result)
    if (!after) return { accounts,complete:true }
  }
  return { accounts,complete:false }
}
export async function bind(clientId: string,principalId: string,connectionId: string,accountId: string) {
  await reserveRead(clientId)
  const connection = await activeConnection(clientId,connectionId)
  const account = await metaGraphGet(accountId,connection.token,{ fields:AI_ENTITY_FIELDS.account })
  if (account.id !== accountId) throw new MetaReadError('account_not_accessible',403)
  const { data,error } = await supabaseAdmin.from('meta_ads_read_grants').upsert({ client_id:clientId,connection_id:connectionId,
    ad_account_id:accountId,principal_id:principalId,revoked_at:null },{ onConflict:'client_id,ad_account_id' }).select('id,ad_account_id').single()
  if (error || !data) throw new MetaReadError('account_unavailable',409)
  return data
}
export async function issueKey(clientId: string,grantId: string,email: string) {
  const { data:grant,error } = await supabaseAdmin.from('meta_ads_read_grants').select('connection_id,revision').eq('client_id',clientId).eq('id',grantId).is('revoked_at',null).maybeSingle()
  if (error || !grant) throw new MetaReadError('grant_required',403)
  await activeConnection(clientId,grant.connection_id)
  await reserveRead(clientId)
  const key = generateApiKey()
  const { error:writeError } = await supabaseAdmin.from('client_api_keys').insert({ client_id:clientId,key_hash:key.hash,key_prefix:key.prefix,
    name:'Meta Ads read-only',scopes:[META_ADS_SCOPE],created_by_email:email,expires_at:new Date(Date.now()+30*86400_000).toISOString(),metadata:{ meta_ads_grant_id:grantId,meta_ads_grant_revision:grant.revision } })
  if (writeError) throw new MetaReadError('key_creation_failed',503)
  return { key:key.plaintext }
}
export async function revoke(clientId: string,type:'key'|'grant'|'connection',id: string) {
  if (type === 'connection') {
    const { error } = await supabaseAdmin.from('platform_oauth_connections').update({ status:'revoked',updated_at:new Date().toISOString() })
      .eq('client_id',clientId).eq('id',id).eq('purpose','meta_ads_read')
    if (error) throw new MetaReadError('disconnect_failed',503)
  } else {
    let query = supabaseAdmin.from(type === 'key' ? 'client_api_keys' : 'meta_ads_read_grants').update({ revoked_at:new Date().toISOString() }).eq('client_id',clientId).eq('id',id)
    if (type === 'key') query=query.contains('scopes',[META_ADS_SCOPE])
    const { error } = await query
    if (error) throw new MetaReadError('disconnect_failed',503)
  }
}
