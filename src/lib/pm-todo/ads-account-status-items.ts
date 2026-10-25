/**
 * 「Meta 广告账户状态不是正常、已经超过 24 小时」→ 下发到「需要你动手」。
 *
 * 判据是**账户状态本身**（`account_status` 不是 1），不是花费、不是熔断：
 * 欠款、被限制、被关闭的账户不会花钱、不会有新线索，但系统里没有任何别的
 * 地方会主动说这件事。这里把它变成一条待办。
 *
 * 三种情况：
 * - `ads_account_not_active`：状态不是 1、且已经持续至少 24 小时；欠款（码 3）一读到就出。
 * - `ads_account_status_unreadable`：读不到状态（最近一次完整读取过期、
 *   快照行是空的、最新一行是「账户消失」、或状态字段为空）。这是系统自己
 *   的问题，不是客户的问题，所以文案里明确说「不用你操作」。
 * - `ads_account_closed_weekly`：账户已经关闭（码 2/100/101），不会再花钱，
 *   但客户名下还登记着它——每周一提醒一次去解绑或申诉。
 *
 * 拉模式：每次调用都重新读快照、重新判断，不存任何「已提醒」标记。
 * 状态恢复正常后待办自动消失；关闭账户的提醒靠 ISO 周号自然每周只出现一次。
 *
 * 范围：**只看当前还登记在客户名下的账户**。已经解绑的账户即使快照里还有
 * 历史行也不评估——解绑本身就是「不用了」的表达，不需要再提醒。
 *
 * 本文件一行写操作都没有：只读快照、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { getActiveClientsWithMetaAccounts, getClientAdAccounts } from '@/lib/meta/client-ad-accounts'
import {
  loadAccountStatusRows,
  isClosedAccountStatus,
  accountStatusHint,
  normalizeAdAccountId,
  ACCOUNT_STATUS_ACTIVE,
  ACCOUNT_STATUS_UNSETTLED,
  DISAPPEARED_CAPTURE_REASON,
  type AccountStatusRow,
} from '@/lib/ads-strategy/account-status'
import { nzDay, hoursSince } from '@/lib/ads-strategy/war-map/util'

export type AdsAccountStatusItemKind =
  | 'ads_account_not_active'
  | 'ads_account_status_unreadable'
  | 'ads_account_closed_weekly'

/** 状态不是 1 至少持续这么久，才值得打扰人（欠款除外，见下）。 */
export const ACCOUNT_NOT_ACTIVE_MIN_HOURS = 24

/** 欠款（码 3）一读到就下发：不花钱、不出线索的每一小时都是损失，状态本身最慢也只隔约 2 小时才读一次。 */
export const ACCOUNT_UNSETTLED_MIN_HOURS = 0

function minHoursFor(status: number): number {
  return status === ACCOUNT_STATUS_UNSETTLED ? ACCOUNT_UNSETTLED_MIN_HOURS : ACCOUNT_NOT_ACTIVE_MIN_HOURS
}

const HIDDEN_NOTE =
  '这个账户在健康页是隐藏的，但里面开着的系列一旦还款会立刻继续花钱：还款后要马上暂停（要还款先通知广告总控）。'

/** 最近一次完整账户级快照超过这么久没更新，就认为「读不到」。 */
export const ACCOUNT_CAPTURE_STALE_HOURS = 36

/** 往回读多少天的账户快照行。 */
export const ACCOUNT_STATUS_LOOKBACK_DAYS = 30

/** 读 `ad_snapshot_captures` 时往回看多少天（只需要「最近一次完整读取」）。 */
const CAPTURE_LOOKBACK_DAYS = 7

/** 一次查询最多取多少条 capture 行。 */
const CAPTURE_QUERY_LIMIT = 500

export interface AccountStatusFinding {
  key: string
  item: ManualItem
}

