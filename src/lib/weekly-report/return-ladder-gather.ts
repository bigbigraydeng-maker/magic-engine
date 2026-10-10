/**
 * 周报「一本账」区块 · 只读取数（无写入、无 RPC）。
 *
 * 本文件只做三件事：把库里的事实读出来、把读不到的东西标成「不知道」、把纯计算交给
 * `return-ladder/compute`。任何判定 / 默认值都不在这里发生。
 *
 * 规矩：
 *  - 只允许 `.select(...)`；绝不 insert / update / upsert / delete / rpc。
 *  - 读不全（翻页到上限）→ 标 incomplete，交给纯计算判「判不了」，不把半截数当整数。
 *  - 读不到时区 / 币种 / 成交周期 → 原样传 null，不许用默认值糊过去。
 *  - 平台通用：本文件不出现任何客户 / 行业 / 广告平台的名字。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountYesterday, resolveClientEvaluationDate } from '@/lib/ads-strategy/account-timezone'
import { loadAdStrategyConfigWithSource, type ConfigSource } from '@/lib/ads-strategy/config'
import { loadOutcomeConfig } from '@/lib/ads-strategy/portfolio/outcome-config'
import { resolveAdsPlaybook } from '@/lib/ads-strategy/playbooks'
import type { CoreMetric } from '@/lib/ads-strategy/rules/core-metric'
import {
  computeReturnLadder,
  type LadderAccountFact, type LadderContactFact, type LadderOutcomeRow, type LadderSpendRow, type ReturnLadder,
} from '@/lib/ads-strategy/return-ladder/compute'

export interface ClientReturnLadder { client_id: string; name: string; resultNoun: string; ladder: ReturnLadder }
export interface ReturnLadderFailure { client_id: string; name: string; error: string }
export type ReturnLadderSection =
  | { rows: ClientReturnLadder[]; failed: ReturnLadderFailure[] }
  | { error: string }

/** 往回读多少天的花费：窗口最长是 3 个自然月（≤ 92 天）+ 时区余量。 */
export const SPEND_LOOKBACK_DAYS = 100
export const PAGE_SIZE = 1000
/** 翻页上限：到这儿还没读完就当「没读全」，不把半截数当整数报。 */
export const MAX_PAGES = 20

/** 成交周期目前库里没有地方存（等设置页那个工作包）。在那之前一律 null → 回报写「没配置，判不了」，不许给默认值。 */
const SALES_CYCLE_DAYS_NOT_STORED_YET: number | null = null

/** 联系人查询分块大小：`.in(...)` 的 id 列表别一次塞太多。 */
const CONTACT_CHUNK_SIZE = 200

// ---------------------------------------------------------------------------
// 通用：翻页读
// ---------------------------------------------------------------------------

/**
 * 按页读，直到读到不满一页为止。
 * 到 MAX_PAGES 还没读完 → incomplete=true（调用方决定是「判不了」还是直接失败）。
 */
export async function readPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; incomplete: boolean }> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const items = Array.isArray(data) ? (data as T[]) : []
    for (const item of items) rows.push(item)
    if (items.length < PAGE_SIZE) return { rows, incomplete: false }
  }
  return { rows, incomplete: true }
}

// ---------------------------------------------------------------------------
// 数值 / 日期小工具
// ---------------------------------------------------------------------------

/** 库里的 numeric 可能是字符串；null 保持 null，非有限数 → null。 */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 时间戳字符串 → 原样返回；解析不了 → null。 */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/** 花费行的原始形状（只声明我们 select 的列）。 */
interface SpendRowRaw {
  client_id: string
  ad_account_id: string
  platform: string
  insight_date: string
  spend: unknown
  leads: unknown
  messaging_conversations: unknown
}

/** 客户行的原始形状。 */
interface ClientRowRaw { id: string; name: string; industry: string | null }

/** 账户快照行的原始形状。 */
interface AccountSnapshotRaw { timezone_name: string | null; currency: string | null }

