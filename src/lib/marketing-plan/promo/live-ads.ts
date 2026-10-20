import { supabaseAdmin } from '@/lib/supabase'

export type LiveAdsFact =
  | { ok: true; live_adsets: number; spending_adsets: number; by_account: LiveAdsAccount[]; spend_today: number | null; spend_day: string | null; currency: string | null; as_of: string | null }
  | { ok: false; reason: string }

/** spending = 近 3 天确认有花费；no_spend_data = 状态开着但花费数据缺失/过旧，没法确认；idle = 花费数据是新的且近 3 天花费为 0 */
export type LiveAdsState = 'spending' | 'no_spend_data' | 'idle'

export interface LiveAdsAccount {
  ad_account_id: string
  label: string | null
  live_adsets: number
  as_of: string | null
  state: LiveAdsState
  /** 该账户花费数据最新一天；一条都没有 = null */
  last_insight_day: string | null
  spend_3d: number
}

export interface AccountInsightFact { last_day: string | null; spend_3d: number }

export interface LiveAdsInput {
  /** latest snapshot row per adset (already de-duplicated by entity, newest first-wins) */
  adsets: { entity_id: string; ad_account_id?: string; effective_status: string | null; capture_reason: string | null; captured_at: string }[]
  /** 账户标签（来自绑定表），用于分账户显示；没有就显示账户编号 */
  accountLabels?: Record<string, string | null>
  /** 每个账户的花费事实；缺这个账户的记录 = 没法确认花费 */
  accountInsights?: Record<string, AccountInsightFact>
  /** campaign-level insight rows for the most recent insight_date that exists */
  insights: { insight_date: string; spend: number | null }[]
  currency: string | null
  today: string // YYYY-MM-DD in the account timezone (caller supplies)
}

function dayMinus(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10)
}

function stateOf(fact: AccountInsightFact | undefined, today: string): LiveAdsState {
  if (!fact || fact.last_day === null || fact.last_day < dayMinus(today, 3)) return 'no_spend_data'
  return fact.spend_3d > 0 ? 'spending' : 'idle'
}

function byAccount(input: LiveAdsInput): LiveAdsAccount[] {
  const map = new Map<string, LiveAdsAccount>()
  for (const a of input.adsets) {
    if (a.effective_status !== 'ACTIVE' || a.capture_reason === 'disappeared') continue
    const id = a.ad_account_id ?? '未知账户'
    const ins = input.accountInsights?.[id]
    const cur = map.get(id) ?? {
      ad_account_id: id, label: input.accountLabels?.[id] ?? null, live_adsets: 0, as_of: null,
      state: stateOf(ins, input.today), last_insight_day: ins?.last_day ?? null, spend_3d: ins?.spend_3d ?? 0,
    }
    cur.live_adsets += 1
    if (cur.as_of === null || a.captured_at > cur.as_of) cur.as_of = a.captured_at
    map.set(id, cur)
  }
  return Array.from(map.values())
}

export function summarizeLiveAds(input: LiveAdsInput): LiveAdsFact {
  const accounts = byAccount(input)
  const live_adsets = input.adsets.filter(
    (a) => a.effective_status === 'ACTIVE' && a.capture_reason !== 'disappeared',
  ).length

  let spend_day: string | null = null
  for (const row of input.insights) {
    if (spend_day === null || row.insight_date > spend_day) {
      spend_day = row.insight_date
    }
  }

  let spend_today: number | null = null
  if (spend_day !== null && spend_day === input.today) {
    let sum = 0
    for (const row of input.insights) {
      if (row.insight_date === input.today) {
        sum += row.spend ?? 0
      }
    }
    spend_today = sum
  }

  let as_of: string | null = null
  for (const a of input.adsets) {
    if (as_of === null || a.captured_at > as_of) {
      as_of = a.captured_at
    }
  }

  return {
    ok: true,
    live_adsets,
    spending_adsets: accounts.filter(a => a.state === 'spending').reduce((n, a) => n + a.live_adsets, 0),
    by_account: accounts,
    spend_today,
    spend_day,
    currency: input.currency,
    as_of,
  }
}

