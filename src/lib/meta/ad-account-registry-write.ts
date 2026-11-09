/**
 * 改一个客户的主广告账户：clients.meta_ad_account_id + client_meta_ad_accounts
 * 两处一起改，任何一步失败都尽力恢复原状（AD-SEC-3）。
 *
 * ── 为什么要「旧账户去留」这个显式选择 ──────────────────────────────────
 * 归属校验（campaign-ownership.ts）认这个客户在登记表里的**所有**行，不看
 * is_primary。以前改绑只把旧主账户降级、不删 —— 于是 FDE 纠正一次误绑后，
 * 那个错账户照样对这个客户开放「停广告 / 改预算」（子牙 + 魏征实施审）。
 * 现在默认把旧主账户从这个客户名下移除；确实是同一客户的第二个账户（如 CTS
 * 个人号 + 官方账户）时，FDE 勾选「保留为第二账户」才留下，并记进审计。
 *
 * ── 为什么要回滚 ─────────────────────────────────────────────────────────
 * 两张表不在一个事务里。只写了一半时，数据同步用新号、归属校验还认旧号，
 * 界面却只说「保存失败」—— 那是假话。失败时按写前快照把两处都恢复；
 * 恢复也失败才如实报「只写了一半」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { canonicalAccountDigits } from './ad-account-binding'

interface RegistryRow {
  id: string
  client_id: string
  ad_account_id: string
  label: string | null
  is_primary: boolean
}

export interface PrimaryChange {
  clientId: string
  previous: string | null
  next: string | null
  keepPrevious: boolean
}

export type PrimaryChangeResult =
  | { ok: true; removedPrevious: boolean }
  | { ok: false; error: string; rolledBack: boolean }

const TABLE = 'client_meta_ad_accounts'
const same = (a: string, b: string) => canonicalAccountDigits(a) === canonicalAccountDigits(b)

async function snapshot(clientId: string): Promise<RegistryRow[] | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id, client_id, ad_account_id, label, is_primary')
    .eq('client_id', clientId)
  if (error) return { error: error.message }
  return (data ?? []) as RegistryRow[]
}

/** 把 next 设成主账户：已登记（任意写法）就原行提升并规范写法，否则新插一行。 */
async function promote(clientId: string, next: string, rows: RegistryRow[]): Promise<string | null> {
  // 精确写法优先：同一账户若存了两种写法，改写另一行会撞 (client_id, ad_account_id) 唯一约束。
  const existing = rows.find(r => r.ad_account_id === next) ?? rows.find(r => same(r.ad_account_id, next))
  if (existing) {
    const { error } = await supabaseAdmin.from(TABLE).update({ ad_account_id: next, is_primary: true }).eq('id', existing.id)
    return error ? `promote: ${error.message}` : null
  }
  const { error } = await supabaseAdmin
    .from(TABLE)
    .insert({ client_id: clientId, ad_account_id: next, is_primary: true, label: '主账户' })
  return error ? `insert: ${error.message}` : null
}

async function applySteps(change: PrimaryChange, rows: RegistryRow[]): Promise<{ error: string | null; removed: boolean }> {
  const { clientId, previous, next, keepPrevious } = change

  const { error: demoteErr } = await supabaseAdmin.from(TABLE).update({ is_primary: false }).eq('client_id', clientId).eq('is_primary', true)
  if (demoteErr) return { error: `demote: ${demoteErr.message}`, removed: false }

  if (next) {
    const err = await promote(clientId, next, rows)
    if (err) return { error: err, removed: false }
  }

  const stale = previous && !keepPrevious && !(next && same(previous, next))
    ? rows.filter(r => same(r.ad_account_id, previous)).map(r => r.id)
    : []
  if (stale.length > 0) {
    const { error } = await supabaseAdmin.from(TABLE).delete().in('id', stale)
    if (error) return { error: `remove previous: ${error.message}`, removed: false }
  }

  const { error: clientsErr } = await supabaseAdmin.from('clients').update({ meta_ad_account_id: next }).eq('id', clientId)
  if (clientsErr) return { error: `clients: ${clientsErr.message}`, removed: false }
  return { error: null, removed: stale.length > 0 }
}

/** 按快照恢复两处。返回是否完全恢复。 */
async function rollback(change: PrimaryChange, rows: RegistryRow[]): Promise<boolean> {
  const { clientId, previous } = change
  const results = [
    await supabaseAdmin.from('clients').update({ meta_ad_account_id: previous }).eq('id', clientId),
    await supabaseAdmin.from(TABLE).update({ is_primary: false }).eq('client_id', clientId),
  ]
  const current = await snapshot(clientId)
  if ('error' in current) return false
  const keepIds = new Set(rows.map(r => r.id))
  const extra = current.filter(r => !keepIds.has(r.id)).map(r => r.id)
  if (extra.length > 0) results.push(await supabaseAdmin.from(TABLE).delete().in('id', extra))
  // 非主账户先恢复、主账户最后：每客户只许一个 is_primary 的唯一索引。
  const ordered = [...rows].sort((a, b) => Number(a.is_primary) - Number(b.is_primary))
  for (const r of ordered) {
    results.push(await supabaseAdmin.from(TABLE).upsert({ ...r }, { onConflict: 'id' }))
  }
  return results.every(r => !r.error)
}

export async function applyPrimaryChange(change: PrimaryChange): Promise<PrimaryChangeResult> {
  const rows = await snapshot(change.clientId)
  if ('error' in rows) return { ok: false, error: `read registry: ${rows.error}`, rolledBack: true }

  const { error, removed } = await applySteps(change, rows)
  if (!error) return { ok: true, removedPrevious: removed }

  const rolledBack = await rollback(change, rows)
  return { ok: false, error, rolledBack }
}