export interface AccountStatusEvalInput {
  clientId: string
  clientName: string
  /** 登记时的账户 id，可能带 `act_` 前缀。 */
  adAccountId: string
  /** 已知的展示名，没有就是 null。 */
  accountName: string | null
  /** 这个账户的账户级快照行，最新的在前。 */
  rows: readonly AccountStatusRow[]
  /** 这个账户最近一次 level='account' 且 complete=true 的 capture 时间；没有就是 null。 */
  lastCompleteCaptureAt: string | null
  /** 这个账户在健康页被隐藏（hidden_from_ad_health）；隐藏不等于里面没有在投的系列。读不到就当 false。 */
  hidden?: boolean
  now: Date
}

const UNREADABLE_HOW =
  '这是系统自己的问题，不用你操作：让开发查一下广告设置快照任务为什么没读到这个账户。'

function adsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

function accountLabel(adAccountId: string, accountName: string | null): string {
  return accountName ? `${accountName}（${adAccountId}）` : adAccountId
}

function durationText(hours: number): string {
  return hours < 48 ? `${Math.floor(hours)} 小时` : `${Math.floor(hours / 24)} 天`
}

/**
 * 标准 ISO-8601 周号：把日期挪到那一周的周四，用周四所在的年份和
 * 「一年中的第几天」算周号。返回形如 `2026-W42`。
 */
