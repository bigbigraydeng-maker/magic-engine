/**
 * 广告设置快照 · 取数与写库（ads IMPACT 阶段 1，设计 §2.1 / §14 M1 / M9）。
 *
 * 🔴 对 Meta 只读（`@/lib/meta/entity-settings` 只有 GET）。对库只 insert。
 * 🔴 共用账户读侧隔离（M9）：同一广告账户登记给多个客户时只写 account 级并标 shared_account，
 *    绝不把另一客户的系列/广告组/广告/受众写进本客户名下。
 * 🔴 每一轮、每个账户、每个层级都在 `ad_snapshot_captures` 留一条「抓过了没有、抓全了没有」
 *    （子牙复审 B1）——快照两行之间隔几天是正常的，只有这张表能分出「真没变」和「没抓到」。
 *
 * 每个账户独立降级：一个账户读失败不影响其它账户；读不全的层级**不写快照行、也不判消失**。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { findSharedAdAccounts } from '@/lib/meta/client-ad-accounts'
import {
  fetchAccountSettings,
  fetchAdSettings,
  fetchAdsetSettings,
  fetchCampaignSettings,
  fetchCustomAudiences,
  type GraphReadResult,
} from '@/lib/meta/entity-settings'
import {
  normalizeAccount,
  normalizeAd,
  normalizeAdset,
  normalizeAudience,
  normalizeCampaign,
  selectRowsToWrite,
  type EntitySnapshotRow,
  type LatestSnapshotRef,
  type SnapshotContext,
  type SnapshotLevel,
  type SnapshotRowDraft,
} from './snapshot'

export function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

const ENTITY_LEVELS: readonly SnapshotLevel[] = ['campaign', 'adset', 'ad', 'audience']
/** 读「上一行」的窗口。实体每天至少有一行 daily；超过窗口没见过的按 first_seen 记。 */
const LATEST_WINDOW_DAYS = 30
/** PostgREST 单次最多返回 1000 行（2026-09-14 魏征实测），分页读。 */
const PAGE = 1000

type CaptureRunReason = 'scheduled' | 'kernel_pre' | 'kernel_post'

export interface LevelCapture {
  level: SnapshotLevel
  complete: boolean
  skipped_shared: boolean
  rows_written: number
  error: string | null
}

export interface AccountSnapshotResult {
  ad_account_id: string
  shared_account: boolean
  rows_written: number
  levels: LevelCapture[]
  /** 本账户整体失败的原因（账户读不到、上一行读不到、写库失败） */
  error: string | null
}

export interface ClientSnapshotResult {
  client_id: string
  success: boolean
  accounts: AccountSnapshotResult[]
  error?: string
}

/** 按 IANA 时区切「哪一天」。时区缺失时按 UTC。 */
export function dayKeyIn(timezone: string | null): (iso: string) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return (iso: string) => fmt.format(new Date(iso))
}

/** 快照表在不在（migration 未 apply 时，cron 开头就跳过，不白读 Meta）。绝不抛。 */
export async function snapshotTablesExist(): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([
      supabaseAdmin.from('ad_entity_snapshots').select('id').limit(1),
      supabaseAdmin.from('ad_snapshot_captures').select('id').limit(1),
    ])
    return !a.error && !b.error
  } catch {
    return false
  }
}

