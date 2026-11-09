/**
 * 其它登记账户的「在投预算」事实：只读库里的快照，不调 Meta。
 *
 * 为什么存在：开投前检查只核对一个广告账户；客户登记了多个账户时，其它账户没被看过，灯永远是黄的。
 * 有些账户「广告健康页不显示」（只是显示开关，不代表没有预算），也可能欠费（Meta 状态 3），
 * 但里面开着的系列一旦账户付清就会继续花钱——必须把真实数字读出来，而不是忽略。
 *
 * 🔴 只读库：本模块只 select，不调 Meta、不写库。
 * 🔴 永不 reject：读不到就带着已清洗的原因返回；绝不报半张图（任何一个账户读不全就整份失败）。
 * 🔴 平台通用：本文件不许出现客户名 / 客户 ID / 完整账户编号（错误里只留尾号 4 位）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { totalLive, type LiveEntity } from './live-totals'
import { sanitizeError } from './sanitize'
import type { OtherAccountFact } from './types'

const FRESH_MS = 12 * 60 * 60 * 1000
const WINDOW_MS = 48 * 60 * 60 * 1000
const PAGE = 1000
const MAX_ROWS = 6000
const LEVELS = ['account', 'campaign', 'adset'] as const
type Level = (typeof LEVELS)[number]
const LEVEL_LABEL: Record<Level, string> = { account: '账户级', campaign: '系列级', adset: '广告组级' }

export interface OtherAccountsInput {
  supabase: SupabaseClient
  clientId: string
  /** 本次核对的那个账户（带不带 act_ 前缀都认） */
  adAccountId: string
  now: Date
}

export type OtherAccountsResult = { ok: true; accounts: OtherAccountFact[] } | { ok: false; error: string }

type Row = Record<string, unknown>

function asRecord(value: unknown): Row | null {
  return typeof value === 'object' && value !== null ? (value as Row) : null
}

function normalizeAccountId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^act_/i, '') : ''
}

function tailOf(normalized: string): string {
  return normalized.slice(-4)
}

function fail(error: string): OtherAccountsResult {
  return { ok: false, error }
}

// ─── 登记表 ─────────────────────────────────────────────────────────────────

interface RegistryRow {
  normalized: string
  label: string | null
  hidden: boolean
}

