/**
 * Re-read an existing ad set's daily budget and end time before go-live.
 * Does not change the ad set. A failed or changed read stops the launch.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { InheritedAdSetSpend } from '@/lib/ads-strategy/ad-draft'
import { goLiveSpendReason } from '@/lib/ads-go-live/spend-recheck'
import { readExistingAdSetSpend, type SpendRead } from '@/lib/meta/existing-adset-spend'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

const NO_TOKEN = '拿不到这个客户的广告授权，没有开。'

export async function blockStaleReusedSpend(
  sb: SupabaseClient,
  clientId: string,
  gate: { adSetId: string; spend: InheritedAdSetSpend | null },
): Promise<string | null> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return NO_TOKEN
  const fresh = await readReusedAdSetSpend(sb, clientId, gate.adSetId, token)
  return goLiveSpendReason(gate.spend, fresh)
}

export async function readReusedAdSetSpend(
  sb: SupabaseClient,
  clientId: string,
  adSetId: string,
  token: string,
): Promise<SpendRead> {
  const ids = await accountIds(sb, clientId)
  if (!ids || ids.length === 0) return { ok: false, error: 'no-account' }
  let last: SpendRead = { ok: false, error: 'unread' }
  for (const id of ids) {
    const read = await readExistingAdSetSpend(adSetId, id, token)
    if (read.ok) return read
    last = read
    if (!read.error.includes('不属于')) return read
  }
  return last
}

async function accountIds(sb: SupabaseClient, clientId: string): Promise<string[] | null> {
  try {
    const listed = await sb.from('client_meta_ad_accounts').select('ad_account_id').eq('client_id', clientId)
    if (listed.error) return null
    const ids = idsOf(listed.data)
    if (ids.length > 0) return ids
    return fallbackAccount(sb, clientId)
  } catch {
    return null
  }
}

async function fallbackAccount(sb: SupabaseClient, clientId: string): Promise<string[] | null> {
  const row = await sb.from('clients').select('meta_ad_account_id').eq('id', clientId).maybeSingle()
  if (row.error) return null
  const id = (row.data as { meta_ad_account_id?: unknown } | null)?.meta_ad_account_id
  return typeof id === 'string' && id.length > 0 ? [id] : []
}

function idsOf(data: unknown): string[] {
  if (!Array.isArray(data)) return []
  return data
    .map((row) => (row && typeof row === 'object' ? (row as { ad_account_id?: unknown }).ad_account_id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}
