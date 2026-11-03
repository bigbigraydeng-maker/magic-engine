/**
 * 预算门要的事实：库里的日预算上限 + Meta 现读的「在投」日预算合计（平台通用，只读）。
 *
 * 为什么存在：预算门以前拿客户配置里写死的「计划日预算 / 官方日上限」互相比，数字一过期就假绿
 * （2026-10-21 事故：写死 NZ$101 / NZ$110，库里上限 NZ$150、在投合计 NZ$134）。
 * 现在上限读库、在投预算读线上；配置里写死的数字只剩「跟库对一对」的作用，读不到时绝不能顶替。
 *
 * 口径跟信封 / 诊断保持一致（capabilities/ads/envelope-facts.ts、ads-strategy 诊断，两处各写一份必然分家）：
 *   · 「在投」的状态集合复用 DELIVERING_STATUSES；
 *   · 系列级预算（成组预算）：在投系列有日预算就算系列的，它下面的广告组不再单独计入——钱在系列那一层，重复加就翻倍；
 *   · 上限：账户级读 client_meta_ad_accounts（按这个账户自己那一行，账户编号带不带 act_ 都认），客户级读 ad_strategy_configs；
 *     多个登记账户时账户级没设就是没设，客户总上限顶替不了（带回登记账户数，由判灯去判）；
 *     老客户没有登记行时回落 clients.meta_ad_account_id + 客户级上限（跟信封一样）；
 *   · 上限不是正整数（0 / 负数 / 乱码）= 配置无效，读不到——不当作「没设」，更不当作 0（信封里这种配置会被拒）。
 *   · 多个登记账户时，其它账户（含被隐藏的）的在投预算读库里的快照（other-accounts.ts），读不成功就是 null，由判灯回到「只核对这一个账户」。
 *
 * 🔴 只读：库只 select；Meta 只发 GET（makeGraphGet：路径白名单、令牌只进 Authorization 头）。
 * 🔴 永不 reject：读不到就带着已清洗的原因返回；读不到的数是 null，绝不当成 0，也绝不当成「没设」。
 * 🔴 平台通用：本文件不许出现客户名 / 客户 ID / 像素编号 / 域名。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { ACCOUNT_ID_RE, makeGraphGet, type GraphGet } from './meta-reader'
import { hasDataArray, hasNextPage } from './post-launch'
import type { Sleep } from './retry'
import { sanitizeError } from './sanitize'
import type { BudgetFacts, OtherAccountFact } from './types'
import { totalLive, type LiveEntity, type LiveTotals } from './live-totals'
import { readOtherAccounts } from './other-accounts'

const PAGE_LIMIT = '500'
const IN_PLAY_FILTER = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [...DELIVERING_STATUSES] }])
// 🔴 要哪些字段是写死的常量，别做成可配置项：Graph 读取的白名单（meta-reader.ts）只管路径，字段不能变成外部可传的东西。
const CAMPAIGN_FIELDS = 'id,effective_status,daily_budget,lifetime_budget'
const ADSET_FIELDS = 'id,campaign_id,effective_status,daily_budget,lifetime_budget'

export interface BudgetReadInput {
  supabase: SupabaseClient
  clientId: string
  adAccountId: string
  /** null = 没有可用的 Meta 令牌：Meta 那一半一个请求都不发 */
  token: string | null
  fetcher: typeof fetch
  now: Date
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

export interface BudgetReadResult {
  facts: BudgetFacts
  errors: string[]
}

// ─── 库：日预算上限 ─────────────────────────────────────────────────────────

type Caps =
  | { ok: true; account: number | null; client: number | null; registered: number }
  | { ok: false; error: string }

type CapParse = { kind: 'unset' } | { kind: 'value'; cents: number } | { kind: 'invalid' }

/**
 * 库里的上限：正整数才算数；没设（null）= 没设；0 / 负数 / 小数 / 乱码 = 配置无效（不是「没设」，更不是 0）。
 * 信封里这种配置会被拒（capabilities/ads/envelope-facts.ts），所以这里也不能悄悄放过。
 */
function parseCap(value: unknown): CapParse {
  if (value === null || value === undefined) return { kind: 'unset' }
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? { kind: 'value', cents: n } : { kind: 'invalid' }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** 账户编号带不带 act_ 前缀都认（库里两种写法都见过）；比较前两边都去掉。 */
function normalizeAccountId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^act_/i, '') : ''
}

type AccountCaps =
  | { ok: true; cap: number | null | 'use_client_cap'; registered: number }
  | { ok: false; error: string }