function normalizeAccountId(raw: string): string {
  const digits = raw.replace(/^act_/, '')
  return `act_${digits}`
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function loadAccountIds(clientId: string): Promise<{ ids: string[]; labels: Record<string, string | null> } | null> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, label')
    .eq('client_id', clientId)
  if (error) return null
  const rows = (data ?? []) as { ad_account_id: string | null; label: string | null }[]
  const labels: Record<string, string | null> = {}
  const ids: string[] = []
  for (const r of rows) {
    if (typeof r.ad_account_id !== 'string' || r.ad_account_id.length === 0) continue
    const id = normalizeAccountId(r.ad_account_id)
    ids.push(id)
    labels[id] = r.label
  }
  if (ids.length > 0) return { ids, labels }

  const fallback = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  if (fallback.error) return null
  const single = (fallback.data as { meta_ad_account_id: string | null } | null)?.meta_ad_account_id
  if (typeof single === 'string' && single.length > 0) return { ids: [normalizeAccountId(single)], labels: {} }
  return { ids: [], labels: {} }
}

interface AdsetRow {
  entity_id: string
  ad_account_id: string
  effective_status: string | null
  capture_reason: string | null
  captured_at: string
}

async function loadAdsets(clientId: string, accounts: string[], since: string): Promise<AdsetRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('entity_id, ad_account_id, effective_status, capture_reason, captured_at')
    .eq('client_id', clientId)
    .eq('level', 'adset')
    .in('ad_account_id', accounts)
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(2000)
  if (error) return null
  const rows = (data ?? []) as AdsetRow[]
  const seen = new Set<string>()
  const out: AdsetRow[] = []
  for (const r of rows) {
    if (seen.has(r.entity_id)) continue
    seen.add(r.entity_id)
    out.push(r)
  }
  return out
}

interface InsightRow {
  insight_date: string
  spend: number | null
}

async function loadInsights(clientId: string, accounts: string[], since: string): Promise<InsightRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date, spend')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .in('ad_account_id', accounts)
    .gte('insight_date', since)
  if (error) return null
  const raw = (data ?? []) as { insight_date: string; spend: unknown }[]
  let latest: string | null = null
  for (const r of raw) {
    if (latest === null || r.insight_date > latest) latest = r.insight_date
  }
  if (latest === null) return []
  return raw
    .filter((r) => r.insight_date === latest)
    .map((r) => ({ insight_date: r.insight_date, spend: toNumberOrNull(r.spend) }))
}

async function loadAccountInsights(clientId: string, accounts: string[], today: string): Promise<Record<string, AccountInsightFact> | null> {
  const since = dayMinus(today, 3)
  const out: Record<string, AccountInsightFact> = {}
  for (const id of accounts) {
    const latest = await supabaseAdmin
      .from('ad_daily_insights').select('insight_date')
      .eq('client_id', clientId).eq('ad_account_id', id).eq('level', 'campaign')
      .order('insight_date', { ascending: false }).limit(1)
    if (latest.error) return null
    const recent = await supabaseAdmin
      .from('ad_daily_insights').select('spend')
      .eq('client_id', clientId).eq('ad_account_id', id).eq('level', 'campaign').gte('insight_date', since)
    if (recent.error) return null
    const spend = ((recent.data ?? []) as { spend: unknown }[]).reduce((n, r) => n + (toNumberOrNull(r.spend) ?? 0), 0)
    out[id] = { last_day: (latest.data as { insight_date: string }[] | null)?.[0]?.insight_date ?? null, spend_3d: spend }
  }
  return out
}

async function loadCurrency(clientId: string, accounts: string[]): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_entity_snapshots')
    .select('currency')
    .eq('client_id', clientId)
    .eq('level', 'account')
    .in('ad_account_id', accounts)
    .order('captured_at', { ascending: false })
    .limit(1)
  if (error) return null
  const rows = (data ?? []) as { currency: string | null }[]
  return rows[0]?.currency ?? null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function minusDays(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000)
}

