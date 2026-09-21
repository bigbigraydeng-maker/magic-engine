/** Ads consent extends the existing Meta OAuth integration and encrypted platform vault. */
import { exchangeMetaTokenFields } from './client'
import { randomBytes, createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { metaGraphGet, graphRows, graphAfter, metaReadVersion, MetaReadError } from '@/lib/meta/graph-read'
import { requirePilotActive,requirePilotRevision } from '@/lib/meta/ai/entitlement'
export const browserCookie = 'me_meta_ads_oauth'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function config() {
  const id = process.env.FACEBOOK_APP_ID, secret = process.env.FACEBOOK_APP_SECRET
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!id || !secret || !origin || !/^https:\/\//.test(origin)) throw new MetaReadError('configuration_required',503)
  return { id, secret, origin:new URL(origin).origin }
}
export function adsRedirectUri() { return `${config().origin}/api/auth/facebook/ads/callback` }
export async function startAdsConsent(clientId: string, principalId: string) {
  const pilot=await requirePilotActive(clientId)
  if(!pilot.revision) throw new MetaReadError('invitation_required',403)
  const { error:cleanupError }=await supabaseAdmin.from('meta_ads_oauth_states').delete().eq('client_id',clientId).lt('expires_at',new Date().toISOString())
  if(cleanupError) throw new MetaReadError('authorization_unavailable',503)
  const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url')
  const { error } = await supabaseAdmin.from('meta_ads_oauth_states').insert({ state_hash:hash(state),client_id:clientId,
    principal_id:principalId,entitlement_revision:pilot.revision,browser_hash:hash(browser),expires_at:new Date(Date.now()+600_000).toISOString() })
  if (error) throw new MetaReadError('authorization_unavailable',503)
  const url = new URL(`https://www.facebook.com/${metaReadVersion()}/dialog/oauth`)
  url.search = new URLSearchParams({ client_id:config().id,redirect_uri:adsRedirectUri(),response_type:'code',scope:'ads_read',state,auth_type:'rerequest',locale:'zh_CN' }).toString()
  return { url:url.toString(),browser }
}
export async function consumeAdsState(state: string, browser: string, principalId: string): Promise<{ clientId:string;entitlementRevision:string }> {
  if (!/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(browser)) throw new MetaReadError('invalid_oauth_state',403)
  const { data,error } = await supabaseAdmin.from('meta_ads_oauth_states').delete().eq('state_hash',hash(state))
    .eq('browser_hash',hash(browser)).eq('principal_id',principalId).gt('expires_at',new Date().toISOString()).select('client_id,entitlement_revision').maybeSingle()
  if (error || !data) throw new MetaReadError('invalid_oauth_state',403)
  return { clientId:data.client_id as string,entitlementRevision:data.entitlement_revision as string }
}
async function exchange(params: Record<string,string>): Promise<{ token:string; seconds:number | null }> {
  const result=await exchangeMetaTokenFields(params,metaReadVersion())
  if(!result) throw new MetaReadError('oauth_exchange_failed',502)
  return result
}
export function conservativeTokenSeconds(shortSeconds:number|null,longSeconds:number|null) {
  const seconds=longSeconds ?? shortSeconds
  if (!seconds) throw new MetaReadError('oauth_expiry_unknown',502)
  return seconds
}
export async function finishAdsConsent(code: string, clientId: string, principalId: string,entitlementRevision:string) {
  const short = await exchange({ code,redirect_uri:adsRedirectUri() })
  const long = await exchange({ grant_type:'fb_exchange_token',fb_exchange_token:short.token })
  const tokenSeconds=conservativeTokenSeconds(short.seconds,long.seconds)
  const permissions = await metaGraphGet('me/permissions',long.token,{ limit:'100' })
  if (graphAfter(permissions)) throw new MetaReadError('permission_verification_incomplete',502)
  const scopes = graphRows(permissions).filter(p => p.status === 'granted').map(p => String(p.permission))
  if (!scopes.includes('ads_read')) throw new MetaReadError('permission_required',403)
  const user = await metaGraphGet('me',long.token,{ fields:'id' })
  if (typeof user.id !== 'string' || !/^\d+$/.test(user.id)) throw new MetaReadError('oauth_identity_unverified',502)
  await requirePilotRevision(clientId,entitlementRevision)
  await upsertConnection({ clientId,provider:'meta',purpose:'meta_ads_read',accountId:`ads_user:${user.id}`,accessToken:long.token,
    refreshToken:'',tokenExpiry:new Date(Date.now()+tokenSeconds*1000),displayName:'Meta Ads read-only',scopes,
    authorizingPrincipalId:principalId,entitlementRevision,lastSyncedAt:new Date() })
}