function isoWeekKey(day: string): string {
  const [yStr, mStr, dStr] = day.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const d = Number(dStr)
  const utc = Date.UTC(y, m - 1, d)
  const dow = new Date(utc).getUTCDay() // 0=Sun..6=Sat
  const isoDow = dow === 0 ? 7 : dow
  const thursday = utc + (4 - isoDow) * 86_400_000
  const thursdayDate = new Date(thursday)
  const isoYear = thursdayDate.getUTCFullYear()
  const yearStart = Date.UTC(isoYear, 0, 1)
  const dayOfYear = Math.floor((thursday - yearStart) / 86_400_000) + 1
  const week = 1 + Math.floor((dayOfYear - 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

function isMondayInNz(now: Date): boolean {
  const day = nzDay(now.toISOString())
  const [yStr, mStr, dStr] = day.split('-')
  const utc = Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr))
  return new Date(utc).getUTCDay() === 1
}

/** 读不到状态的四种情况，任一成立就返回 true。 */
function isUnreadable(input: AccountStatusEvalInput): boolean {
  if (input.lastCompleteCaptureAt === null) return true
  const age = hoursSince(input.lastCompleteCaptureAt, input.now.toISOString())
  if (age === null || age > ACCOUNT_CAPTURE_STALE_HOURS) return true
  if (input.rows.length === 0) return true
  const newest = input.rows[0]
  if (newest.capture_reason === DISAPPEARED_CAPTURE_REASON) return true
  if (newest.account_status === null) return true
  return false
}

/**
 * 从最新一行往回走，找到「当前这段不是正常」的起点。
 * 跳过状态为空 / 账户消失的行；遇到状态 1 就停；其余行都算在这段里。
 * 返回这段里最老一行的 captured_at；一行都没有就返回 null。
 */
function findNotActiveOnset(rows: readonly AccountStatusRow[]): string | null {
  let onset: string | null = null
  for (const row of rows) {
    if (row.account_status === null) continue
    if (row.capture_reason === DISAPPEARED_CAPTURE_REASON) continue
    if (row.account_status === ACCOUNT_STATUS_ACTIVE) break
    onset = row.captured_at
  }
  return onset
}

function buildUnreadableFinding(input: AccountStatusEvalInput): AccountStatusFinding {
  const label = accountLabel(input.adAccountId, input.accountName)
  return {
    key: `ads_account_status_unreadable:${input.clientId}:${normalizeAdAccountId(input.adAccountId)}`,
    item: {
      kind: 'ads_account_status_unreadable',
      client_id: input.clientId,
      client_name: input.clientName,
      what: `账户 ${label} 的 Meta 广告账户状态读不到（最近一次完整读取已过期，或读到的状态为空），所以判不了它有没有欠款或被限制。`,
      how: UNREADABLE_HOW,
      href: adsHealthHref(input.clientId),
    },
  }
}

function buildClosedWeeklyFinding(
  input: AccountStatusEvalInput,
  status: number,
): AccountStatusFinding {
  const label = accountLabel(input.adAccountId, input.accountName)
  const weekKey = isoWeekKey(nzDay(input.now.toISOString()))
  return {
    key: `ads_account_closed_weekly:${input.clientId}:${normalizeAdAccountId(input.adAccountId)}:${weekKey}`,
    item: {
      kind: 'ads_account_closed_weekly',
      client_id: input.clientId,
      client_name: input.clientName,
      what: `账户 ${label} 的 Meta 广告账户已经关闭（码 ${status}），不会再花钱，但客户名下还登记着它。`,
      how: '确认这个账户确实不用了，就在客户设置里把它解绑；还要用就去 Meta 后台申诉恢复。这条每周一提醒一次。',
      href: adsHealthHref(input.clientId),
    },
  }
}

function buildNotActiveFinding(
  input: AccountStatusEvalInput,
  status: number,
  hours: number,
): AccountStatusFinding {
  const label = accountLabel(input.adAccountId, input.accountName)
  const hint = accountStatusHint(status)
  const hintPart = hint ? `，${hint}` : ''
  return {
    key: `ads_account_not_active:${input.clientId}:${normalizeAdAccountId(input.adAccountId)}`,
    item: {
      kind: 'ads_account_not_active',
      client_id: input.clientId,
      client_name: input.clientName,
      what: `账户 ${label} 的 Meta 广告账户状态不是正常（码 ${status}${hintPart}），已经 ${durationText(hours)}；这期间不会花钱、不会有新线索。${input.hidden ? HIDDEN_NOTE : ''}`,
      how: '去 Meta 付款设置看扣款失败原因，结清并补上备用卡；结清后要看到当天有新数据、线索回流，才算恢复。账户恢复正常后这条会自动消失。',
      href: adsHealthHref(input.clientId),
    },
  }
}

export function evaluateAccountStatus(input: AccountStatusEvalInput): AccountStatusFinding | null {
  if (isUnreadable(input)) return buildUnreadableFinding(input)

  const status = input.rows[0].account_status
  if (status === null) return null // 理论上 isUnreadable 已挡住，防御性保留
  if (status === ACCOUNT_STATUS_ACTIVE) return null

  if (isClosedAccountStatus(status)) {
    return isMondayInNz(input.now) ? buildClosedWeeklyFinding(input, status) : null
  }

  const onset = findNotActiveOnset(input.rows)
  if (onset === null) return null
  const hours = hoursSince(onset, input.now.toISOString())
  if (hours === null || hours < minHoursFor(status)) return null
  return buildNotActiveFinding(input, status, hours)
}

/** 哪些账户在健康页被隐藏。读失败返回 null：调用方当「没隐藏」照常出待办，只少一句提示。 */
async function loadHiddenAccounts(supabase: SupabaseClient, clientId: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabase
      .from('client_meta_ad_accounts')
      .select('ad_account_id, hidden_from_ad_health')
      .eq('client_id', clientId)
    if (error || !Array.isArray(data)) return null
    const hidden = new Set<string>()
    for (const r of data as Array<{ ad_account_id: string; hidden_from_ad_health: boolean | null }>) {
      if (r.hidden_from_ad_health === true) hidden.add(normalizeAdAccountId(r.ad_account_id))
    }
    return hidden
  } catch {
    return null
  }
}

interface CaptureRow {
  ad_account_id: string
  captured_at: string
}

interface RegisteredAccount {
  adAccountId: string
  label: string | null
  isPrimary: boolean
}