async function loadLatest(clientId: string, adAccountId: string): Promise<{ rows: LatestSnapshotRef[]; error?: string }> {
  const since = new Date(Date.now() - LATEST_WINDOW_DAYS * 86_400_000).toISOString()
  const rows: LatestSnapshotRef[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('ad_entity_snapshots')
      .select('level, entity_id, settings_hash, capture_reason, captured_at')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) return { rows: [], error: error.message }
    const page = (data ?? []) as LatestSnapshotRef[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return { rows }
}

async function recordCaptures(
  clientId: string,
  adAccountId: string,
  capturedAt: string,
  reason: CaptureRunReason,
  levels: LevelCapture[],
): Promise<string | null> {
  const { error } = await supabaseAdmin.from('ad_snapshot_captures').insert(levels.map(l => ({
    client_id: clientId,
    ad_account_id: adAccountId,
    level: l.level,
    captured_at: capturedAt,
    complete: l.complete,
    skipped_shared: l.skipped_shared,
    rows_written: l.rows_written,
    error: l.error,
    capture_reason: reason,
  })))
  return error ? error.message : null
}

function takeLevel<T>(
  level: SnapshotLevel,
  read: GraphReadResult<T>,
  map: (item: T) => SnapshotRowDraft,
  drafts: SnapshotRowDraft[],
  levels: LevelCapture[],
): void {
  if (!read.complete) {
    // 读到一半失败：前几页的行也不写，否则会把「没读到的实体」在下一层判断里当成缺失
    levels.push({ level, complete: false, skipped_shared: false, rows_written: 0, error: read.error?.message ?? 'incomplete read' })
    return
  }
  for (const item of read.rows) drafts.push(map(item))
  levels.push({ level, complete: true, skipped_shared: false, rows_written: 0, error: null })
}

export async function captureAccountSnapshots(
  clientId: string,
  adAccountId: string,
  accessToken: string,
  opts: { shared: boolean; reason?: CaptureRunReason; now?: Date },
): Promise<AccountSnapshotResult> {
  const reason: CaptureRunReason = opts.reason ?? 'scheduled'
  const capturedAt = (opts.now ?? new Date()).toISOString()
  const result: AccountSnapshotResult = { ad_account_id: adAccountId, shared_account: opts.shared, rows_written: 0, levels: [], error: null }

  const account = await fetchAccountSettings(adAccountId, accessToken)
  if (!account.complete || account.rows.length === 0) {
    result.error = account.error?.message ?? 'account unreadable'
    result.levels = [
      { level: 'account', complete: false, skipped_shared: false, rows_written: 0, error: result.error },
      ...ENTITY_LEVELS.map(level => ({ level, complete: false, skipped_shared: opts.shared, rows_written: 0, error: 'account unreadable' })),
    ]
    await recordCaptures(clientId, adAccountId, capturedAt, reason, result.levels)
    return result
  }
  const acct = account.rows[0]
  const ctx: SnapshotContext = { clientId, adAccountId, currency: acct.currency ?? null, sharedAccount: opts.shared }
  const drafts: SnapshotRowDraft[] = [normalizeAccount(ctx, acct)]
  const levels: LevelCapture[] = [{ level: 'account', complete: true, skipped_shared: false, rows_written: 0, error: null }]

  if (opts.shared) {
    for (const level of ENTITY_LEVELS) levels.push({ level, complete: false, skipped_shared: true, rows_written: 0, error: null })
  } else {
    const [campaigns, adsets, ads, audiences] = await Promise.all([
      fetchCampaignSettings(adAccountId, accessToken),
      fetchAdsetSettings(adAccountId, accessToken),
      fetchAdSettings(adAccountId, accessToken),
      fetchCustomAudiences(adAccountId, accessToken),
    ])
    takeLevel('campaign', campaigns, c => normalizeCampaign(ctx, c), drafts, levels)
    takeLevel('adset', adsets, s => normalizeAdset(ctx, s), drafts, levels)
    takeLevel('ad', ads, a => normalizeAd(ctx, a), drafts, levels)
    takeLevel('audience', audiences, a => normalizeAudience(ctx, a), drafts, levels)
  }
  result.levels = levels

  const latest = await loadLatest(clientId, adAccountId)
  if (latest.error) {
    // 读不到上一行就判不了「变没变 / 消失没有」——宁可本轮不写快照，也不全量写成 first_seen 污染历史。
    result.error = `latest snapshot read failed: ${latest.error}`
    for (const l of levels) { l.complete = false; l.error = l.error ?? result.error }
    await recordCaptures(clientId, adAccountId, capturedAt, reason, levels)
    return result
  }

  const completeLevels = new Set(levels.filter(l => l.complete).map(l => l.level))
  const rows: EntitySnapshotRow[] = selectRowsToWrite(drafts, latest.rows, {
    capturedAt,
    dayKey: dayKeyIn(acct.timezone_name ?? null),
    reason,
    completeLevels,
    ctx,
  })

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabaseAdmin.from('ad_entity_snapshots').insert(chunk)
    if (error) {
      result.error = `insert failed: ${error.message}`
      for (const l of levels) { l.complete = false; l.error = l.error ?? result.error }
      break
    }
    for (const r of chunk) {
      const lc = levels.find(l => l.level === r.level)
      if (lc) lc.rows_written += 1
    }
    result.rows_written += chunk.length
  }

  const captureError = await recordCaptures(clientId, adAccountId, capturedAt, reason, levels)
  if (captureError && !result.error) result.error = `capture record failed: ${captureError}`
  return result
}

