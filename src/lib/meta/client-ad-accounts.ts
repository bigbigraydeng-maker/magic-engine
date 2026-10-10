/**
 * Client ↔ Meta ad account lookup — the multi-account read path.
 *
 * `clients.meta_ad_account_id` is a single-value column and stays that way:
 * it remains the "primary account" used by every single-account call site
 * (boost-post, draft-listing, draft, comment-autoreply, campaign-ownership's
 * fallback, the settings write route). This module is only for the two kinds
 * of callers that must see EVERY account a client runs: the daily sync cron
 * and the daily safety/readback sweep.
 *
 * Backed by `client_meta_ad_accounts` (2026-09-13, CTS multi-account gap fix:
 * CTS runs a second Meta ad account — act_2202695063810470, "CTStours 官方
 * 账户" — that `meta_ad_account_id` never captured, so its ThruPlay spend was
 * invisible to reporting and health checks).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

export interface ClientAdAccount {
  adAccountId: string
  label: string | null
  isPrimary: boolean
}

export interface ActiveMetaClient {
  id: string
  name: string
  meta_ad_account_id: string | null
}

/**
 * All Meta ad accounts registered for a client, primary first.
 *
 * Falls back to `clients.meta_ad_account_id` when the client has zero rows in
 * `client_meta_ad_accounts` — covers any client onboarded before this table
 * existed, or a future write to `meta_ad_account_id` that hasn't been mirrored
 * into the new table yet. Callers should not need to know which source fired.
 */
export async function getClientAdAccounts(clientId: string): Promise<ClientAdAccount[]> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, label, is_primary')
    .eq('client_id', clientId)
    .order('is_primary', { ascending: false })

  if (error) {
    console.error('[meta/client-ad-accounts] query failed:', error.message)
  } else if (data && data.length > 0) {
    return (data as Array<{ ad_account_id: string; label: string | null; is_primary: boolean }>).map(row => ({
      adAccountId: row.ad_account_id,
      label: row.label,
      isPrimary: row.is_primary,
    }))
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError) {
    console.error('[meta/client-ad-accounts] fallback query failed:', clientError.message)
    return []
  }
  const primary = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
  return primary ? [{ adAccountId: primary, label: '主账户', isPrimary: true }] : []
}

function stripActPrefix(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

/**
 * 这些账户里，哪些同时登记给了别的客户（ads IMPACT §14 M9 共用账户读侧隔离）。
 *
 * 2026-09-14 生产实查：Roman HU 与 30 Kiteroa 同登记 act_1260456876069575。
 * 查询出错时 **fail closed**：全部当共用处理——宁可少读，也不能把别人的实体写进本客户名下。
 * 返回的 id 已去掉 act_ 前缀。
 */
export async function findSharedAdAccounts(
  clientId: string,
  accountIds: string[],
): Promise<{ shared: Set<string>; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('client_id, ad_account_id')
  if (error) {
    return { shared: new Set(accountIds.map(stripActPrefix)), error: error.message }
  }
  const owners = new Map<string, Set<string>>()
  for (const r of (data ?? []) as Array<{ client_id: string; ad_account_id: string }>) {
    const key = stripActPrefix(r.ad_account_id)
    const set = owners.get(key) ?? new Set<string>()
    set.add(r.client_id)
    owners.set(key, set)
  }
  const shared = new Set<string>()
  for (const id of accountIds) {
    const set = owners.get(stripActPrefix(id))
    if (set && [...set].some(c => c !== clientId)) shared.add(stripActPrefix(id))
  }
  return { shared }
}

/** Just the account id strings, primary first. Convenience for sync loops. */
export async function getClientAdAccountIds(clientId: string): Promise<string[]> {
  return (await getClientAdAccounts(clientId)).map(a => a.adAccountId)
}

/**
 * Active clients with at least one Meta ad account on file — checking BOTH
 * the legacy `meta_ad_account_id` column and `client_meta_ad_accounts`.
 *
 * Why not just filter on `meta_ad_account_id IS NOT NULL`: a client's primary
 * account can be cleared via the settings route (`meta-ad-account/route.ts`)
 * while a secondary account stays registered in `client_meta_ad_accounts`.
 * Filtering on the old column alone would silently drop that client from
 * every daily sync/scan that calls this — exactly the invisibility bug this
 * table exists to close, just triggered a different way (2026-09-13 review,
 * 子牙 + 魏征). Callers: `readback-sweep.ts`'s daily safety scan.
 *
 * Unlike `getClientAdAccounts`, this throws on a query error rather than
 * degrading to an empty list — callers here are the "candidate list" step
 * for a full sweep, and a silent empty result here would read as "no active
 * clients have ads" instead of "couldn't check."
 */
export async function getActiveClientsWithMetaAccounts(
  supabase: SupabaseClient,
): Promise<ActiveMetaClient[]> {
  const { data: legacyClients, error: legacyError } = await supabase
    .from('clients')
    .select('id, name, meta_ad_account_id')
    .eq('client_status', 'active')
    .not('meta_ad_account_id', 'is', null)
  if (legacyError) throw new Error(`读客户列表失败：${legacyError.message}`)

  const { data: registeredRows, error: registeredError } = await supabase
    .from('client_meta_ad_accounts')
    .select('client_id')
  if (registeredError) throw new Error(`读多账户登记表失败：${registeredError.message}`)

  const known = new Set(((legacyClients ?? []) as ActiveMetaClient[]).map(c => c.id))
  const extraIds = [
    ...new Set(((registeredRows ?? []) as Array<{ client_id: string }>).map(r => r.client_id)),
  ].filter(id => !known.has(id))

  let extraClients: ActiveMetaClient[] = []
  if (extraIds.length > 0) {
    const { data: extraData, error: extraError } = await supabase
      .from('clients')
      .select('id, name, meta_ad_account_id')
      .eq('client_status', 'active')
      .in('id', extraIds)
    if (extraError) throw new Error(`读客户列表失败：${extraError.message}`)
    extraClients = (extraData ?? []) as ActiveMetaClient[]
  }

  return [...((legacyClients ?? []) as ActiveMetaClient[]), ...extraClients]
}