async function readRegistry(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ok: true; rows: RegistryRow[] } | { ok: false; error: string }> {
  const table = 'client_meta_ad_accounts'
  let data: unknown
  try {
    const res = await supabase.from(table).select('ad_account_id, label, hidden_from_ad_health').eq('client_id', clientId)
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    data = res.data
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
  if (!Array.isArray(data)) return { ok: false, error: `读 ${table} 失败：返回的不是行列表` }
  const rows: RegistryRow[] = []
  for (const raw of data) {
    const rec = asRecord(raw)
    if (!rec || typeof rec.ad_account_id !== 'string') {
      return { ok: false, error: `读 ${table} 失败：返回的不是行列表` }
    }
    const label = typeof rec.label === 'string' && rec.label.trim() !== '' ? rec.label.trim() : null
    rows.push({ normalized: normalizeAccountId(rec.ad_account_id), label, hidden: rec.hidden_from_ad_health === true })
  }
  return { ok: true, rows }
}

/** 每个账户的两种写法（带 / 不带 act_）都查，快照表按写入时的字符串存。 */
function idVariants(normalized: string): string[] {
  return [normalized, `act_${normalized}`]
}

// ─── 抓全记录 ───────────────────────────────────────────────────────────────

interface CaptureRow {
  normalized: string
  level: string
  captured_at: string
  complete: unknown
  skipped_shared: unknown
}

async function readCaptures(
  supabase: SupabaseClient,
  clientId: string,
  ids: string[],
  now: Date,
): Promise<{ ok: true; rows: CaptureRow[] } | { ok: false; error: string }> {
  const table = 'ad_snapshot_captures'
  try {
    const res = await supabase
      .from(table)
      .select('ad_account_id, level, captured_at, complete, skipped_shared')
      .eq('client_id', clientId)
      .in('ad_account_id', ids)
      .in('level', [...LEVELS])
      .gte('captured_at', new Date(now.getTime() - FRESH_MS).toISOString())
      .order('captured_at', { ascending: false })
      .limit(1000)
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    if (!Array.isArray(res.data)) return { ok: false, error: `读 ${table} 失败：返回的不是行列表` }
    const rows: CaptureRow[] = []
    for (const raw of res.data) {
      const rec = asRecord(raw)
      if (!rec || typeof rec.captured_at !== 'string' || typeof rec.level !== 'string') continue
      rows.push({
        normalized: normalizeAccountId(rec.ad_account_id),
        level: rec.level,
        captured_at: rec.captured_at,
        complete: rec.complete,
        skipped_shared: rec.skipped_shared,
      })
    }
    return { ok: true, rows }
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
}

/** 每个账户三个层级各取最新一条；必须存在、抓全、没跳过共享。返回 snapshot_at（三层里最早的一条）。 */
function pickSnapshotAt(
  rows: readonly CaptureRow[],
  normalized: string,
  tail: string,
): { ok: true; snapshotAt: string } | { ok: false; error: string } {
  const mine = rows.filter(r => r.normalized === normalized)
  const times: string[] = []
  for (const level of LEVELS) {
    const newest = mine.find(r => r.level === level)
    if (!newest || newest.complete !== true || newest.skipped_shared !== false) {
      return {
        ok: false,
        error: `广告账户尾号 ${tail} 的${LEVEL_LABEL[level]}快照最近 12 小时内没有抓全，没法确认它里面有没有开着的预算`,
      }
    }
    times.push(newest.captured_at)
  }
  return { ok: true, snapshotAt: times.reduce((a, b) => (a < b ? a : b)) }
}

// ─── 快照行 ─────────────────────────────────────────────────────────────────

interface EntityRow {
  normalized: string
  level: string
  entity_id: string
  campaign_id: string | null
  effective_status: string
  daily_budget_minor: unknown
  lifetime_budget_minor: unknown
  capture_reason: unknown
  account_status: unknown
  currency: unknown
}

async function readSnapshots(
  supabase: SupabaseClient,
  clientId: string,
  ids: string[],
  now: Date,
): Promise<{ ok: true; rows: EntityRow[] } | { ok: false; error: string }> {
  const table = 'ad_entity_snapshots'
  const since = new Date(now.getTime() - WINDOW_MS).toISOString()
  const out: EntityRow[] = []
  try {
    for (let offset = 0; ; offset += PAGE) {
      const res = await supabase
        .from(table)
        .select(
          'ad_account_id, level, entity_id, campaign_id, effective_status, daily_budget_minor, lifetime_budget_minor, capture_reason, account_status, currency, captured_at',
        )
        .eq('client_id', clientId)
        .in('ad_account_id', ids)
        .in('level', [...LEVELS])
        .gte('captured_at', since)
        .order('captured_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
      if (!Array.isArray(res.data)) return { ok: false, error: `读 ${table} 失败：返回的不是行列表` }
      for (const raw of res.data) {
        const rec = asRecord(raw)
        // 🔴 看不懂的快照行不能悄悄跳过：跳过的恰好可能是一个开着的系列，合计就会漏算
        if (!rec || typeof rec.level !== 'string' || typeof rec.entity_id !== 'string') {
          return { ok: false, error: `读 ${table} 失败：返回里有看不懂的行，在投预算没法确认` }
        }
        out.push({
          normalized: normalizeAccountId(rec.ad_account_id),
          level: rec.level,
          entity_id: rec.entity_id,
          campaign_id: typeof rec.campaign_id === 'string' ? rec.campaign_id : null,
          effective_status: typeof rec.effective_status === 'string' ? rec.effective_status : '',
          daily_budget_minor: rec.daily_budget_minor,
          lifetime_budget_minor: rec.lifetime_budget_minor,
          capture_reason: rec.capture_reason,
          account_status: rec.account_status,
          currency: rec.currency,
        })
      }
      if (res.data.length < PAGE) break
      if (out.length > MAX_ROWS) return { ok: false, error: '快照行太多，读不全' }
    }
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
  if (out.length > MAX_ROWS) return { ok: false, error: '快照行太多，读不全' }
  return { ok: true, rows: out }
}

// ─── 单个账户 → 事实 ────────────────────────────────────────────────────────

function parseBudget(value: unknown): number | null {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function buildFact(
  registry: RegistryRow,
  snapshotAt: string,
  rows: readonly EntityRow[],
): { ok: true; fact: OtherAccountFact } | { ok: false; error: string } {
  const tail = tailOf(registry.normalized)
  const seen = new Set<string>()
  const newest: EntityRow[] = []
  for (const row of rows) {
    const key = `${row.level}|${row.entity_id}`
    if (seen.has(key)) continue
    seen.add(key)
    newest.push(row)
  }

  const accountRow = newest.find(r => r.level === 'account')
  const accountStatus = accountRow && typeof accountRow.account_status === 'number' ? accountRow.account_status : null
  const currency =
    accountRow && typeof accountRow.currency === 'string' && accountRow.currency.trim() !== ''
      ? accountRow.currency.trim().toUpperCase()
      : null

  const open = (level: 'campaign' | 'adset'): EntityRow[] =>
    newest.filter(
      r => r.level === level && r.capture_reason !== 'disappeared' && DELIVERING_STATUSES.has(r.effective_status),
    )

  const toEntity = (row: EntityRow): LiveEntity | null => {
    const daily = parseBudget(row.daily_budget_minor)
    const lifetime = parseBudget(row.lifetime_budget_minor)
    if (daily === null || lifetime === null) return null
    return { id: row.entity_id, campaignId: row.campaign_id, daily, lifetime }
  }

  const campaigns: LiveEntity[] = []
  for (const row of open('campaign')) {
    const entity = toEntity(row)
    if (!entity) return { ok: false, error: `广告账户尾号 ${tail} 的快照里有看不懂的预算，没法确认` }
    campaigns.push(entity)
  }
  const adsets: LiveEntity[] = []
  for (const row of open('adset')) {
    const entity = toEntity(row)
    if (!entity) return { ok: false, error: `广告账户尾号 ${tail} 的快照里有看不懂的预算，没法确认` }
    adsets.push(entity)
  }

  let totals
  try {
    totals = totalLive(campaigns, adsets)
  } catch (err) {
    return { ok: false, error: `广告账户尾号 ${tail} 的在投预算算不全：${sanitizeError(err)}` }
  }

  return {
    ok: true,
    fact: {
      tail,
      label: registry.label,
      hidden: registry.hidden,
      account_status: accountStatus,
      currency,
      open_campaign_count: campaigns.length,
      live_daily_budget_cents: totals.daily,
      live_lifetime_budget_count: totals.lifetime,
      live_entity_count: totals.entities,
      snapshot_at: snapshotAt,
    },
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

export async function readOtherAccounts(input: OtherAccountsInput): Promise<OtherAccountsResult> {
  const { supabase, clientId, adAccountId, now } = input
  try {
    const registry = await readRegistry(supabase, clientId)
    if (!registry.ok) return registry
    if (registry.rows.length === 0) return { ok: true, accounts: [] }

    const mineId = normalizeAccountId(adAccountId)
    const mine = registry.rows.find(r => r.normalized === mineId)
    if (!mine) {
      return fail(`广告账户尾号 ${tailOf(mineId)} 没登记在这个客户名下，其它账户没法判断`)
    }
    const others = registry.rows.filter(r => r !== mine)
    if (others.length === 0) return { ok: true, accounts: [] }

    const ids = Array.from(new Set(others.flatMap(r => idVariants(r.normalized))))

    const captures = await readCaptures(supabase, clientId, ids, now)
    if (!captures.ok) return captures
    const snapshotAts: string[] = []
    for (const other of others) {
      const picked = pickSnapshotAt(captures.rows, other.normalized, tailOf(other.normalized))
      if (!picked.ok) return picked
      snapshotAts.push(picked.snapshotAt)
    }

    const snapshots = await readSnapshots(supabase, clientId, ids, now)
    if (!snapshots.ok) return snapshots

    const accounts: OtherAccountFact[] = []
    for (let i = 0; i < others.length; i++) {
      const other = others[i]
      const rows = snapshots.rows.filter(r => r.normalized === other.normalized)
      const built = buildFact(other, snapshotAts[i], rows)
      if (!built.ok) return built
      accounts.push(built.fact)
    }
    return { ok: true, accounts }
  } catch (err) {
    return fail(`读其它账户快照失败：${sanitizeError(err)}`)
  }
}