export async function loadLiveAds(clientId: string, now: Date = new Date()): Promise<LiveAdsFact> {
  try {
    const bound = await loadAccountIds(clientId)
    if (bound === null) return { ok: false, reason: '读不到广告花费' }
    const accounts = bound.ids
    if (accounts.length === 0) return { ok: false, reason: '这个客户没有绑定广告账户' }

    const today = isoDate(now)
    const adsetsSince = minusDays(now, 2).toISOString()
    const insightsSince = isoDate(minusDays(now, 1))

    const adsets = await loadAdsets(clientId, accounts, adsetsSince)
    if (adsets === null) return { ok: false, reason: '读不到广告花费' }

    const insights = await loadInsights(clientId, accounts, insightsSince)
    if (insights === null) return { ok: false, reason: '读不到广告花费' }

    const accountInsights = await loadAccountInsights(clientId, accounts, today)
    if (accountInsights === null) return { ok: false, reason: '读不到广告花费' }

    const currency = await loadCurrency(clientId, accounts)

    return summarizeLiveAds({ adsets, insights, currency, today, accountLabels: bound.labels, accountInsights })
  } catch {
    return { ok: false, reason: '读不到广告花费' }
  }
}

const MONEY_PREFIX: Record<string, string> = { NZD: 'NZ$', AUD: 'A$', USD: 'US$' }
const snapTime = (iso: string | null): string => (iso ? `快照 ${iso.slice(5, 16).replace('T', ' ')} UTC` : '无快照时间')
const nameOf = (a: LiveAdsAccount): string => a.label ?? a.ad_account_id

export type LiveAdsLevel = 'red' | 'amber' | 'grey'
export interface LiveAdsMessage { level: LiveAdsLevel; text: string }

/**
 * 把读取结果翻成一句给 PM 的话。红字只给「近 3 天确认有花费」的账户；
 * 状态开着但花费数据缺失/过旧 → 黄字「没法确认」（不说在花钱）；花费数据是新的且为 0 → 灰字。读不到 / 没有开着的 → null。
 */
export function describeLiveAds(fact: LiveAdsFact | null): LiveAdsMessage | null {
  if (!fact || !fact.ok || fact.live_adsets <= 0) return null
  const prefix = fact.currency ? (MONEY_PREFIX[fact.currency] ?? `${fact.currency} `) : ''
  const spending = fact.by_account.filter(a => a.state === 'spending')
  if (spending.length > 0) {
    const where = spending.map(a => `${nameOf(a)} ${a.live_adsets} 个，近 3 天花费 ${prefix}${a.spend_3d.toFixed(2)}，花费数据到 ${a.last_insight_day ?? '未知'}，${snapTime(a.as_of)}`).join('；')
    return { level: 'red', text: `⚠️ 按系统里的快照，Meta 里有 ${fact.spending_adsets} 个广告组在花钱（${where}），但本计划还没批准——计划记录与实际不一致，请先批准或联系统筹。注意：快照之后广告可能已被暂停，以 Meta 为准。` }
  }
  const unknown = fact.by_account.filter(a => a.state === 'no_spend_data')
  if (unknown.length > 0) {
    const where = unknown.map(a => `${nameOf(a)} ${a.live_adsets} 个（花费数据${a.last_insight_day ? `停在 ${a.last_insight_day}` : '一条都没有'}，${snapTime(a.as_of)}）`).join('；')
    return { level: 'amber', text: `ℹ️ 快照显示这些广告组状态是「开着」：${where}。这些广告可能已经在花钱：新开投的广告，花费数据要等下一次每日拉取才会到（通常次日）；系统里现在的花费数据太旧，没法确认。本计划还没批准，请到 Meta 核对，不要当成「没事」。` }
  }
  const where = fact.by_account.map(a => `${nameOf(a)} ${a.live_adsets} 个`).join('、')
  return { level: 'grey', text: `有广告组状态是「开着」（${where}），但近 3 天花费为 0，没有在花钱。` }
}