/**
 * 抓一个客户全部登记账户的设置快照。阶段 2 内核运行前后以 kernel_pre / kernel_post 调用。
 */
export async function captureClientSnapshots(
  clientId: string,
  accountIds: string[],
  opts: { reason?: CaptureRunReason; now?: Date } = {},
): Promise<ClientSnapshotResult> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return { client_id: clientId, success: false, accounts: [], error: 'no Meta token configured for client' }

  const { shared, error: sharedError } = await findSharedAdAccounts(clientId, accountIds)
  const accounts: AccountSnapshotResult[] = []
  for (const id of accountIds) {
    accounts.push(await captureAccountSnapshots(clientId, id, token, {
      shared: shared.has(normalizeAccountId(id)),
      reason: opts.reason,
      now: opts.now,
    }))
  }
  const success = !sharedError && accounts.every(a => !a.error && a.levels.every(l => l.complete || l.skipped_shared))
  return {
    client_id: clientId,
    success,
    accounts,
    error: sharedError ? `shared-account lookup failed (treated all as shared): ${sharedError}` : undefined,
  }
}

export interface SnapshotClient {
  id: string
  name: string | null
}

/**
 * 要抓快照的客户：登记了 Meta 广告账户（老列或多账户表）且未归档。
 *
 * 🔴 不按 client_status='active' 过滤（魏征复审 B1）：生产 NAL 状态是 prospect，但广告在投、
 *    广告引擎开着，恰是本设计的样本客户。与每日数据同步 cron 的客户口径对齐（它也不看状态），
 *    只额外排除 archived。广告引擎客户开关由调用方判。
 */
export async function listSnapshotClients(): Promise<SnapshotClient[]> {
  const [legacy, registry] = await Promise.all([
    supabaseAdmin.from('clients').select('id, name, client_status').not('meta_ad_account_id', 'is', null),
    supabaseAdmin.from('client_meta_ad_accounts').select('client_id'),
  ])
  if (legacy.error) throw new Error(`读客户列表失败：${legacy.error.message}`)
  if (registry.error) throw new Error(`读多账户登记表失败：${registry.error.message}`)

  const byId = new Map<string, { id: string; name: string | null; client_status: string | null }>()
  for (const c of (legacy.data ?? []) as Array<{ id: string; name: string | null; client_status: string | null }>) byId.set(c.id, c)

  const extraIds = [...new Set(((registry.data ?? []) as Array<{ client_id: string }>).map(r => r.client_id))].filter(id => !byId.has(id))
  if (extraIds.length > 0) {
    const extra = await supabaseAdmin.from('clients').select('id, name, client_status').in('id', extraIds)
    if (extra.error) throw new Error(`读客户列表失败：${extra.error.message}`)
    for (const c of (extra.data ?? []) as Array<{ id: string; name: string | null; client_status: string | null }>) byId.set(c.id, c)
  }
  return [...byId.values()].filter(c => c.client_status !== 'archived').map(c => ({ id: c.id, name: c.name }))
}
