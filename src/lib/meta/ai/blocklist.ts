/**
 * Magic Bridge abuse blocklist (self-serve opening, PR-1). The same one-way Facebook user key the
 * database stores on analysis jobs (public.meta_ads_facebook_user_key): sha256('meta-ads-user:' + account id).
 */
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { MetaReadError } from '../graph-read'

export function facebookUserKey(accountId: string): string {
  return createHash('sha256').update(`meta-ads-user:${accountId}`).digest('hex')
}

export async function isBlocked(kind: 'facebook_user' | 'ad_account', key: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('meta_ads_is_blocked', { p_kind: kind, p_key: key })
  if (error) throw new MetaReadError('authorization_unavailable', 503)
  return data === true
}

export async function requireNotBlocked(kind: 'facebook_user' | 'ad_account', key: string): Promise<void> {
  if (await isBlocked(kind, key)) throw new MetaReadError('blocked', 403)
}
