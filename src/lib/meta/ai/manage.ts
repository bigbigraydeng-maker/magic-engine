import { supabaseAdmin } from '@/lib/supabase'
import { generateApiKey } from '@/lib/auth/api-key-access'
import { activeConnectionForPrincipal,requireDiscoveryAuthorization,requireReleaseAuthorization,reserveRead } from './store'
import { MetaReadError,metaGraphGet,graphRows,graphAfter } from '../graph-read'
import { AI_ENTITY_FIELDS } from '../entity-settings'
import { META_ADS_SCOPE,toolNames } from './contract'
import { pilotState,requirePilotActive } from './entitlement'
import { listAnalyses } from './analysis'

type LastRead={ tool:string;account_id:string|null;at:string }
async function lastSuccessfulRead(clientId: string,keyId:string):Promise<LastRead|null> {
  const { data,error }=await supabaseAdmin.from('mcp_access_log')
    .select('tool,resource_id,created_at').eq('client_id',clientId).eq('key_kind','client').eq('client_key_id',keyId).eq('ok',true)
    .in('tool',[...toolNames]).order('created_at',{ ascending:false }).limit(1).maybeSingle()
  if(error) throw new MetaReadError('authorization_unavailable',503)
  return data ? { tool:data.tool as string,account_id:data.resource_id as string | null,at:data.created_at as string } : null
}

