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
 *   · 上限：账户级读 client_meta_ad_accounts（按这个账户自己那一行），客户级读 ad_strategy_configs；
 *     多个登记账户时账户级没设就是没设，客户总上限顶替不了（带回登记账户数，由判灯去判）。
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
import type { BudgetFacts } from './types'

const PAGE_LIMIT = '500'
const IN_PLAY_FILTER = JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [...DELIVERING_STATUSES] }])
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

/** 库里的上限：正整数才算；没设 / 0 / 乱码都当「没设」（null），不是 0。 */
function parseCap(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

async function readAccountCaps(
  supabase: SupabaseClient,
  clientId: string,
  adAccountId: string,
): Promise<{ ok: true; cap: number | null; registered: number } | { ok: false; error: string }> {
  const table = 'client_meta_ad_accounts'
  let rows: unknown
  try {
    const res = await supabase.from(table).select('ad_account_id, daily_budget_cap_cents').eq('client_id', clientId)
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    rows = res.data
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
  const list = Array.isArray(rows) ? rows.map(asRecord).filter((r): r is Record<string, unknown> => r !== null) : []
  const mine = list.find(r => r.ad_account_id === adAccountId)
  if (!mine) return { ok: false, error: `广告账户 ${adAccountId} 没登记在这个客户名下（${table} 里找不到），上限没法读` }
  return { ok: true, cap: parseCap(mine.daily_budget_cap_cents), registered: list.length }
}

async function readClientCap(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ ok: true; cap: number | null } | { ok: false; error: string }> {
  const table = 'ad_strategy_configs'
  try {
    const res = await supabase.from(table).select('daily_budget_cap_cents').eq('client_id', clientId).maybeSingle()
    if (res.error) return { ok: false, error: `读 ${table} 失败：${sanitizeError(res.error.message)}` }
    // 没有这一行 = 客户级上限没设（不是读失败）
    return { ok: true, cap: parseCap(asRecord(res.data)?.daily_budget_cap_cents) }
  } catch (err) {
    return { ok: false, error: `读 ${table} 失败：${sanitizeError(err)}` }
  }
}

/** 两张表各读一次；任何一张读失败，两个上限一律 null（不拿读到一半的数去判）。 */
async function readCaps(supabase: SupabaseClient, clientId: string, adAccountId: string): Promise<Caps> {
  const account = await readAccountCaps(supabase, clientId, adAccountId)
  const client = await readClientCap(supabase, clientId)
  if (!account.ok || !client.ok) {
    const problems = [account.ok ? null : account.error, client.ok ? null : client.error].filter((m): m is string => m !== null)
    return { ok: false, error: problems.join('；') }
  }
  return { ok: true, account: account.cap, client: client.cap, registered: account.registered }
}

// ─── Meta：在投的系列 / 广告组日预算 ────────────────────────────────────────

interface LiveEntity {
  id: string
  campaignId: string | null
  daily: number
  lifetime: number
}

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

interface LiveTotals {
  daily: number
  lifetime: number
  entities: number
}

/** 系列级预算（日预算或终身预算）的系列，旗下广告组不再单独算；其余在投广告组用自己的预算。 */
function totalLive(campaigns: readonly LiveEntity[], adsets: readonly LiveEntity[]): LiveTotals {
  const totals: LiveTotals = { daily: 0, lifetime: 0, entities: 0 }
  const campaignBudgeted = new Set<string>()
  for (const c of campaigns) {
    if (c.daily > 0) {
      totals.daily += c.daily
      totals.entities += 1
      campaignBudgeted.add(c.id)
    } else if (c.lifetime > 0) {
      totals.lifetime += 1
      campaignBudgeted.add(c.id)
    }
  }
  for (const a of adsets) {
    if (a.campaignId !== null && campaignBudgeted.has(a.campaignId)) continue
    if (a.daily > 0) {
      totals.daily += a.daily
      totals.entities += 1
    } else if (a.lifetime > 0) {
      totals.lifetime += 1
    } else {
      throw new Error(`在投的广告组 ${a.id} 一个预算都没读到，合计会漏算`)
    }
  }
  return totals
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
    },
    errors,
  }
}