function dedupeAccounts(accounts: readonly RegisteredAccount[]): RegisteredAccount[] {
  const seen = new Set<string>()
  const out: RegisteredAccount[] = []
  for (const a of accounts) {
    const key = normalizeAdAccountId(a.adAccountId)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

async function loadLastCompleteCaptures(
  supabase: SupabaseClient,
  clientId: string,
  sinceIso: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('ad_snapshot_captures')
    .select('ad_account_id, captured_at')
    .eq('client_id', clientId)
    .eq('level', 'account')
    .eq('complete', true)
    .gte('captured_at', sinceIso)
    .order('captured_at', { ascending: false })
    .limit(CAPTURE_QUERY_LIMIT)
  if (error) throw new Error(`ad_snapshot_captures 读取失败：${error.message}`)
  const rows = (data ?? []) as CaptureRow[]
  const map = new Map<string, string>()
  for (const row of rows) {
    const key = normalizeAdAccountId(row.ad_account_id)
    if (!map.has(key)) map.set(key, row.captured_at)
  }
  return map
}

/**
 * 「最近一次读到这个账户」的时间：完整快照的 capture，和最新一行有效账户行（含 2 小时探测写的）里取较新者。
 * 探测只写账户级快照行、不写 capture，所以账户刚登记 / 完整快照停摆时，欠款只能靠这行被认可。
 * 空状态和「账户消失」行不算读到。
 */
function freshestReadAt(capture: string | null, rows: readonly AccountStatusRow[]): string | null {
  const newest = rows[0]
  if (!newest || newest.account_status === null || newest.capture_reason === DISAPPEARED_CAPTURE_REASON) return capture
  if (capture === null) return newest.captured_at
  return Date.parse(newest.captured_at) > Date.parse(capture) ? newest.captured_at : capture
}

function rowsForAccount(
  rows: readonly AccountStatusRow[],
  normalizedId: string,
): AccountStatusRow[] {
  return rows.filter((r) => normalizeAdAccountId(r.ad_account_id) === normalizedId)
}

function newestEntityName(rows: readonly AccountStatusRow[]): string | null {
  for (const row of rows) {
    if (row.entity_name) return row.entity_name
  }
  return null
}

function buildClientErrorItem(
  clientId: string,
  clientName: string,
  message: string,
): ManualItem {
  return {
    kind: 'ads_account_status_unreadable',
    client_id: clientId,
    client_name: clientName,
    what: `读取这个客户的广告账户状态时出错了（${message}），所以判不了账户有没有欠款或被限制。`,
    how: UNREADABLE_HOW,
    href: adsHealthHref(clientId),
  }
}

async function evaluateClient(
  supabase: SupabaseClient,
  clientId: string,
  clientName: string,
  now: Date,
  items: ManualItem[],
): Promise<void> {
  const accounts = dedupeAccounts(await getClientAdAccounts(clientId))
  if (accounts.length === 0) return

  const sinceRows = new Date(now.getTime() - ACCOUNT_STATUS_LOOKBACK_DAYS * 86_400_000).toISOString()
  const sinceCaptures = new Date(now.getTime() - CAPTURE_LOOKBACK_DAYS * 86_400_000).toISOString()

  const rows = await loadAccountStatusRows(clientId, sinceRows)
  const captures = await loadLastCompleteCaptures(supabase, clientId, sinceCaptures)
  const hiddenAccounts = await loadHiddenAccounts(supabase, clientId)

  for (const account of accounts) {
    const normalizedId = normalizeAdAccountId(account.adAccountId)
    const accountRows = rowsForAccount(rows, normalizedId)
    const accountName = newestEntityName(accountRows) ?? account.label
    const finding = evaluateAccountStatus({
      clientId,
      clientName,
      adAccountId: account.adAccountId,
      accountName,
      rows: accountRows,
      lastCompleteCaptureAt: freshestReadAt(captures.get(normalizedId) ?? null, accountRows),
      hidden: hiddenAccounts?.has(normalizedId) ?? false,
      now,
    })
    if (finding) items.push(finding.item)
  }
}

export async function pushAdsAccountStatusItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const clients = await getActiveClientsWithMetaAccounts(supabase)
  for (const client of clients) {
    const clientName = nameOf(client.id)
    try {
      await evaluateClient(supabase, client.id, clientName, now, items)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      items.push(buildClientErrorItem(client.id, clientName, message))
    }
  }
}