export async function status(clientId: string, principalId: string) {
  const [connections,grants,keys,pilot,analyses] = await Promise.all([
    supabaseAdmin.from('platform_oauth_connections').select('id,status,token_expiry,authorizing_principal_id,entitlement_revision')
      .eq('client_id',clientId).eq('purpose','meta_ads_read'),
    supabaseAdmin.from('meta_ads_read_grants').select('id,ad_account_id,connection_id,revision,principal_id,revoked_at,entitlement_revision')
      .eq('client_id',clientId),
    supabaseAdmin.from('client_api_keys').select('id,key_prefix,expires_at,last_used_at,metadata').eq('client_id',clientId).contains('scopes',[META_ADS_SCOPE]).is('revoked_at',null),
    pilotState(clientId),
    listAnalyses(clientId,principalId),
  ])
  if (connections.error || grants.error || keys.error) throw new MetaReadError('authorization_unavailable',503)
  const ownedConnections=connections.data.filter(connection=>connection.authorizing_principal_id===principalId)
  const ownedGrants=grants.data.filter(grant=>grant.principal_id===principalId)
  const safeConnections=ownedConnections.map(({ authorizing_principal_id:_owner,entitlement_revision,...connection })=>({
    ...connection,status:pilot.revision===entitlement_revision ? connection.status : 'revoked',
  }))
  const safeGrants=ownedGrants.filter(grant=>grant.revoked_at===null && grant.entitlement_revision===pilot.revision
    && ownedConnections.some(connection=>connection.id===grant.connection_id && connection.entitlement_revision===pilot.revision))
    .map(({ principal_id:_owner,revoked_at:_revoked,entitlement_revision:_entitlement,...grant })=>grant)
  const visibleKeys=keys.data.flatMap(key=>{
    const meta=key.metadata as { meta_ads_grant_id?:string;meta_ads_grant_revision?:string;meta_ads_principal_id?:string;meta_ads_entitlement_revision?:string }
    const grant=ownedGrants.find(g=>g.id===meta.meta_ads_grant_id)
    if(!grant) return []
    if(meta.meta_ads_principal_id && meta.meta_ads_principal_id!==principalId) return []
    const connection=ownedConnections.find(c=>c.id===grant.connection_id)
    return [{ id:key.id,key_prefix:key.key_prefix,expires_at:key.expires_at,last_used_at:key.last_used_at,
      account_id:grant.ad_account_id,access_active:Boolean(pilot.new_actions_allowed && pilot.revision===grant.entitlement_revision && pilot.revision===meta.meta_ads_entitlement_revision
        && pilot.revision===connection?.entitlement_revision && grant.revoked_at===null && grant.revision===meta.meta_ads_grant_revision
        && connection?.status==='active' && Date.parse(connection.token_expiry)>Date.now()) }]
  })
  const safeKeys=await Promise.all(visibleKeys.map(async key=>({ ...key,last_successful_read:await lastSuccessfulRead(clientId,key.id) })))
  return { pilot,connections:safeConnections,grants:safeGrants,keys:safeKeys,analyses }
}
export async function discover(clientId: string,principalId: string,connectionId: string) {
  await reserveRead(clientId)
  const connection = await activeConnectionForPrincipal(clientId,connectionId,principalId)
  const accounts: Record<string,unknown>[] = []
  let after: string | null = null
  const deadline = Date.now()+35_000
  for (let page=0;page<5;page++) {
    const result = await metaGraphGet('me/adaccounts',connection.token,{ fields:AI_ENTITY_FIELDS.account,limit:'100',...(after ? { after } : {}) },deadline)
    accounts.push(...graphRows(result)); after=graphAfter(result)
    if (!after) {
      await requireDiscoveryAuthorization(clientId,connectionId,principalId,connection.version)
      return { accounts,complete:true }
    }
  }
  await requireDiscoveryAuthorization(clientId,connectionId,principalId,connection.version)
  return { accounts,complete:false }
}
export async function bind(clientId: string,principalId: string,connectionId: string,accountId: string) {
  await reserveRead(clientId)
  const connection = await activeConnectionForPrincipal(clientId,connectionId,principalId)
  const account = await metaGraphGet(accountId,connection.token,{ fields:AI_ENTITY_FIELDS.account })
  if (account.id !== accountId) throw new MetaReadError('account_not_accessible',403)
  const pilot=await requirePilotActive(clientId)
  const finalConnection=await activeConnectionForPrincipal(clientId,connectionId,principalId)
  if(finalConnection.version!==connection.version || pilot.revision!==connection.entitlementRevision) throw new MetaReadError('authorization_changed',403)
  const { data,error } = await supabaseAdmin.from('meta_ads_read_grants').upsert({ client_id:clientId,connection_id:connectionId,
    ad_account_id:accountId,principal_id:principalId,entitlement_revision:pilot.revision,revoked_at:null },{ onConflict:'client_id,ad_account_id' }).select('id,ad_account_id').single()
  if (error || !data) throw new MetaReadError('account_unavailable',409)
  return data
}
export async function issueKey(clientId: string,principalId: string,grantId: string,email: string) {
  const { data:grant,error } = await supabaseAdmin.from('meta_ads_read_grants').select('connection_id,revision,principal_id,entitlement_revision,ad_account_id')
    .eq('client_id',clientId).eq('id',grantId).is('revoked_at',null).maybeSingle()
  if (error || !grant) throw new MetaReadError('grant_required',403)
  if (grant.principal_id !== principalId) throw new MetaReadError('connection_owner_required',403)
  await activeConnectionForPrincipal(clientId,grant.connection_id,principalId)
  await reserveRead(clientId)
  const pilot=await requirePilotActive(clientId)
  const finalConnection=await activeConnectionForPrincipal(clientId,grant.connection_id,principalId)
  if(grant.entitlement_revision!==pilot.revision || finalConnection.entitlementRevision!==pilot.revision) throw new MetaReadError('invitation_changed',403)
  const key = generateApiKey()
  const { data:created,error:writeError } = await supabaseAdmin.from('client_api_keys').insert({ client_id:clientId,key_hash:key.hash,key_prefix:key.prefix,
    name:'Meta Ads read-only',scopes:[META_ADS_SCOPE],created_by_email:email,expires_at:new Date(Date.now()+30*86400_000).toISOString(),metadata:{ meta_ads_grant_id:grantId,meta_ads_grant_revision:grant.revision,meta_ads_principal_id:principalId,meta_ads_entitlement_revision:pilot.revision } }).select('id').single()
  if (writeError || !created) throw new MetaReadError('key_creation_failed',503)
  try {
    await requireReleaseAuthorization({ kind:'client',keyId:created.id as string,clientId,scopes:[META_ADS_SCOPE] },grant.ad_account_id)
  } catch(error) {
    await supabaseAdmin.from('client_api_keys').update({ revoked_at:new Date().toISOString() }).eq('id',created.id).eq('client_id',clientId)
    throw error
  }
  return { key:key.plaintext }
}
export async function revoke(clientId: string,principalId:string,type:'key'|'grant'|'connection',id: string) {
  let result: { data: Array<{ id:string }> | null; error: { message:string } | null }
  if (type === 'connection') {
    result=await supabaseAdmin.from('platform_oauth_connections').update({ status:'revoked',updated_at:new Date().toISOString() })
      .eq('client_id',clientId).eq('id',id).eq('purpose','meta_ads_read').eq('authorizing_principal_id',principalId).select('id')
  } else if(type === 'grant') {
    result=await supabaseAdmin.from('meta_ads_read_grants').update({ revoked_at:new Date().toISOString() })
      .eq('client_id',clientId).eq('id',id).eq('principal_id',principalId).select('id')
  } else {
    const { data:key,error:keyError }=await supabaseAdmin.from('client_api_keys').select('metadata').eq('client_id',clientId)
      .eq('id',id).contains('scopes',[META_ADS_SCOPE]).is('revoked_at',null).maybeSingle()
    if(keyError) throw new MetaReadError('disconnect_failed',503)
    const meta=key?.metadata as { meta_ads_grant_id?:string;meta_ads_principal_id?:string } | null
    const grantId=meta?.meta_ads_grant_id
    if(!grantId) throw new MetaReadError('disconnect_not_found',404)
    if(meta?.meta_ads_principal_id && meta.meta_ads_principal_id!==principalId) throw new MetaReadError('disconnect_not_found',404)
    const { data:ownedGrant,error:grantError }=await supabaseAdmin.from('meta_ads_read_grants').select('id')
      .eq('client_id',clientId).eq('id',grantId).eq('principal_id',principalId).maybeSingle()
    if(grantError) throw new MetaReadError('disconnect_failed',503)
    if(!ownedGrant) throw new MetaReadError('disconnect_not_found',404)
    result=await supabaseAdmin.from('client_api_keys').update({ revoked_at:new Date().toISOString() })
      .eq('client_id',clientId).eq('id',id).contains('scopes',[META_ADS_SCOPE]).is('revoked_at',null).select('id')
  }
  if (result.error) throw new MetaReadError('disconnect_failed',503)
  if (result.data?.length !== 1) throw new MetaReadError('disconnect_not_found',404)
}
