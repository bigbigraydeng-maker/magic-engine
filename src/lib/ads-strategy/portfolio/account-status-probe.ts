/**
 * 账户状态快速探测：只读 Meta 的账户级信息，状态变了才写一行账户级快照。
 *
 * 为什么存在：完整设置快照每 6 小时一次，欠款（状态 3）最坏要 6 小时才被读到。
 * 这里挂在每 2 小时一次的线索同步 cron 上，把读状态的最坏延迟缩到约 2 小时。
 *
 * 🔴 对 Meta 只读（只调 `fetchAccountSettings`，一次 GET）。
 * 🔴 对库只 insert，且只写 `ad_entity_snapshots` 的 level='account'、状态相对上一行变了（changed / first_seen）的行；
 *    不写 `ad_snapshot_captures`，不碰系列 / 广告组 / 广告 / 受众层级。
 * 🔴 隐藏账户（hidden_from_ad_health）照样探：隐藏只管健康页显示，管不了「账户不能花钱」这件事。
 * 🔴 单个账户失败只记进结果，不抛；整轮失败也不能影响调用方（线索同步）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { getClientAdAccounts, findSharedAdAccounts } from '@/lib/meta/client-ad-accounts'
import { fetchAccountSettings } from '@/lib/meta/entity-settings'
import { normalizeAccount, selectRowsToWrite, type LatestSnapshotRef, type SnapshotContext } from './snapshot'
import { dayKeyIn, listSnapshotClients, normalizeAccountId } from './snapshot-sync'

/** 读「上一行」的窗口：账户级行至少每天一条 daily，30 天足够。 */
const LATEST_WINDOW_DAYS = 30
const LATEST_LIMIT = 50

export type AccountProbeState = 'written' | 'unchanged' | 'unreadable' | 'error'

export interface AccountProbeResult {
  clientId: string
  adAccountId: string
  state: AccountProbeState
  error?: string
}

export interface AccountStatusProbeSummary {
  clients: number
  accounts: number
  written: number
  unchanged: number
  failed: number
  results: AccountProbeResult[]
  error?: string
}

async function loadLatestAccountRows(
  clientId: string,
  adAccountId: string,
  now: Date,
): Promise<LatestSnapshotRef[]> {
  const since = new Date(now.getTime() - LATEST_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('level, entity_id, settings_hash, capture_reason, captured_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('level', 'account')
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(LATEST_LIMIT)
  if (error) throw new Error(`latest account snapshot read failed: ${error.message}`)
  return (data ?? []) as LatestSnapshotRef[]
}

/** 探一个账户。读不到 / 读库失败 / 写库失败都返回结果，不抛。 */
export async function probeAccountStatus(
  clientId: string,
  adAccountId: string,
  accessToken: string,
  opts: { shared: boolean; now?: Date },
): Promise<AccountProbeResult> {
  const now = opts.now ?? new Date()
  const base = { clientId, adAccountId }
  try {
    const account = await fetchAccountSettings(adAccountId, accessToken)
    if (!account.complete || account.rows.length === 0) {
      return { ...base, state: 'unreadable', error: account.error?.message ?? 'account unreadable' }
    }
    const acct = account.rows[0]
    const ctx: SnapshotContext = { clientId, adAccountId, currency: acct.currency ?? null, sharedAccount: opts.shared }
    const latest = await loadLatestAccountRows(clientId, adAccountId, now)
    const rows = selectRowsToWrite([normalizeAccount(ctx, acct)], latest, {
      capturedAt: now.toISOString(),
      dayKey: dayKeyIn(acct.timezone_name ?? null),
    }).filter(r => r.level === 'account' && (r.capture_reason === 'changed' || r.capture_reason === 'first_seen'))
    if (rows.length === 0) return { ...base, state: 'unchanged' }
    const { error } = await supabaseAdmin.from('ad_entity_snapshots').insert(rows)
    if (error) return { ...base, state: 'error', error: `insert failed: ${error.message}` }
    return { ...base, state: 'written' }
  } catch (err) {
    return { ...base, state: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/** 探全部登记了 Meta 广告账户的客户（含隐藏账户）。永不抛。 */
export async function probeAllAccountStatuses(now: Date = new Date()): Promise<AccountStatusProbeSummary> {
  const summary: AccountStatusProbeSummary = { clients: 0, accounts: 0, written: 0, unchanged: 0, failed: 0, results: [] }
  try {
    const clients = await listSnapshotClients()
    summary.clients = clients.length
    for (const client of clients) {
      try {
        const token = await getMetaTokenForClient(client.id)
        if (!token) continue
        const accounts = await getClientAdAccounts(client.id)
        if (accounts.length === 0) continue
        const { shared } = await findSharedAdAccounts(client.id, accounts.map(a => a.adAccountId))
        for (const a of accounts) {
          const result = await probeAccountStatus(client.id, a.adAccountId, token, {
            shared: shared.has(normalizeAccountId(a.adAccountId)),
            now,
          })
          summary.accounts += 1
          if (result.state === 'written') summary.written += 1
          else if (result.state === 'unchanged') summary.unchanged += 1
          else summary.failed += 1
          summary.results.push(result)
        }
      } catch (err) {
        summary.failed += 1
        summary.results.push({
          clientId: client.id,
          adAccountId: '',
          state: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err)
  }
  return summary
}