/** 登记表里一行都没有时，老客户的广告账户记在 clients.meta_ad_account_id（信封同样回落到它）。 */
async function legacyAccountMatches(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<{ ok: true; matches: boolean } | { ok: false; error: string }> {
  const table = 'clients'
  try {
    const res = await supabase.from(table).select('meta_ad_account_id').eq('id', clientId).maybeSingle()
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    const legacy = normalizeAccountId(asRecord(res.data)?.meta_ad_account_id)
    return { ok: true, matches: legacy !== '' && legacy === normalizeAccountId(adAccountId) }
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
}

async function readAccountCaps(supabase: SupabaseClient, clientId: string, adAccountId: string): Promise<AccountCaps> {
  const table = 'client_meta_ad_accounts'
  let rows: unknown
  try {
    const res = await supabase.from(table).select('ad_account_id, daily_budget_cap_cents').eq('client_id', clientId)
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    rows = res.data
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
  // 回落只认「读成功、而且确实是一个空列表」：返回的不是列表 / 列表里有看不懂的行，都是读坏了，不是「没有登记行」
  if (!Array.isArray(rows)) return { ok: false, error: `读 ${table} 失败：返回的不是行列表，上限没法读` }
  const list: Record<string, unknown>[] = []
  for (const row of rows) {
    const rec = asRecord(row)
    if (rec === null) return { ok: false, error: `读 ${table} 失败：返回里有看不懂的行，上限没法读` }
    list.push(rec)
  }
  const notRegistered = `广告账户 ${adAccountId} 没登记在这个客户名下（${table} 里找不到），上限没法读`

  if (list.length === 0) {
    // 老客户没有登记行：回落到 clients.meta_ad_account_id，单账户，账户级上限 = 客户级上限（跟信封一致）
    const legacy = await legacyAccountMatches(supabase, clientId, adAccountId)
    if (!legacy.ok) return legacy
    return legacy.matches ? { ok: true, cap: 'use_client_cap', registered: 1 } : { ok: false, error: notRegistered }
  }

  const mine = list.find(r => normalizeAccountId(r.ad_account_id) === normalizeAccountId(adAccountId))
  if (!mine) return { ok: false, error: notRegistered }
  const cap = parseCap(mine.daily_budget_cap_cents)
  if (cap.kind === 'invalid') {
    return { ok: false, error: `库里该广告账户的日预算上限配置无效（不是正整数，${table}），上限没法读` }
  }
  return { ok: true, cap: cap.kind === 'value' ? cap.cents : null, registered: list.length }
}

async function readClientCap(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ok: true; cap: number | null } | { ok: false; error: string }> {
  const table = 'ad_strategy_configs'
  try {
    const res = await supabase.from(table).select('daily_budget_cap_cents').eq('client_id', clientId).maybeSingle()
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    // 没有这一行 = 客户级上限没设（不是读失败）；有这一行但值不是正整数 = 配置无效
    const cap = parseCap(asRecord(res.data)?.daily_budget_cap_cents)
    if (cap.kind === 'invalid') return { ok: false, error: `库里该客户的日预算总上限配置无效（不是正整数，${table}），上限没法读` }
    return { ok: true, cap: cap.kind === 'value' ? cap.cents : null }
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
}

/** 两张表各读一次；任何一张读失败 / 配置无效，两个上限一律 null（不拿读到一半的数去判）。 */
async function readCaps(supabase: SupabaseClient, clientId: string, adAccountId: string): Promise<Caps> {
  const account = await readAccountCaps(supabase, clientId, adAccountId)
  const client = await readClientCap(supabase, clientId)
  if (!account.ok || !client.ok) {
    const problems = [account.ok ? null : account.error, client.ok ? null : client.error].filter((m): m is string => m !== null)
    return { ok: false, error: problems.join('；') }
  }
  return { ok: true, account: account.cap === 'use_client_cap' ? client.cap : account.cap, client: client.cap, registered: account.registered }
}

// ─── Meta：在投的系列 / 广告组日预算 ────────────────────────────────────────

/** Meta 的预算是整数字符串（最小货币单位）；缺 / null = 没有（0）；其它写法 = 乱码（null）。 */
function parseBudget(value: unknown): number | null {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

/**
 * 一行 → 在投的实体；不在投（已暂停 / 被拒…）→ null（不计入）。
 * 状态读不出、在投行的编号或预算乱码 → 抛错：整份读不到，绝不悄悄漏算。
 */
function parseLiveEntity(raw: unknown, label: string): LiveEntity | null {
  const row = asRecord(raw)
  if (!row || typeof row.effective_status !== 'string') throw new Error(`${label}有一行读不出投放状态`)
  if (!DELIVERING_STATUSES.has(row.effective_status)) return null
  if (typeof row.id !== 'string' || row.id === '') throw new Error(`${label}有一行在投的却没有编号`)
  const daily = parseBudget(row.daily_budget)
  const lifetime = parseBudget(row.lifetime_budget)
  if (daily === null || lifetime === null) throw new Error(`${label} ${row.id} 的预算不是整数，读不懂`)
  return { id: row.id, campaignId: typeof row.campaign_id === 'string' ? row.campaign_id : null, daily, lifetime }
}

async function listInPlay(graphGet: GraphGet, path: string, fields: string, label: string): Promise<unknown[]> {
  const body = await graphGet(path, { fields, filtering: IN_PLAY_FILTER, limit: PAGE_LIMIT })
  if (!hasDataArray(body)) throw new Error(`Meta 返回的${label}列表格式不对（没有 data 数组）`)
  if (hasNextPage(body)) throw new Error(`在投的${label}超过一页，读不全`)
  return body.data
}

function collectLive(raws: readonly unknown[], label: string): LiveEntity[] {
  const out: LiveEntity[] = []
  for (const raw of raws) {
    const entity = parseLiveEntity(raw, label)
    if (entity) out.push(entity)
  }
  return out
}

type Live = ({ ok: true } & LiveTotals) | { ok: false; error: string }

async function readLive(adAccountId: string, input: BudgetReadInput): Promise<Live> {
  const { token } = input
  if (!token) return { ok: false, error: '没有可用的 Meta 令牌，在投预算没法读' }
  try {
    const graphGet = makeGraphGet(input.fetcher, token, input.sleep)
    const campaigns = collectLive(await listInPlay(graphGet, `${adAccountId}/campaigns`, CAMPAIGN_FIELDS, '系列'), '系列')
    const adsets = collectLive(await listInPlay(graphGet, `${adAccountId}/adsets`, ADSET_FIELDS, '广告组'), '广告组')
    return { ok: true, ...totalLive(campaigns, adsets) }
  } catch (err) {
    return { ok: false, error: `读 Meta 在投预算失败：${sanitizeError(err, [token])}` }
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

function unread(now: Date, error: string): BudgetReadResult {
  return {
    facts: {
      read: false, error, as_of: now.toISOString(),
      account_cap_cents: null, client_cap_cents: null, registered_account_count: null,
      live_daily_budget_cents: null, live_lifetime_budget_count: 0, live_entity_count: 0,
      other_accounts: null, other_accounts_error: null,
    },
    errors: [error],
  }
}

/** 读预算事实。永不 reject；库的一半和 Meta 的一半各自独立，一半失败只让那一半变 null。 */
export async function readBudgetFacts(input: BudgetReadInput): Promise<BudgetReadResult> {
  const { supabase, clientId, adAccountId, now } = input
  if (!ACCOUNT_ID_RE.test(adAccountId)) return unread(now, '广告账户编号格式不对，预算没法读')

  const caps = await readCaps(supabase, clientId, adAccountId)
  const live = await readLive(adAccountId, input)

  // 其它登记账户（只读库里的快照，不调 Meta）：只有一个登记账户就没有"其它"；读不成功只让这一项为 null，不连累整份预算事实
  let otherAccounts: readonly OtherAccountFact[] | null = null
  let otherAccountsError: string | null = null
  if (caps.ok && caps.registered <= 1) {
    otherAccounts = []
  } else if (caps.ok) {
    const others = await readOtherAccounts({ supabase, clientId, adAccountId, now })
    if (others.ok && others.accounts.length > 0) otherAccounts = others.accounts
    else if (others.ok) otherAccountsError = '登记了多个广告账户，却在登记表里找不到其它账户'
    else otherAccountsError = others.error
  }

  const errors = [caps.ok ? null : caps.error, live.ok ? null : live.error].filter((m): m is string => m !== null)
  return {
    facts: {
      read: caps.ok && live.ok,
      error: errors.length > 0 ? errors.join('；') : null,
      as_of: now.toISOString(),
      account_cap_cents: caps.ok ? caps.account : null,
      client_cap_cents: caps.ok ? caps.client : null,
      registered_account_count: caps.ok ? caps.registered : null,
      live_daily_budget_cents: live.ok ? live.daily : null,
      live_lifetime_budget_count: live.ok ? live.lifetime : 0,
      live_entity_count: live.ok ? live.entities : 0,
      other_accounts: otherAccounts,
      other_accounts_error: otherAccountsError,
    },
    errors,
  }
}