/** 成交行的原始形状（只 select 这几列，绝不碰个人数据列）。 */
interface OutcomeRowRaw {
  id: string
  contact_id: string | null
  outcome_kind: string
  amount_minor: unknown
  currency: string | null
  occurred_at: string
  review_status: string
}

/** 联系人行的原始形状。 */
interface ContactRowRaw { id: string; first_seen_at: string | null; attr_platform: string | null }

// ---------------------------------------------------------------------------
// 花费
// ---------------------------------------------------------------------------

/** 读全部客户、窗口内的 campaign 级花费行。 */
async function readSpendRows(
  supabase: SupabaseClient,
  since: string,
): Promise<{ rows: SpendRowRaw[]; incomplete: boolean }> {
  return readPages<SpendRowRaw>((from, to) =>
    supabase
      .from('ad_daily_insights')
      .select('client_id, ad_account_id, platform, insight_date, spend, leads, messaging_conversations')
      .eq('level', 'campaign')
      .gte('insight_date', since)
      // 第二排序键用主键：同一天同一个广告系列可能挂在两个客户名下，不用唯一键翻页会重或漏。
      .order('insight_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/** 原始花费行 → 纯计算用的花费行。 */
function toSpendRow(raw: SpendRowRaw): LadderSpendRow {
  return {
    adAccountId: raw.ad_account_id,
    platform: raw.platform,
    insightDate: raw.insight_date,
    spend: numOrNull(raw.spend),
    leads: numOrNull(raw.leads),
    messagingConversations: numOrNull(raw.messaging_conversations),
  }
}

/** 按 client_id 分组，只留窗口内真花过钱的客户。 */
function groupSpendByClient(rows: readonly SpendRowRaw[]): Map<string, SpendRowRaw[]> {
  const map = new Map<string, SpendRowRaw[]>()
  for (const r of rows) {
    const list = map.get(r.client_id)
    if (list === undefined) map.set(r.client_id, [r])
    else list.push(r)
  }
  for (const [id, list] of map) {
    const hasSpend = list.some(r => (numOrNull(r.spend) ?? 0) > 0)
    if (!hasSpend) map.delete(id)
  }
  return map
}

// ---------------------------------------------------------------------------
// 账户事实
// ---------------------------------------------------------------------------

/** 读一个账户的最新账户级快照（时区 / 币种）。读不到 → 两个 null。 */
async function readAccountSnapshot(
  supabase: SupabaseClient,
  adAccountId: string,
): Promise<AccountSnapshotRaw> {
  const { data, error } = await supabase
    .from('ad_entity_snapshots')
    .select('timezone_name, currency')
    .eq('ad_account_id', adAccountId)
    .eq('level', 'account')
    .order('captured_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const first = Array.isArray(data) ? (data as AccountSnapshotRaw[])[0] : undefined
  return { timezone_name: first?.timezone_name ?? null, currency: first?.currency ?? null }
}

/** 并行读该客户名下所有账户的快照，返回账户事实 + 已知时区列表。 */
async function readAccountFacts(
  supabase: SupabaseClient,
  accountIds: readonly string[],
): Promise<{ accounts: LadderAccountFact[]; timezones: string[] }> {
  const snapshots = await Promise.all(accountIds.map(id => readAccountSnapshot(supabase, id)))
  const accounts: LadderAccountFact[] = []
  const timezones: string[] = []
  for (let i = 0; i < accountIds.length; i++) {
    const snap = snapshots[i]
    accounts.push({ adAccountId: accountIds[i], currency: snap.currency })
    if (snap.timezone_name !== null) timezones.push(snap.timezone_name)
  }
  return { accounts, timezones }
}

/** 去重后的时区列表。 */
function distinctTimezones(timezones: readonly string[]): string[] {
  return Array.from(new Set(timezones))
}

/**
 * 代表时区：其「昨天」最早的那个（并列取字母序）。
 * 一个都没有 → null（纯计算会据此标 timezone_unknown）。
 */
function pickRepresentativeTimezone(timezones: readonly string[], now: Date): string | null {
  if (timezones.length === 0) return null
  const sorted = [...timezones].sort((a, b) => {
    const dayA = accountYesterday(a, now)
    const dayB = accountYesterday(b, now)
    if (dayA !== dayB) return dayA < dayB ? -1 : 1
    return a < b ? -1 : 1
  })
  return sorted[0]
}

// ---------------------------------------------------------------------------
// 成交 / 联系人
// ---------------------------------------------------------------------------

const OUTCOME_KINDS = new Set(['purchase', 'balance', 'lead'])
const REVIEW_STATUSES = new Set(['pending_review', 'approved', 'rejected'])

/** 原始成交行 → 纯计算用的成交行；不认识的枚举 / 解析不了的时间戳 → null（跳过）。 */
function toOutcomeRow(raw: OutcomeRowRaw): LadderOutcomeRow | null {
  if (!OUTCOME_KINDS.has(raw.outcome_kind)) return null
  if (!REVIEW_STATUSES.has(raw.review_status)) return null
  const occurredAt = isoOrNull(raw.occurred_at)
  if (occurredAt === null) return null
  return {
    id: raw.id,
    contactId: raw.contact_id,
    kind: raw.outcome_kind as LadderOutcomeRow['kind'],
    amountMinor: numOrNull(raw.amount_minor),
    currency: raw.currency,
    occurredAt,
    reviewStatus: raw.review_status as LadderOutcomeRow['reviewStatus'],
  }
}

/** 读该客户全部未被拒绝的成交事实行；读不全直接抛错（半截数不能当整数报）。 */
async function readOutcomes(supabase: SupabaseClient, clientId: string): Promise<LadderOutcomeRow[]> {
  const { rows, incomplete } = await readPages<OutcomeRowRaw>((from, to) =>
    supabase
      .from('me_sale_outcomes')
      .select('id, contact_id, outcome_kind, amount_minor, currency, occurred_at, review_status')
      .eq('client_id', clientId)
      .neq('review_status', 'rejected')
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (incomplete) throw new Error('成交记录没读全')
  const out: LadderOutcomeRow[] = []
  for (const raw of rows) {
    const mapped = toOutcomeRow(raw)
    if (mapped !== null) out.push(mapped)
  }
  return out
}

/** 原始联系人行 → 纯计算用的联系人事实。 */
function toContactFact(raw: ContactRowRaw): LadderContactFact {
  return { id: raw.id, firstSeenAt: isoOrNull(raw.first_seen_at), attrPlatform: raw.attr_platform }
}

/** 把 id 列表切成固定大小的块。 */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** 读这些联系人的事实行（分块查，避免一次塞太多 id）。 */
async function readContacts(supabase: SupabaseClient, contactIds: readonly string[]): Promise<LadderContactFact[]> {
  const out: LadderContactFact[] = []
  for (const ids of chunk(contactIds, CONTACT_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, first_seen_at, attr_platform')
      .in('id', ids)
    if (error) throw new Error(error.message)
    const rows = Array.isArray(data) ? (data as ContactRowRaw[]) : []
    for (const raw of rows) out.push(toContactFact(raw))
  }
  return out
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 主结果指标：只认这两个，其余一律 null（不猜）。 */
function toPrimaryResult(primary: string | null): CoreMetric | null {
  if (primary === 'lead' || primary === 'messaging_started') return primary
  return null
}

/** 读配置，返回纯计算需要的三个字段。 */
async function readConfig(clientId: string): Promise<{
  configSource: ConfigSource
  primaryResult: CoreMetric | null
}> {
  const cfg = await loadAdStrategyConfigWithSource(clientId)
  const outcome = await loadOutcomeConfig(clientId)
  const configSource: ConfigSource = cfg.source === 'fallback' || outcome.source === 'read_error' ? 'fallback' : cfg.source
  return { configSource, primaryResult: toPrimaryResult(outcome.config.primary) }
}

// ---------------------------------------------------------------------------
// 单个客户
// ---------------------------------------------------------------------------

/** 该客户花费行里去重后的账户 id。 */
function distinctAccountIds(rows: readonly SpendRowRaw[]): string[] {
  return Array.from(new Set(rows.map(r => r.ad_account_id)))
}

/** 该客户成交行里去重后的非空联系人 id。 */
function distinctContactIds(outcomes: readonly LadderOutcomeRow[]): string[] {
  const ids = new Set<string>()
  for (const o of outcomes) if (o.contactId !== null) ids.add(o.contactId)
  return Array.from(ids)
}

/** 取一个客户的一本账。任何读失败都往上抛，由调用方记进 failed。 */
async function gatherOne(
  supabase: SupabaseClient,
  client: ClientRowRaw,
  spendRows: readonly SpendRowRaw[],
  spendIncomplete: boolean,
  now: Date,
): Promise<ClientReturnLadder> {
  const accountIds = distinctAccountIds(spendRows)
  const { accounts, timezones } = await readAccountFacts(supabase, accountIds)
  const distinct = distinctTimezones(timezones)
  const asOfDate = await resolveClientEvaluationDate(accountIds, now)

  const outcomes = await readOutcomes(supabase, client.id)
  const contacts = await readContacts(supabase, distinctContactIds(outcomes))
  const { configSource, primaryResult } = await readConfig(client.id)

  const ladder = computeReturnLadder({
    asOfDate,
    timezone: pickRepresentativeTimezone(distinct, now),
    timezoneCount: distinct.length,
    spendRows: spendRows.map(toSpendRow),
    accounts,
    outcomes,
    contacts,
    salesCycleDays: SALES_CYCLE_DAYS_NOT_STORED_YET,
    primaryResult,
    configSource,
    spendIncomplete,
  })

  return {
    client_id: client.id,
    name: client.name,
    resultNoun: resolveAdsPlaybook(client.industry).resultNoun,
    ladder,
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 读这些客户的基础信息；读不到行的 id 直接跳过。 */
async function readClients(supabase: SupabaseClient, ids: readonly string[]): Promise<ClientRowRaw[]> {
  const { data, error } = await supabase.from('clients').select('id, name, industry').in('id', ids)
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? (data as ClientRowRaw[]) : []
}

/** 并行跑每个客户；单个客户失败只记进 failed，不拖垮整块。 */
async function gatherAll(
  supabase: SupabaseClient,
  clients: readonly ClientRowRaw[],
  byClient: Map<string, SpendRowRaw[]>,
  spendIncomplete: boolean,
  now: Date,
): Promise<{ rows: ClientReturnLadder[]; failed: ReturnLadderFailure[] }> {
  const rows: ClientReturnLadder[] = []
  const failed: ReturnLadderFailure[] = []
  const results = await Promise.all(clients.map(async client => {
    try {
      return { ok: true as const, value: await gatherOne(supabase, client, byClient.get(client.id) ?? [], spendIncomplete, now) }
    } catch (err) {
      return { ok: false as const, client, error: err instanceof Error ? err.message : String(err) }
    }
  }))
  for (const r of results) {
    if (r.ok) rows.push(r.value)
    else failed.push({ client_id: r.client.id, name: r.client.name, error: r.error })
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { rows, failed }
}

/** 周报一本账区块的取数入口。永不抛错：失败一律返回 `{ error }`。 */
export async function gatherReturnLadders(supabase: SupabaseClient, now: Date): Promise<ReturnLadderSection> {
  try {
    // 粗下界：日期列上的过滤，精确窗口在纯计算里再切。
    const since = new Date(now.getTime() - SPEND_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
    const spend = await readSpendRows(supabase, since)
    const byClient = groupSpendByClient(spend.rows)
    if (byClient.size === 0) return { rows: [], failed: [] }

    const clients = await readClients(supabase, Array.from(byClient.keys()))
    const { rows, failed } = await gatherAll(supabase, clients, byClient, spend.incomplete, now)
    return { rows, failed }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
